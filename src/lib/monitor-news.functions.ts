import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const startMonitorNewsOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { origin: string }) => z.object({ origin: z.string().url() }).parse(input))
  .handler(async ({ data, context }) => {
    const mn = await import("./monitor-news.server");
    const redirectUri = `${data.origin.replace(/\/$/, "")}/monitor-news/callback`;
    const url = await mn.buildAuthorizeUrl({ redirectUri, userId: context.userId });
    return { authorizeUrl: url };
  });

export const completeMonitorNewsOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { code: string; state: string }) =>
    z.object({ code: z.string().min(1), state: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const mn = await import("./monitor-news.server");
    await mn.exchangeCodeForTokens({ userId: context.userId, code: data.code, state: data.state });
    return { ok: true };
  });

export const getMonitorNewsStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const mn = await import("./monitor-news.server");
    return mn.getConnectionStatus(context.userId);
  });

export const disconnectMonitorNews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const mn = await import("./monitor-news.server");
    await mn.disconnect(context.userId);
    return { ok: true };
  });

export const listMonitorNewsTools = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const mn = await import("./monitor-news.server");
    const tools = await mn.listMcpTools(context.userId);
    return { tools: JSON.parse(JSON.stringify(tools)) as unknown[] } as any;
  });

export const callMonitorNewsTool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string; args?: Record<string, unknown> }) =>
    z
      .object({ name: z.string().min(1), args: z.record(z.string(), z.unknown()).optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const mn = await import("./monitor-news.server");
    const result = await mn.callMcpTool(context.userId, data.name, data.args ?? {});
    return { result, payload: mn.extractPayload(result) };
  });

// Import Monitor News workspaces as Quiwi clients.
// Uses heuristics to pick which MCP tools list workspaces / credits / costs.
export const importMonitorNewsWorkspaces = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    workspacesTool?: string;
    creditsTool?: string;
    costsTool?: string;
  }) =>
    z
      .object({
        workspacesTool: z.string().optional(),
        creditsTool: z.string().optional(),
        costsTool: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const mn = await import("./monitor-news.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const tools = await mn.listMcpTools(context.userId);
    const toolNames = tools.map((t) => t.name);
    const pick = (explicit: string | undefined, patterns: RegExp[]) => {
      if (explicit) {
        if (!toolNames.includes(explicit))
          throw new Error(`Ferramenta MCP não encontrada: ${explicit}`);
        return explicit;
      }
      for (const re of patterns) {
        const hit = tools.find((t) => re.test(t.name));
        if (hit) return hit.name;
      }
      return null;
    };
    const workspacesTool = pick(data.workspacesTool, [
      /list.*workspace/i,
      /workspace.*list/i,
      /workspaces?$/i,
      /get.*workspace/i,
    ]);
    if (!workspacesTool) {
      throw new Error(
        `Não achei uma ferramenta para listar workspaces. Ferramentas disponíveis: ${toolNames.join(", ")}. Passe { workspacesTool } explicitamente.`,
      );
    }
    const creditsTool = pick(data.creditsTool, [/credit/i, /balance/i, /quota/i]);
    const costsTool = pick(data.costsTool, [/cost/i, /billing/i, /spend/i, /usage/i]);

    const wsRes = await mn.callMcpTool(context.userId, workspacesTool, {});
    const wsPayload = mn.extractPayload(wsRes) as unknown;
    const workspaces = normalizeWorkspaces(wsPayload);
    if (workspaces.length === 0) {
      return { imported: 0, updated: 0, workspaces: [], toolNames, workspacesTool };
    }

    // Resolve organization for the current user
    const { data: memberRow } = await supabaseAdmin
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", context.userId)
      .eq("status", "active")
      .order("joined_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!memberRow) throw new Error("Usuário sem organização ativa.");
    const orgId = memberRow.organization_id;

    let imported = 0;
    let updated = 0;
    const summary: Array<{
      workspace_id: string;
      name: string;
      credits?: unknown;
      costs?: unknown;
      client_id: string;
    }> = [];

    for (const ws of workspaces) {
      // Fetch credits/costs (best-effort)
      let credits: unknown = null;
      let costs: unknown = null;
      if (creditsTool) {
        try {
          const r = await mn.callMcpTool(context.userId, creditsTool, buildArgs(ws.id));
          credits = mn.extractPayload(r);
        } catch (e) {
          credits = { error: (e as Error).message };
        }
      }
      if (costsTool) {
        try {
          const r = await mn.callMcpTool(context.userId, costsTool, buildArgs(ws.id));
          costs = mn.extractPayload(r);
        } catch (e) {
          costs = { error: (e as Error).message };
        }
      }

      // Upsert client
      const { data: existing } = await supabaseAdmin
        .from("clients")
        .select("id")
        .eq("organization_id", orgId)
        .eq("external_source", "monitor_news")
        .eq("external_id", ws.id)
        .maybeSingle();

      const payload = {
        organization_id: orgId,
        name: ws.name,
        company: ws.company ?? null,
        status: ws.status ?? "active",
        external_source: "monitor_news" as const,
        external_id: ws.id,
        metadata: {
          workspace: ws.raw,
          credits,
          costs,
          synced_at: new Date().toISOString(),
        } as never,
        owner_user_id: context.userId,
      };

      if (existing) {
        await supabaseAdmin.from("clients").update(payload).eq("id", existing.id);
        updated++;
        summary.push({ workspace_id: ws.id, name: ws.name, credits, costs, client_id: existing.id });
      } else {
        const { data: inserted } = await supabaseAdmin
          .from("clients")
          .insert(payload)
          .select("id")
          .single();
        imported++;
        summary.push({
          workspace_id: ws.id,
          name: ws.name,
          credits,
          costs,
          client_id: inserted?.id ?? "",
        });
      }
    }

    return {
      imported,
      updated,
      workspaces: summary,
      toolNames,
      workspacesTool,
      creditsTool,
      costsTool,
    };
  });

function buildArgs(workspaceId: string): Record<string, unknown> {
  // Send workspace id under common parameter names — the MCP will ignore extras.
  return {
    workspace_id: workspaceId,
    workspaceId,
    id: workspaceId,
  };
}

type NormalizedWorkspace = {
  id: string;
  name: string;
  company?: string | null;
  status?: string;
  raw: unknown;
};

function normalizeWorkspaces(payload: unknown): NormalizedWorkspace[] {
  if (!payload) return [];
  const list = extractArray(payload);
  return list
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const obj = item as Record<string, unknown>;
      const id =
        (obj.id as string | undefined) ??
        (obj.workspace_id as string | undefined) ??
        (obj.uuid as string | undefined) ??
        (obj.slug as string | undefined);
      if (!id) return null;
      const name =
        (obj.name as string | undefined) ??
        (obj.title as string | undefined) ??
        (obj.workspace_name as string | undefined) ??
        String(id);
      const ws: NormalizedWorkspace = {
        id: String(id),
        name,
        company:
          (obj.company as string | undefined) ??
          (obj.organization as string | undefined) ??
          null,
        status: (obj.status as string | undefined) ?? "active",
        raw: obj,
      };
      return ws;
    })
    .filter((v): v is NormalizedWorkspace => v !== null);
}

function extractArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["workspaces", "items", "data", "results", "rows", "list"]) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
    // Single object → wrap
    if (obj.id || obj.workspace_id) return [obj];
  }
  return [];
}
