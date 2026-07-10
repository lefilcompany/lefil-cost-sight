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
  name: "list_providers",
  title: "Listar fornecedores conectados",
  description:
    "Lista todos os fornecedores (OpenAI, Gemini, Firecrawl, Google Cloud, Supabase, ElevenLabs) conectados no Quiwi Cost Center, com status da conexão e data do último sync.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("provider_connections")
      .select("id, name, status, last_sync_at, config, provider:providers(name, category)")
      .order("created_at", { ascending: true });

    if (error) {
      return { content: [{ type: "text", text: `Erro: ${error.message}` }], isError: true };
    }

    const rows = (data ?? []).map((r: any) => ({
      id: r.id,
      name: r.name,
      provider: r.provider?.name ?? null,
      category: r.provider?.category ?? null,
      status: r.status,
      last_sync_at: r.last_sync_at,
      monthly_plan_usd: r.config?.monthly_plan_usd ?? null,
      plan_name: r.config?.plan_name ?? null,
    }));

    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      structuredContent: { connections: rows },
    };
  },
});
