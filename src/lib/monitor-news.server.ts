// Server-only: OAuth 2.1 (DCR + PKCE) + MCP Streamable HTTP client + sync
// Monitor News endpoint: https://dvuaudcncwzferlagmck.supabase.co
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const MN_BASE = "https://dvuaudcncwzferlagmck.supabase.co";
const MN_AUTH = `${MN_BASE}/auth/v1`;
const MN_MCP = `${MN_BASE}/functions/v1/mcp`;
const AUTH_ENDPOINT = `${MN_AUTH}/oauth/authorize`;
const TOKEN_ENDPOINT = `${MN_AUTH}/oauth/token`;
const REGISTER_ENDPOINT = `${MN_AUTH}/oauth/clients/register`;
const DEFAULT_SCOPE = "openid email profile";

// -----------------------------
// Crypto (AES-256-GCM)
// -----------------------------
function encKey(): Buffer {
  const raw = process.env.MONITOR_NEWS_ENC_KEY;
  if (!raw) throw new Error("MONITOR_NEWS_ENC_KEY não configurado no servidor");
  let buf = /^[A-Za-z0-9+/=]+$/.test(raw) ? Buffer.from(raw, "base64") : Buffer.from(raw, "utf8");
  if (buf.length !== 32) buf = createHash("sha256").update(raw).digest();
  return buf;
}
function enc(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
function dec(cipher: string): string {
  const b = Buffer.from(cipher, "base64");
  const iv = b.subarray(0, 12);
  const tag = b.subarray(12, 28);
  const ct = b.subarray(28);
  const d = createDecipheriv("aes-256-gcm", encKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

// -----------------------------
// PKCE + state helpers
// -----------------------------
function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function newVerifier(): string {
  return base64url(randomBytes(48));
}
export function challengeFor(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

// -----------------------------
// OAuth client registration (DCR)
// -----------------------------
export async function ensureOauthClient(redirectUri: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: existing } = await supabaseAdmin
    .from("monitor_news_oauth_clients")
    .select("*")
    .eq("redirect_uri", redirectUri)
    .maybeSingle();
  if (existing) return existing as any;

  const reg = await fetch(REGISTER_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Quiwi Cost Center",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: DEFAULT_SCOPE,
    }),
  });
  if (!reg.ok) {
    const body = await reg.text();
    throw new Error(`DCR falhou (${reg.status}): ${body.slice(0, 300)}`);
  }
  const registration: any = await reg.json();
  const insertRow: any = {
    redirect_uri: redirectUri,
    client_id: registration.client_id,
    client_secret_ciphertext: registration.client_secret ? enc(registration.client_secret) : null,
    token_endpoint_auth_method: registration.token_endpoint_auth_method ?? "none",
    registration_response: registration,
  };
  const { data, error } = await supabaseAdmin
    .from("monitor_news_oauth_clients")
    .insert(insertRow)
    .select()
    .single();
  if (error) throw error;
  return data as any;
}

