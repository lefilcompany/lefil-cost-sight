import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type ChatMsg = { role: "user" | "model"; content: string };

const ASSISTANT_SYSTEM = `Você é o assistente do Quiwi Cost Center, uma ferramenta de gestão de custos de fornecedores de IA e cloud da Lefil.
Responda em português do Brasil, direto, objetivo e usando os dados de contexto fornecidos.
Sempre inclua valores em BRL quando disponíveis. Se não houver dados suficientes, diga isso claramente.
Formate listas e tabelas em Markdown quando ajudar a leitura.`;

async function buildCostsContext(supabase: any) {
  const now = new Date();
  const start = new Date(now.getTime() - 30 * 86400_000).toISOString().slice(0, 10);

  const [entriesRes, providersRes, alertsRes, rateRes] = await Promise.all([
    supabase
      .from("cost_entries")
      .select("entry_date, cost_brl, cost_usd, description, providers(name), platforms(name), clients(name)")
      .gte("entry_date", start)
      .order("entry_date", { ascending: false })
      .limit(500),
    supabase.from("provider_connections").select("id, status, last_synced_at, providers(name)"),
    supabase
      .from("alert_events")
      .select("title, message, severity, status, created_at, metric_value, threshold")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("system_settings").select("value").eq("key", "usd_brl_rate").maybeSingle(),
  ]);

  const entries = (entriesRes.data ?? []) as any[];
  const totalBrl = entries.reduce((s, e) => s + Number(e.cost_brl ?? 0), 0);
  const totalUsd = entries.reduce((s, e) => s + Number(e.cost_usd ?? 0), 0);

  const byProvider = new Map<string, number>();
  for (const e of entries) {
    const name = e.providers?.name ?? "—";
    byProvider.set(name, (byProvider.get(name) ?? 0) + Number(e.cost_brl ?? 0));
  }
  const providerRanking = Array.from(byProvider.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, brl]) => `- ${name}: R$ ${brl.toFixed(2)}`)
    .join("\n");

  const providerConns = (providersRes.data ?? [])
    .map((c: any) => `- ${c.providers?.name ?? "?"}: ${c.status}${c.last_synced_at ? ` (último sync ${c.last_synced_at})` : ""}`)
    .join("\n");

  const alerts = (alertsRes.data ?? [])
    .map((a: any) => `- [${a.severity}/${a.status}] ${a.title} — ${a.message ?? ""}`)
    .join("\n");

  const rate = (rateRes.data?.value as any)?.rate;

  return `Período analisado: últimos 30 dias (de ${start} até hoje).
Total no período: R$ ${totalBrl.toFixed(2)} (US$ ${totalUsd.toFixed(2)}).
Cotação USD→BRL atual: ${rate ? rate.toFixed(4) : "n/d"}.

Top fornecedores por custo (BRL):
${providerRanking || "(sem dados)"}

Conexões de fornecedores:
${providerConns || "(nenhuma)"}

Últimos alertas:
${alerts || "(nenhum)"}`;
}

export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { messages: ChatMsg[] }) => {
    if (!Array.isArray(data?.messages) || data.messages.length === 0) {
      throw new Error("messages obrigatório");
    }
    return data;
  })
  .handler(async ({ data, context }) => {
    const { callGemini } = await import("./gemini-ai.server");
    const ctxText = await buildCostsContext(context.supabase);
    const system = `${ASSISTANT_SYSTEM}\n\n=== CONTEXTO ATUAL ===\n${ctxText}`;
    const reply = await callGemini({
      system,
      messages: data.messages,
      temperature: 0.35,
      maxOutputTokens: 1024,
    });
    return { reply };
  });

export const summarizeCosts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { callGemini } = await import("./gemini-ai.server");
    const ctxText = await buildCostsContext(context.supabase);
    const reply = await callGemini({
      system: `${ASSISTANT_SYSTEM}\nGere um resumo executivo curto (máx. 6 bullets) destacando: total do período, top fornecedores, variações relevantes, anomalias e recomendações.`,
      messages: [{ role: "user", content: `Dados:\n${ctxText}\n\nResuma agora.` }],
      temperature: 0.3,
      maxOutputTokens: 700,
    });
    return { summary: reply, generated_at: new Date().toISOString() };
  });

export const explainAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { event_id: string }) => data)
  .handler(async ({ data, context }) => {
    const { callGemini } = await import("./gemini-ai.server");
    const { data: ev, error } = await context.supabase
      .from("alert_events")
      .select("title, message, severity, metric_value, threshold, scope, scope_label, created_at, alert_id")
      .eq("id", data.event_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!ev) throw new Error("Evento não encontrado");

    let ruleText = "";
    if (ev.alert_id) {
      const { data: rule } = await context.supabase
        .from("cost_alerts")
        .select("name, metric, comparison, threshold, scope")
        .eq("id", ev.alert_id)
        .maybeSingle();
      if (rule) {
        ruleText = `Regra: ${rule.name} — métrica ${rule.metric} ${rule.comparison} ${rule.threshold} (escopo ${rule.scope}).`;
      }
    }

    const ctxText = await buildCostsContext(context.supabase);
    const prompt = `Alerta disparado:
Título: ${ev.title}
Mensagem: ${ev.message ?? "—"}
Severidade: ${ev.severity}
Valor medido: ${ev.metric_value ?? "—"} · Limite: ${ev.threshold ?? "—"}
Escopo: ${ev.scope ?? "—"} / ${ev.scope_label ?? "—"}
Quando: ${ev.created_at}
${ruleText}

Contexto geral:
${ctxText}

Explique em 3-5 bullets o provável motivo do alerta e sugira 1-2 ações concretas.`;

    const reply = await callGemini({
      system: ASSISTANT_SYSTEM,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      maxOutputTokens: 600,
    });
    return { explanation: reply };
  });
