// Server-only Monitor News OAuth + MCP client.
// Never import from client/browser code.
import { createHash, randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "./monitor-news-crypto.server";

const MN_ISSUER = "https://dvuaudcncwzferlagmck.supabase.co/auth/v1";
const MN_MCP_URL = "https://dvuaudcncwzferlagmck.supabase.co/functions/v1/mcp";
const MN_AUTHORIZE = `${MN_ISSUER}/oauth/authorize`;
const MN_TOKEN = `${MN_ISSUER}/oauth/token`;
const MN_REGISTER = `${MN_ISSUER}/oauth/clients/register`;
const MN_SCOPE = "openid email profile";

// ---------- Utilities ----------
function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function newPkce() {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}
export function newState() {
  return base64url(randomBytes(24));
}

// ---------- Admin Supabase ----------
async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

// ---------- OAuth client (DCR) ----------
export type MnClient = {
  client_id: string;
  client_secret?: string | null;
  token_endpoint_auth_method: string;
};

export async function ensureOAuthClient(redirectUri: string): Promise<MnClient> {
  const sb = await admin();
  const { data: existing } = await sb
    .from("monitor_news_oauth_clients")
    .select("client_id, client_secret_ciphertext, token_endpoint_auth_method")
    .eq("redirect_uri", redirectUri)
    .maybeSingle();
  if (existing) {
    return {
      client_id: existing.client_id,
      client_secret: existing.client_secret_ciphertext
        ? decryptSecret(existing.client_secret_ciphertext)
        : null,
      token_endpoint_auth_method: existing.token_endpoint_auth_method,
    };
  }

  // Dynamic client registration
  const body = {
    client_name: "Quiwi Cost Center",
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: MN_SCOPE,
    token_endpoint_auth_method: "none",
  };
  const res = await fetch(MN_REGISTER, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`DCR failed (${res.status}): ${text.slice(0, 300)}`);
  const json = JSON.parse(text) as {
    client_id: string;
    client_secret?: string;
    token_endpoint_auth_method?: string;
  };
  const authMethod = json.token_endpoint_auth_method ?? (json.client_secret ? "client_secret_post" : "none");

  await sb.from("monitor_news_oauth_clients").insert({
    redirect_uri: redirectUri,
    client_id: json.client_id,
    client_secret_ciphertext: json.client_secret ? encryptSecret(json.client_secret) : null,
    token_endpoint_auth_method: authMethod,
    registration_response: json as unknown as Record<string, unknown>,
  });

  return {
    client_id: json.client_id,
    client_secret: json.client_secret ?? null,
    token_endpoint_auth_method: authMethod,
  };
}

// ---------- Authorization URL ----------
export async function buildAuthorizeUrl(params: {
  redirectUri: string;
  userId: string;
}): Promise<string> {
  const client = await ensureOAuthClient(params.redirectUri);
  const { verifier, challenge } = newPkce();
  const state = newState();
  const sb = await admin();
  // Cleanup old states for this user
  await sb.from("monitor_news_oauth_states").delete().eq("user_id", params.userId);
  await sb.from("monitor_news_oauth_states").insert({
    state,
    user_id: params.userId,
    code_verifier: verifier,
    redirect_uri: params.redirectUri,
  });
  const url = new URL(MN_AUTHORIZE);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", client.client_id);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", MN_SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

// ---------- Token exchange ----------
type TokenResp = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
};

async function postToken(body: URLSearchParams, client: MnClient): Promise<TokenResp> {
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (client.token_endpoint_auth_method === "client_secret_basic" && client.client_secret) {
    const basic = Buffer.from(`${client.client_id}:${client.client_secret}`).toString("base64");
    headers.Authorization = `Basic ${basic}`;
  } else if (client.token_endpoint_auth_method === "client_secret_post" && client.client_secret) {
    body.set("client_id", client.client_id);
    body.set("client_secret", client.client_secret);
  } else {
    body.set("client_id", client.client_id);
  }
  const res = await fetch(MN_TOKEN, { method: "POST", headers, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`Token endpoint (${res.status}): ${text.slice(0, 300)}`);
  return JSON.parse(text) as TokenResp;
}

export async function exchangeCodeForTokens(params: {
  userId: string;
  code: string;
  state: string;
}): Promise<void> {
  const sb = await admin();
  const { data: stateRow, error: stateErr } = await sb
    .from("monitor_news_oauth_states")
    .select("code_verifier, redirect_uri, user_id")
    .eq("state", params.state)
    .maybeSingle();
  if (stateErr) throw stateErr;
  if (!stateRow) throw new Error("Estado OAuth inválido ou expirado.");
  if (stateRow.user_id !== params.userId)
    throw new Error("Estado OAuth pertence a outro usuário.");

  const client = await ensureOAuthClient(stateRow.redirect_uri);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: stateRow.redirect_uri,
    code_verifier: stateRow.code_verifier,
  });
  const tokens = await postToken(body, client);

  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + (tokens.expires_in - 30) * 1000).toISOString()
    : null;

  await sb
    .from("monitor_news_connections")
    .upsert({
      user_id: params.userId,
      client_id: client.client_id,
      access_token_ciphertext: encryptSecret(tokens.access_token),
      refresh_token_ciphertext: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
      token_type: tokens.token_type ?? "Bearer",
      scope: tokens.scope ?? MN_SCOPE,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    });

  await sb.from("monitor_news_oauth_states").delete().eq("state", params.state);
}

