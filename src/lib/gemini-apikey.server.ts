// Gemini via API Key (Google AI Studio — generativelanguage.googleapis.com).
// Fluxo simplificado (sem service account / BigQuery):
//  - Valida a chave chamando ListModels.
//  - Agrega `gemini_usage_events` do período em cost_entries + provider_usage_daily.
//  - Opcionalmente adiciona custo fixo mensal (config.plan_monthly_usd) quando não há eventos.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type SyncOutcome = {
  status: "success" | "skipped" | "error";
  records: number;
  message?: string;
  meta?: Record<string, any>;
};

async function getConnectionKey(connectionId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc("get_connection_api_key_internal", {
    _connection_id: connectionId,
  });
  if (error) throw new Error(`vault: ${error.message}`);
  return (data as string) ?? null;
}

function isoDate(d: Date | string): string {
  return (typeof d === "string" ? new Date(d) : d).toISOString().slice(0, 10);
}

async function validateApiKey(apiKey: string): Promise<{ models: number }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API Key inválida (${res.status}): ${body.slice(0, 300)}`);
  }
  const json: any = await res.json();
  const models = Array.isArray(json?.models) ? json.models.length : 0;
  return { models };
}

export async function syncGeminiApiKey(conn: any, rate: number): Promise<SyncOutcome> {
  const apiKey = await getConnectionKey(conn.id);
  if (!apiKey) {
    return {
      status: "skipped",
      records: 0,
      message: "API Key do Gemini não configurada. Edite a conexão e cole a chave.",
    };
  }

  // 1) Valida a chave.
  let validation: { models: number };
  try {
    validation = await validateApiKey(apiKey);
  } catch (e: any) {
    throw new Error(e.message ?? "Falha ao validar API Key do Gemini");
  }

  // 2) Janela: últimos 30 dias.
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86400_000);
  const startDate = isoDate(since);
  const endDate = isoDate(now);

  // 3) Agrega gemini_usage_events da conexão no período.
  const { data: events, error: evErr } = await supabaseAdmin
    .from("gemini_usage_events")
    .select("occurred_at, model, prompt_tokens, output_tokens, thinking_tokens, cached_tokens, total_tokens, estimated_cost, currency")
    .eq("provider_connection_id", conn.id)
    .gte("occurred_at", since.toISOString())
    .lte("occurred_at", now.toISOString())
    .limit(50000);
  if (evErr) throw new Error(`gemini_usage_events: ${evErr.message}`);

  // Limpa janela de re-escrita.
  await supabaseAdmin
    .from("cost_entries")
    .delete()
    .eq("provider_id", conn.provider_id)
    .gte("entry_date", startDate)
    .lte("entry_date", endDate)
    .contains("metadata", { connection_id: conn.id, source: "gemini_apikey" });

  await supabaseAdmin
    .from("provider_usage_daily")
    .delete()
    .eq("connection_id", conn.id)
    .gte("usage_date", startDate)
    .lte("usage_date", endDate);

  type DailyKey = string; // `${day}__${model}`
  const perDayModel = new Map<DailyKey, {
    day: string;
    model: string;
    cost: number;
    prompt: number;
    output: number;
    thinking: number;
    cached: number;
    total: number;
    requests: number;
  }>();
  const perDay = new Map<string, number>();
  let totalUsd = 0;

  for (const ev of events ?? []) {
    const day = isoDate(ev.occurred_at as any);
    const model = (ev.model as string) ?? "unknown";
    const cost = Number(ev.estimated_cost ?? 0);
    const key: DailyKey = `${day}__${model}`;
    const cur = perDayModel.get(key) ?? {
      day, model, cost: 0, prompt: 0, output: 0, thinking: 0, cached: 0, total: 0, requests: 0,
    };
    cur.cost += cost;
    cur.prompt += Number(ev.prompt_tokens ?? 0);
    cur.output += Number(ev.output_tokens ?? 0);
    cur.thinking += Number(ev.thinking_tokens ?? 0);
    cur.cached += Number(ev.cached_tokens ?? 0);
    cur.total += Number(ev.total_tokens ?? 0);
    cur.requests += 1;
    perDayModel.set(key, cur);
    perDay.set(day, (perDay.get(day) ?? 0) + cost);
    totalUsd += cost;
  }

  const dailyRows = Array.from(perDayModel.values()).map((r) => ({
    provider_id: conn.provider_id,
    platform_id: conn.platform_id,
    connection_id: conn.id,
    usage_date: r.day,
    model: r.model,
    endpoint: "generativelanguage",
    input_tokens: r.prompt,
    output_tokens: r.output,
    requests: r.requests,
    quantity: r.total,
    unit: "tokens",
    cost_usd: r.cost,
    exchange_rate: rate,
    cost_brl: r.cost * rate,
    raw: {
      thinking_tokens: r.thinking,
      cached_tokens: r.cached,
      source: "gemini_usage_events",
    } as any,
    synced_at: new Date().toISOString(),
  }));

  if (dailyRows.length) {
    const { error: dErr } = await supabaseAdmin.from("provider_usage_daily").insert(dailyRows);
    if (dErr) throw new Error(`provider_usage_daily: ${dErr.message}`);
  }

  const entries = Array.from(perDay.entries())
    .filter(([, usd]) => usd > 0.0001)
    .map(([day, usd]) => ({
      provider_id: conn.provider_id,
      platform_id: conn.platform_id,
      description: `Gemini — ${day}`,
      entry_date: day,
      cost_usd: usd,
      exchange_rate: rate,
      cost_brl: usd * rate,
      origin: "api",
      metadata: { connection_id: conn.id, source: "gemini_apikey" },
    }));

  if (entries.length) {
    const { error: eErr } = await supabaseAdmin.from("cost_entries").insert(entries);
    if (eErr) throw new Error(`cost_entries: ${eErr.message}`);
  }

  // 4) Fallback opcional: plano mensal fixo (quando não há eventos).
  const cfg = (conn.config ?? {}) as any;
  const planMonthlyUsd = Number(cfg.plan_monthly_usd ?? 0);
  const planName = cfg.plan_name ?? "Gemini API";
  let fixedAdded = 0;
  if (planMonthlyUsd > 0 && entries.length === 0) {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    await supabaseAdmin
      .from("cost_entries")
      .delete()
      .eq("provider_id", conn.provider_id)
      .eq("origin", "api")
      .contains("metadata", { connection_id: conn.id, source: "gemini_fixed" });
    await supabaseAdmin.from("cost_entries").insert({
      provider_id: conn.provider_id,
      platform_id: conn.platform_id,
      description: `Gemini — ${planName} · ciclo ${isoDate(monthStart)}→${isoDate(now)}`,
      entry_date: isoDate(monthStart),
      cost_usd: planMonthlyUsd,
      exchange_rate: rate,
      cost_brl: planMonthlyUsd * rate,
      origin: "api",
      metadata: {
        connection_id: conn.id,
        source: "gemini_fixed",
        plan_name: planName,
        plan_monthly_usd: planMonthlyUsd,
      },
    });
    totalUsd = planMonthlyUsd;
    fixedAdded = 1;
  }

  await supabaseAdmin.from("provider_usage_syncs").insert({
    provider_id: conn.provider_id,
    platform_id: conn.platform_id,
    period_start: startDate,
    period_end: endDate,
    usage_quantity: null,
    usage_unit: "usd",
    cost_usd: totalUsd,
    exchange_rate: rate,
    cost_brl: totalUsd * rate,
    raw_response: {
      mode: "api_key",
      models_available: validation.models,
      events_count: events?.length ?? 0,
      fixed_plan_added: fixedAdded,
      plan_name: planName,
    } as any,
  });

  const msg = entries.length > 0
    ? `${entries.length} dias importados · US$ ${totalUsd.toFixed(2)} · ${events?.length ?? 0} eventos`
    : fixedAdded
      ? `Sem eventos no período. Registrado plano fixo: ${planName} — US$ ${planMonthlyUsd.toFixed(2)}/mês.`
      : `Chave válida (${validation.models} modelos). Sem eventos registrados em gemini_usage_events e sem plano fixo configurado.`;

  return {
    status: "success",
    records: entries.length + fixedAdded,
    message: msg,
    meta: {
      mode: "api_key",
      models_available: validation.models,
      events_count: events?.length ?? 0,
      total_usd: totalUsd,
    },
  };
}