// -----------------------------
// Authorization URL
// -----------------------------
export async function buildAuthUrl(userId: string, origin: string) {
  const redirectUri = `${origin}/api/public/hooks/monitor-news-oauth`;
  const client = await ensureOauthClient(redirectUri);
  const verifier = newVerifier();
  const state = base64url(randomBytes(24));

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("monitor_news_oauth_states").insert({
    state,
    user_id: userId,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  });
  if (error) throw error;

  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", client.client_id);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", DEFAULT_SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challengeFor(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return { authorize_url: url.toString() };
}

// -----------------------------
// Token exchange + refresh
// -----------------------------
async function tokenRequest(params: Record<string, string>) {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Token endpoint ${res.status}: ${body.slice(0, 400)}`);
  return JSON.parse(body);
}

export async function completeOauthCallback(state: string, code: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: st, error: stErr } = await supabaseAdmin
    .from("monitor_news_oauth_states")
    .select("*")
    .eq("state", state)
    .maybeSingle();
  if (stErr) throw stErr;
  if (!st) throw new Error("state inválido ou expirado");

  const { data: client } = await supabaseAdmin
    .from("monitor_news_oauth_clients")
    .select("*")
    .eq("redirect_uri", st.redirect_uri)
    .maybeSingle();
  if (!client) throw new Error("client OAuth do Monitor News não encontrado");

  const tok = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: st.redirect_uri,
    client_id: client.client_id,
    code_verifier: st.code_verifier,
  });

  const expiresAt = tok.expires_in
    ? new Date(Date.now() + Number(tok.expires_in) * 1000).toISOString()
    : null;

  const row: any = {
    user_id: st.user_id,
    client_id: client.client_id,
    access_token_ciphertext: enc(tok.access_token),
    refresh_token_ciphertext: tok.refresh_token ? enc(tok.refresh_token) : null,
    token_type: tok.token_type ?? "Bearer",
    scope: tok.scope ?? DEFAULT_SCOPE,
    expires_at: expiresAt,
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error: upErr } = await supabaseAdmin
    .from("monitor_news_connections")
    .upsert(row, { onConflict: "user_id" });
  if (upErr) throw upErr;

  await supabaseAdmin.from("monitor_news_oauth_states").delete().eq("state", state);
  return { ok: true, user_id: st.user_id };
}

async function refreshIfNeeded(conn: any): Promise<{ access_token: string; conn: any }> {
  const nowPlus60 = Date.now() + 60_000;
  const exp = conn.expires_at ? new Date(conn.expires_at).getTime() : 0;
  if (exp && exp > nowPlus60) return { access_token: dec(conn.access_token_ciphertext), conn };
  if (!conn.refresh_token_ciphertext) return { access_token: dec(conn.access_token_ciphertext), conn };

  const refresh = dec(conn.refresh_token_ciphertext);
  const tok = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: conn.client_id,
  });
  const expiresAt = tok.expires_in
    ? new Date(Date.now() + Number(tok.expires_in) * 1000).toISOString()
    : null;
  const patch: any = {
    access_token_ciphertext: enc(tok.access_token),
    refresh_token_ciphertext: tok.refresh_token ? enc(tok.refresh_token) : conn.refresh_token_ciphertext,
    token_type: tok.token_type ?? conn.token_type,
    scope: tok.scope ?? conn.scope,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("monitor_news_connections")
    .update(patch)
    .eq("user_id", conn.user_id)
    .select()
    .single();
  if (error) throw error;
  return { access_token: tok.access_token, conn: data };
}

export async function getActiveConnection() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("monitor_news_connections")
    .select("*")
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as any | null;
}

export async function getBearer(): Promise<{ token: string; conn: any } | null> {
  const conn = await getActiveConnection();
  if (!conn) return null;
  const r = await refreshIfNeeded(conn);
  return { token: r.access_token, conn: r.conn };
}

export async function disconnectMonitorNews(userId?: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const q = supabaseAdmin.from("monitor_news_connections").delete();
  if (userId) await q.eq("user_id", userId);
  else await q.neq("user_id", "00000000-0000-0000-0000-000000000000");
}

// -----------------------------
// Minimal MCP Streamable HTTP client
// -----------------------------
type McpResponse = { result?: any; error?: { code: number; message: string; data?: any } };

async function parseMcpResponse(res: Response): Promise<McpResponse> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) {
    const text = await res.text();
    // pick last "data:" line that parses as JSON with jsonrpc field
    const chunks = text.split(/\r?\n/).filter((l) => l.startsWith("data:"));
    for (let i = chunks.length - 1; i >= 0; i--) {
      const payload = chunks[i].slice(5).trim();
      if (!payload) continue;
      try {
        const j = JSON.parse(payload);
        if (j && (j.result !== undefined || j.error !== undefined)) return j;
      } catch {}
    }
    throw new Error(`Resposta SSE sem payload JSON. Preview: ${text.slice(0, 300)}`);
  }
  if (ct.includes("application/json")) return (await res.json()) as any;
  const t = await res.text();
  throw new Error(`Content-type inesperado (${ct}): ${t.slice(0, 300)}`);
}

class McpClient {
  private sessionId: string | null = null;
  private id = 0;
  private token: string;
  constructor(token: string) {
    this.token = token;
  }
  private async post(body: any): Promise<{ res: Response }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Mcp-Protocol-Version": "2025-06-18",
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    const res = await fetch(MN_MCP, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const sid = res.headers.get("Mcp-Session-Id");
    if (sid) this.sessionId = sid;
    if (res.status === 401) throw new Error("Monitor News rejeitou o token (401). Reconecte.");
    if (!res.ok && res.status !== 202) {
      const t = await res.text();
      throw new Error(`MCP HTTP ${res.status}: ${t.slice(0, 300)}`);
    }
    return { res };
  }
  private nextId() {
    return ++this.id;
  }
  async initialize() {
    const { res } = await this.post({
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "quiwi-cost-center", version: "0.1.0" },
      },
    });
    const parsed = await parseMcpResponse(res);
    if (parsed.error) throw new Error(`initialize: ${parsed.error.message}`);
    // send initialized notification (no id)
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
    return parsed.result;
  }
  async listTools(): Promise<any[]> {
    const { res } = await this.post({
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "tools/list",
      params: {},
    });
    const parsed = await parseMcpResponse(res);
    if (parsed.error) throw new Error(`tools/list: ${parsed.error.message}`);
    return parsed.result?.tools ?? [];
  }
  async callTool(name: string, args: Record<string, any> = {}): Promise<any> {
    const { res } = await this.post({
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "tools/call",
      params: { name, arguments: args },
    });
    const parsed = await parseMcpResponse(res);
    if (parsed.error) throw new Error(`tools/call(${name}): ${parsed.error.message}`);
    return parsed.result;
  }
}

export async function connectMcp() {
  const auth = await getBearer();
  if (!auth) throw new Error("Nenhuma conexão Monitor News ativa. Conecte em Configurações.");
  const client = new McpClient(auth.token);
  await client.initialize();
  return client;
}

// -----------------------------
// Tool discovery: descobre nomes das tools por heurística
// -----------------------------
function score(name: string, patterns: RegExp[]): number {
  const n = name.toLowerCase();
  let s = 0;
  for (const p of patterns) if (p.test(n)) s += 1;
  return s;
}

function pickTool(tools: any[], must: RegExp[], nice: RegExp[] = []): any | null {
  let best: any = null;
  let bestScore = 0;
  for (const t of tools) {
    const nm: string = String(t?.name ?? "");
    if (!nm) continue;
    const mustHit = must.some((p) => p.test(nm.toLowerCase()));
    if (!mustHit) continue;
    const s = 10 + score(nm, nice);
    if (s > bestScore) {
      best = t;
      bestScore = s;
    }
  }
  return best;
}

function extractJson(result: any): any {
  // MCP tool result: { content: [ {type, text|json|...} ], structuredContent?: any }
  if (result?.structuredContent) return result.structuredContent;
  const content = result?.content;
  if (!Array.isArray(content)) return null;
  for (const c of content) {
    if (c?.type === "json" && c.json !== undefined) return c.json;
    if (c?.type === "text" && typeof c.text === "string") {
      try {
        return JSON.parse(c.text);
      } catch {
        // not JSON, ignore
      }
    }
  }
  return null;
}

function coerceList(v: any): any[] {
  if (Array.isArray(v)) return v;
  if (!v || typeof v !== "object") return [];
  for (const k of ["workspaces", "teams", "tenants", "items", "data", "results", "records"]) {
    if (Array.isArray((v as any)[k])) return (v as any)[k];
  }
  return [];
}

// tenta achar workspace id em várias formas
function pickId(w: any): string | null {
  for (const k of ["id", "workspace_id", "workspaceId", "uuid", "slug", "name"]) {
    const v = w?.[k];
    if (v !== undefined && v !== null && String(v).length) return String(v);
  }
  return null;
}
function pickName(w: any): string {
  return String(w?.name ?? w?.workspace_name ?? w?.title ?? w?.slug ?? w?.id ?? "workspace");
}

function pickNumber(o: any, keys: string[]): number | null {
  for (const k of keys) {
    const v = o?.[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

// -----------------------------
// Sync — chamado pelo botão e pelo cron
// -----------------------------
export const MONITOR_NEWS_PERIODS = ["24h", "7d", "30d", "current_month", "90d", "all"] as const;
export type MonitorNewsPeriod = (typeof MONITOR_NEWS_PERIODS)[number];

type SyncMode =
  | { kind: "existing_only" }
  | { kind: "selected"; externalIds: string[] };


export async function debugMonitorNewsTools() {
  const client = await connectMcp();
  const tools = await client.listTools();
  return {
    ok: true as const,
    tools: tools.map((t: any) => ({
      name: t?.name,
      title: t?.title ?? null,
      description: t?.description ?? null,
      inputSchema: t?.inputSchema ?? null,
    })),
  };
}

async function callToolTolerant(client: McpClient, name: string) {
  const attempts: any[] = [{}, { limit: 100 }, { page: 1, per_page: 100 }, { pageSize: 100 }];
  let lastErr: any;
  for (const args of attempts) {
    try {
      const r = await client.callTool(name, args);
      return { result: r, args };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("tool call failed");
}

export async function listWorkspacesFromMcp() {
  const client = await connectMcp();

  let wsRes: any;
  try {
    wsRes = await client.callTool("workspaces_list", { active: true });
  } catch (e: any) {
    return {
      ok: false as const,
      message: `Falha ao chamar workspaces_list: ${e?.message ?? e}`,
      tools: [] as string[],
      workspaces: [],
    };
  }

  const payload = extractJson(wsRes);
  const raw = Array.isArray(payload?.workspaces) ? payload.workspaces : coerceList(payload);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: existing } = await supabaseAdmin
    .from("clients")
    .select("id, external_id, name")
    .eq("external_source", "monitor_news");
  const existingMap = new Map<string, { id: string; name: string }>();
  for (const c of existing ?? [])
    if (c.external_id) existingMap.set(String(c.external_id), { id: c.id, name: c.name });

  const workspaces = raw
    .map((w: any) => {
      const external_id = pickId(w);
      if (!external_id) return null;
      const name = pickName(w);
      const match = existingMap.get(external_id);
      return {
        external_id,
        name,
        already_imported: !!match,
        client_id: match?.id ?? null,
        raw: w,
      };
    })
    .filter(Boolean) as Array<{
      external_id: string;
      name: string;
      already_imported: boolean;
      client_id: string | null;
      raw: any;
    }>;

  if (workspaces.length === 0) {
    return {
      ok: false as const,
      message:
        `workspaces_list respondeu, mas não foi possível extrair workspaces. Amostra: ${JSON.stringify(payload ?? wsRes).slice(0, 500)}`,
      tools: ["workspaces_list"],
      workspace_tool: "workspaces_list",
      workspaces: [],
    };
  }

  return {
    ok: true as const,
    tools: ["workspaces_list"],
    workspace_tool: "workspaces_list",
    workspaces,
  };
}


async function syncCore(mode: SyncMode, triggeredByUser?: string, period: MonitorNewsPeriod = "current_month") {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: logRow } = await supabaseAdmin
    .from("sync_logs")
    .insert({
      started_at: new Date().toISOString(),
      status: "started",
      metadata: { job: "monitor-news", mode: mode.kind, period, triggered_by: triggeredByUser ?? "cron" },
    })
    .select()
    .single();
  const logId = logRow?.id;

  const startedMs = Date.now();

  async function finalize(patch: Record<string, any>) {
    if (!logId) return;
    await supabaseAdmin
      .from("sync_logs")
      .update({
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedMs,
        ...patch,
      })
      .eq("id", logId);
  }

  try {
    const client = await connectMcp();

    // 1) Workspaces (tool oficial: workspaces_list)
    const wsRes = await client.callTool("workspaces_list", { active: true });
    const wsPayload = extractJson(wsRes);
    const workspaces: any[] = Array.isArray(wsPayload?.workspaces)
      ? wsPayload.workspaces
      : coerceList(wsPayload);

    const { data: existingClients } = await supabaseAdmin
      .from("clients")
      .select("id, external_id")
      .eq("external_source", "monitor_news");
    const existingIds = new Set((existingClients ?? []).map((c) => String(c.external_id)));

    const selectedSet = mode.kind === "selected" ? new Set(mode.externalIds) : null;
    const targets = workspaces.filter((w: any) => {
      const id = pickId(w);
      if (!id) return false;
      if (selectedSet) return selectedSet.has(id);
      return existingIds.has(id);
    });

    // 2) Custos (tool oficial: costs_list — retorna todos os workspaces do usuário)
    const costsByWs = new Map<string, any>();
    try {
      const costsRes = await client.callTool("costs_list", { period });
      const costsPayload = extractJson(costsRes);
      const costsRows: any[] = Array.isArray(costsPayload?.workspaces)
        ? costsPayload.workspaces
        : Array.isArray(costsPayload?.items)
          ? costsPayload.items
          : coerceList(costsPayload);
      for (const c of costsRows) {
        const id = pickId(c) || String(c?.workspace_id ?? "");
        if (id) costsByWs.set(id, c);
      }
    } catch (e) {
      // costs_list falhou — cai no fallback per-workspace via costs_get
    }


    const { data: rateRow } = await supabaseAdmin
      .from("system_settings")
      .select("value")
      .eq("key", "usd_brl_rate")
      .maybeSingle();
    const usdRate = Number((rateRow?.value as any)?.rate) || 1;

    const { data: existingPlatform } = await supabaseAdmin
      .from("platforms")
      .select("*")
      .eq("name", "Monitor News")
      .maybeSingle();
    let platformId = existingPlatform?.id as string | undefined;
    if (!platformId) {
      const { data: newPlat, error: platErr } = await supabaseAdmin
        .from("platforms")
        .insert({
          name: "Monitor News",
          description: "Workspaces sincronizados via MCP Monitor News",
          status: "active",
          color: "#7C3AED",
          icon: "newspaper",
        })
        .select("id")
        .single();
      if (platErr) throw platErr;
      platformId = newPlat.id;
    }

    const { data: existingProv } = await supabaseAdmin
      .from("providers")
      .select("id")
      .eq("name", "Monitor News")
      .maybeSingle();
    let providerId = existingProv?.id as string | undefined;
    if (!providerId) {
      const { data: newProv, error: provErr } = await supabaseAdmin
        .from("providers")
        .insert({ name: "Monitor News", category: "media", status: "active" })
        .select("id")
        .single();
      if (provErr) throw provErr;
      providerId = newProv.id;
    }

    const today = new Date().toISOString().slice(0, 10);
    let clientsUpserted = 0;
    let usageRows = 0;
    const perWorkspace: any[] = [];

    for (const w of targets) {
      const externalId = pickId(w);
      if (!externalId) continue;
      const wsName = pickName(w);

      const { data: existingClient } = await supabaseAdmin
        .from("clients")
        .select("id")
        .eq("external_source", "monitor_news")
        .eq("external_id", externalId)
        .maybeSingle();
      let clientId = existingClient?.id as string | undefined;
      if (clientId) {
        await supabaseAdmin
          .from("clients")
          .update({ name: wsName, company: wsName, metadata: w, status: "active" })
          .eq("id", clientId);
      } else {
        const { data: newClient, error: cErr } = await supabaseAdmin
          .from("clients")
          .insert({
            name: wsName,
            company: wsName,
            status: "active",
            external_source: "monitor_news",
            external_id: externalId,
            metadata: w,
          })
          .select("id")
          .single();
        if (cErr) throw cErr;
        clientId = newClient.id;
      }
      clientsUpserted++;

      // Obtém uso: primeiro do costs_list agregado, senão fallback costs_get
      let usage: any = costsByWs.get(externalId) ?? null;
      if (!usage) {
        try {
          const u = await client.callTool("costs_get", {
            workspace_id: externalId,
            period,
          });

          usage = extractJson(u);
        } catch (e: any) {
          perWorkspace.push({
            workspace: wsName,
            external_id: externalId,
            error: String(e?.message ?? e),
          });
          continue;
        }
      }
      if (!usage) {
        perWorkspace.push({ workspace: wsName, external_id: externalId, error: "sem uso" });
        continue;
      }

      // Campos oficiais do Monitor News: credits_used, cost_usd, cost_brl (pode ser null),
      // credits_included / credits_remaining (sempre null — cobrança é por conta, não workspace).
      const creditsUsed = pickNumber(usage, ["credits_used"]);
      const creditsIncluded = pickNumber(usage, ["credits_included"]);
      const creditsRemaining = pickNumber(usage, ["credits_remaining"]);
      const costUsd = pickNumber(usage, ["cost_usd"]) ?? 0;
      const costBrlRaw = pickNumber(usage, ["cost_brl"]);
      const costBrl =
        costBrlRaw != null ? costBrlRaw : Number((costUsd * usdRate).toFixed(2));

      const { data: existingEntry } = await supabaseAdmin
        .from("cost_entries")
        .select("id")
        .eq("client_id", clientId!)
        .eq("entry_date", today)
        .eq("provider_id", providerId!)
        .eq("origin", "monitor_news")
        .maybeSingle();
      const entryPayload: any = {
        provider_id: providerId,
        platform_id: platformId,
        client_id: clientId,
        description: `Monitor News · ${wsName}`,
        usage_quantity: creditsUsed ?? null,
        usage_unit: creditsUsed != null ? "credits" : null,
        cost_usd: costUsd,
        exchange_rate: usdRate,
        cost_brl: costBrl,
        origin: "monitor_news",
        entry_date: today,
        metadata: {
          workspace_id: externalId,
          workspace_name: wsName,
          period,
          credits_used: creditsUsed,
          credits_included: creditsIncluded,
          credits_remaining: creditsRemaining,
        },
        raw_response: usage,
      };
      if (existingEntry) {
        await supabaseAdmin.from("cost_entries").update(entryPayload).eq("id", existingEntry.id);
      } else {
        await supabaseAdmin.from("cost_entries").insert(entryPayload);
      }

      const { data: existingUsage } = await supabaseAdmin
        .from("provider_usage_daily")
        .select("id")
        .eq("provider_id", providerId!)
        .eq("platform_id", platformId!)
        .eq("usage_date", today)
        .eq("endpoint", `workspace:${externalId}`)
        .maybeSingle();
      const usagePayload: any = {
        provider_id: providerId,
        platform_id: platformId,
        usage_date: today,
        model: null,
        endpoint: `workspace:${externalId}`,
        input_tokens: 0,
        output_tokens: 0,
        requests: 0,
        quantity: creditsUsed ?? null,
        unit: "credits",
        cost_usd: costUsd,
        exchange_rate: usdRate,
        cost_brl: costBrl,
        raw: {
          workspace_id: externalId,
          workspace_name: wsName,
          credits_used: creditsUsed,
          credits_included: creditsIncluded,
          credits_remaining: creditsRemaining,
          usage,
        },
        synced_at: new Date().toISOString(),
      };
      if (existingUsage) {
        await supabaseAdmin
          .from("provider_usage_daily")
          .update(usagePayload)
          .eq("id", existingUsage.id);
      } else {
        await supabaseAdmin.from("provider_usage_daily").insert(usagePayload);
      }
      usageRows++;

      perWorkspace.push({
        workspace: wsName,
        external_id: externalId,
        credits_used: creditsUsed,
        credits_remaining: creditsRemaining,
        cost_usd: costUsd,
        cost_brl: costBrl,
      });
    }

    await finalize({
      status: "success",
      records_imported: usageRows,
      metadata: {
        job: "monitor-news",
        mode: mode.kind,
        period,
        picked: { workspaces_tool: "workspaces_list", costs_tool: "costs_list" },
        clients_upserted: clientsUpserted,
        usage_rows: usageRows,
        per_workspace: perWorkspace.slice(0, 50),
      },
    });

    return {
      ok: true,
      clients: clientsUpserted,
      usage_rows: usageRows,
      period,
      tools: ["workspaces_list", "costs_list", "costs_get"],
      picked: { workspaces_tool: "workspaces_list", costs_tool: "costs_list" },
      per_workspace: perWorkspace,
    };
  } catch (err: any) {
    await finalize({ status: "error", error_message: String(err?.message ?? err) });
    return { ok: false, message: String(err?.message ?? err) };
  }
}


export async function syncMonitorNews(triggeredByUser?: string, period: MonitorNewsPeriod = "current_month") {
  return syncCore({ kind: "existing_only" }, triggeredByUser, period);
}

export async function importMonitorNewsWorkspaces(externalIds: string[], triggeredByUser?: string, period: MonitorNewsPeriod = "current_month") {
  return syncCore({ kind: "selected", externalIds }, triggeredByUser, period);
}

