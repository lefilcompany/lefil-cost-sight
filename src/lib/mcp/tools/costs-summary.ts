import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "costs_summary",
  title: "Resumo de custos por fornecedor",
  description:
    "Retorna o total de custos (USD e BRL) agregados por fornecedor no Quiwi Cost Center, dentro de um intervalo de dias (padrão 30). Use para responder perguntas como 'quanto gastei com OpenAI no último mês?'.",
  inputSchema: {
    days: z
      .number()
      .int()
      .describe("Quantidade de dias a considerar a partir de hoje (ex.: 30). Padrão 30.")
      .optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ days }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado." }], isError: true };
    }
    const window = Math.min(Math.max(days ?? 30, 1), 365);
    const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("cost_entries")
      .select("cost_usd, cost_brl, provider:providers(name)")
      .gte("entry_date", since);

    if (error) {
      return { content: [{ type: "text", text: `Erro: ${error.message}` }], isError: true };
    }

    const agg = new Map<string, { usd: number; brl: number }>();
    for (const r of data ?? []) {
      const name = (r as any).provider?.name ?? "Desconhecido";
      const cur = agg.get(name) ?? { usd: 0, brl: 0 };
      cur.usd += Number((r as any).cost_usd ?? 0);
      cur.brl += Number((r as any).cost_brl ?? 0);
      agg.set(name, cur);
    }

    const byProvider = [...agg.entries()]
      .map(([provider, v]) => ({ provider, cost_usd: +v.usd.toFixed(4), cost_brl: +v.brl.toFixed(2) }))
      .sort((a, b) => b.cost_brl - a.cost_brl);

    const totals = byProvider.reduce(
      (a, b) => ({ cost_usd: a.cost_usd + b.cost_usd, cost_brl: a.cost_brl + b.cost_brl }),
      { cost_usd: 0, cost_brl: 0 },
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ since, days: window, totals, by_provider: byProvider }, null, 2),
        },
      ],
      structuredContent: { since, days: window, totals, by_provider: byProvider },
    };
  },
});