// ---------- Access token retrieval + refresh ----------
export async function getValidAccessToken(userId: string): Promise<string> {
  const sb = await admin();
  const { data, error } = await sb
    .from("monitor_news_connections")
    .select(
      "client_id, access_token_ciphertext, refresh_token_ciphertext, expires_at",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Monitor News não conectado para este usuário.");

  const isExpired = data.expires_at ? new Date(data.expires_at).getTime() < Date.now() : false;
  if (!isExpired) return decryptSecret(data.access_token_ciphertext);

  if (!data.refresh_token_ciphertext) throw new Error("Token expirado — reconecte o Monitor News.");
  // Refresh
  const { data: clientRow } = await sb
    .from("monitor_news_oauth_clients")
    .select("client_id, client_secret_ciphertext, token_endpoint_auth_method")
    .eq("client_id", data.client_id)
    .maybeSingle();
  if (!clientRow) throw new Error("Cliente OAuth do Monitor News não encontrado.");
  const client: MnClient = {
    client_id: clientRow.client_id,
    client_secret: clientRow.client_secret_ciphertext
      ? decryptSecret(clientRow.client_secret_ciphertext)
      : null,
    token_endpoint_auth_method: clientRow.token_endpoint_auth_method,
  };
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: decryptSecret(data.refresh_token_ciphertext),
  });
  const tokens = await postToken(body, client);
  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + (tokens.expires_in - 30) * 1000).toISOString()
    : null;
  await sb
    .from("monitor_news_connections")
    .update({
      access_token_ciphertext: encryptSecret(tokens.access_token),
      refresh_token_ciphertext: tokens.refresh_token
        ? encryptSecret(tokens.refresh_token)
        : data.refresh_token_ciphertext,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  return tokens.access_token;
}

// ---------- MCP client ----------
type JsonRpcResponse<T = unknown> = {
  jsonrpc: "2.0";
  id: number | string;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
};

async function parseMcpResponse<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 300)}`);
  let json: JsonRpcResponse<T> | null = null;
  if (ct.includes("application/json")) {
    json = JSON.parse(text) as JsonRpcResponse<T>;
  } else if (ct.includes("text/event-stream")) {
    // Grab the last `data: {...}` chunk
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        const payload = line.slice(5).trim();
        if (payload) json = JSON.parse(payload) as JsonRpcResponse<T>;
      }
    }
  } else if (text.trim().startsWith("{")) {
    json = JSON.parse(text) as JsonRpcResponse<T>;
  }
  if (!json) throw new Error(`MCP resposta inesperada: ${text.slice(0, 200)}`);
  if (json.error) throw new Error(`MCP erro: ${json.error.message}`);
  return json.result as T;
}

let rpcId = 0;
function nextId() {
  return ++rpcId;
}

async function mcpFetch<T>(
  accessToken: string,
  body: Record<string, unknown>,
  sessionId?: string,
): Promise<{ result: T; sessionId?: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${accessToken}`,
    "MCP-Protocol-Version": "2025-06-18",
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const res = await fetch(MN_MCP_URL, { method: "POST", headers, body: JSON.stringify(body) });
  const newSession = res.headers.get("mcp-session-id") ?? sessionId;
  const result = await parseMcpResponse<T>(res);
  return { result, sessionId: newSession ?? undefined };
}

async function mcpSession(accessToken: string): Promise<string | undefined> {
  const init = await mcpFetch<unknown>(accessToken, {
    jsonrpc: "2.0",
    id: nextId(),
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "quiwi-cost-center", version: "0.1.0" },
    },
  });
  // Send initialized notification (best-effort)
  try {
    await fetch(MN_MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${accessToken}`,
        "MCP-Protocol-Version": "2025-06-18",
        ...(init.sessionId ? { "Mcp-Session-Id": init.sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
  } catch {
    /* ignore */
  }
  return init.sessionId;
}

export type McpTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
};

export async function listMcpTools(userId: string): Promise<McpTool[]> {
  const token = await getValidAccessToken(userId);
  const session = await mcpSession(token);
  const { result } = await mcpFetch<{ tools: McpTool[] }>(
    token,
    { jsonrpc: "2.0", id: nextId(), method: "tools/list" },
    session,
  );
  return result.tools ?? [];
}

export type McpCallResult = {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
};

export async function callMcpTool(
  userId: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<McpCallResult> {
  const token = await getValidAccessToken(userId);
  const session = await mcpSession(token);
  const { result } = await mcpFetch<McpCallResult>(
    token,
    {
      jsonrpc: "2.0",
      id: nextId(),
      method: "tools/call",
      params: { name, arguments: args },
    },
    session,
  );
  return result;
}

// ---------- Extract structured data from an MCP tool result ----------
export function extractPayload(result: McpCallResult): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = result.content?.find((c) => c.type === "text" && typeof c.text === "string")?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------- Status ----------
export async function getConnectionStatus(userId: string) {
  const sb = await admin();
  const { data } = await sb
    .from("monitor_news_connections")
    .select("connected_at, expires_at, scope")
    .eq("user_id", userId)
    .maybeSingle();
  return data
    ? {
        connected: true,
        connected_at: data.connected_at,
        expires_at: data.expires_at,
        scope: data.scope,
      }
    : { connected: false };
}

export async function disconnect(userId: string) {
  const sb = await admin();
  await sb.from("monitor_news_connections").delete().eq("user_id", userId);
}
