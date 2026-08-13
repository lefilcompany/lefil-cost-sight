// Server-only: inventário e ações sobre credenciais das integrações
// (API keys / tokens das conexões de fornecedor + OAuth do Monitor News).
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type CredentialItem = {
  connection_id: string;
  connection_name: string;
  provider_id: string | null;
  provider_name: string;
  kind: "api_key" | "service_account" | "oauth";
  status: string;
  has_secret: boolean;
  secret_hint: string | null;
  expires_at: string | null;
  days_to_expire: number | null;
  last_sync_at: string | null;
  last_error: string | null;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  supports_test: boolean;
  can_renew: boolean;
  health: "ok" | "warning" | "expired" | "missing" | "error";
};

const KIND_BY_PROVIDER: Record<string, CredentialItem["kind"]> = {
  "Google Cloud": "service_account",
};

const TESTABLE = new Set([
  "Firecrawl",
  "OpenAI",
  "Gemini",
  "Google Gemini",
  "Google Cloud",
  "ElevenLabs",
  "Supabase",
]);

function maskSecret(secret: string | null): string | null {
  if (!secret) return null;
  const trimmed = secret.trim();
  if (trimmed.startsWith("{")) return "service-account JSON";
  if (trimmed.length <= 10) return `${trimmed.slice(0, 2)}••••`;
  return `${trimmed.slice(0, 6)}••••${trimmed.slice(-4)}`;
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 86_400_000);
}

async function readSecret(connectionId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc("get_connection_api_key_internal", {
    _connection_id: connectionId,
  });
  if (error) return null;
  return (data as string | null) ?? null;
}

async function audit(action: string, connectionId: string, organizationId: string | null, userId: string | null, metadata: Record<string, unknown>) {
  try {
    await supabaseAdmin.from("audit_logs").insert({
      organization_id: organizationId,
      user_id: userId,
      action,
      entity_type: "provider_connection",
      entity_id: connectionId,
      metadata: metadata as never,
    });
  } catch {
    // best-effort
  }
}

function healthOf(item: Omit<CredentialItem, "health">): CredentialItem["health"] {
  if (!item.has_secret) return "missing";
  if (item.expires_at && (item.days_to_expire ?? 0) < 0) return "expired";
  if (item.status === "error" || item.last_test_ok === false) return "error";
  if (item.days_to_expire !== null && item.days_to_expire <= 15) return "warning";
  if (item.status !== "active") return "warning";
  return "ok";
}

export async function listIntegrationCredentials(): Promise<{
  items: CredentialItem[];
  monitor_news: {
    connected: boolean;
    status: string | null;
    expires_at: string | null;
    days_to_expire: number | null;
    last_error: string | null;
    scope: string | null;
  };
  api_keys: { total: number; active: number; expiring: number; revoked: number };
  generated_at: string;
}> {
  const { data: conns, error } = await supabaseAdmin
    .from("provider_connections")
    .select("id, name, status, config, last_sync_at, provider_id, platform_id, organization_id, providers(name)")
    .order("name");
  if (error) throw error;

  const items: CredentialItem[] = [];
  for (const conn of conns ?? []) {
    const providerName = ((conn as any).providers?.name as string) ?? "—";
    const cfg = ((conn as any).config ?? {}) as Record<string, any>;
    const secret = await readSecret(conn.id);

    const { data: lastLog } = await supabaseAdmin
      .from("sync_logs")
      .select("status, error_message, started_at")
      .eq("connection_id", conn.id)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const expiresAt: string | null = cfg.credential_expires_at ?? cfg.key_expires_at ?? null;
    const base = {
      connection_id: conn.id,
      connection_name: conn.name,
      provider_id: conn.provider_id ?? null,
      provider_name: providerName,
      kind: KIND_BY_PROVIDER[providerName] ?? "api_key",
      status: conn.status,
      has_secret: Boolean(secret),
      secret_hint: maskSecret(secret),
      expires_at: expiresAt,
      days_to_expire: daysUntil(expiresAt),
      last_sync_at: conn.last_sync_at ?? null,
      last_error: lastLog?.status === "error" ? lastLog?.error_message ?? null : null,
      last_test_at: (cfg.credential_last_test_at as string | null) ?? null,
      last_test_ok: typeof cfg.credential_last_test_ok === "boolean" ? cfg.credential_last_test_ok : null,
      supports_test: TESTABLE.has(providerName),
      can_renew: true,
    } satisfies Omit<CredentialItem, "health">;

    items.push({ ...base, health: healthOf(base) });
  }

  const { data: mn } = await supabaseAdmin
    .from("monitor_news_connections")
    .select("status, expires_at, last_error, scope")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: keys } = await supabaseAdmin
    .from("integration_api_keys")
    .select("status, expires_at");

  const now = Date.now();
  const apiKeys = (keys ?? []).reduce(
    (acc, k) => {
      acc.total += 1;
      if (k.status === "revoked") acc.revoked += 1;
      else {
        const exp = k.expires_at ? new Date(k.expires_at).getTime() : null;
        if (exp && exp < now) acc.expiring += 1;
        else if (exp && exp - now < 15 * 86_400_000) acc.expiring += 1;
        else acc.active += 1;
      }
      return acc;
    },
    { total: 0, active: 0, expiring: 0, revoked: 0 },
  );

  return {
    items,
    monitor_news: {
      connected: Boolean(mn),
      status: mn?.status ?? null,
      expires_at: mn?.expires_at ?? null,
      days_to_expire: daysUntil(mn?.expires_at ?? null),
      last_error: mn?.last_error ?? null,
      scope: mn?.scope ?? null,
    },
    api_keys: apiKeys,
    generated_at: new Date().toISOString(),
  };
}

async function pingProvider(providerName: string, secret: string, cfg: Record<string, any>): Promise<{ ok: boolean; detail: string }> {
  switch (providerName) {
    case "Firecrawl": {
      const res = await fetch("https://api.firecrawl.dev/v2/team/credit-usage", {
        headers: { Authorization: `Bearer ${secret}` },
      });
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}: ${(await res.text()).slice(0, 180)}` };
      const json: any = await res.json().catch(() => ({}));
      const remaining = json?.data?.remainingCredits ?? json?.data?.remaining_credits;
      return { ok: true, detail: remaining != null ? `Créditos restantes: ${remaining}` : "Credencial válida." };
    }
    case "OpenAI": {
      const res = await fetch("https://api.openai.com/v1/organization/projects?limit=1", {
        headers: { Authorization: `Bearer ${secret}` },
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, detail: `Chave rejeitada (HTTP ${res.status}). Use uma Admin key com leitura de billing.` };
      }
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}: ${(await res.text()).slice(0, 180)}` };
      return { ok: true, detail: "Admin key válida (organização acessível)." };
    }
    case "Gemini":
    case "Google Gemini": {
      if (cfg.gcp?.bq_project || cfg.gcp?.billing_account_id) {
        return pingProvider("Google Cloud", secret, cfg);
      }
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(secret)}`,
      );
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}: ${(await res.text()).slice(0, 180)}` };
      const json: any = await res.json().catch(() => ({}));
      return { ok: true, detail: `Chave válida (${json?.models?.length ?? 0} modelos disponíveis).` };
    }
    case "Google Cloud": {
      const { parseServiceAccount, getGcpAccessToken, GCP_SCOPES } = await import("./gcp-auth.server");
      const sa = parseServiceAccount(secret);
      const token = await getGcpAccessToken(sa, [GCP_SCOPES.bigqueryReadonly]);
      return { ok: Boolean(token), detail: `Token OAuth emitido para ${sa.client_email}.` };
    }
    case "ElevenLabs": {
      const res = await fetch("https://api.elevenlabs.io/v1/user", { headers: { "xi-api-key": secret } });
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}: ${(await res.text()).slice(0, 180)}` };
      const json: any = await res.json().catch(() => ({}));
      const tier = json?.subscription?.tier;
      return { ok: true, detail: tier ? `Conta válida (plano ${tier}).` : "Conta válida." };
    }
    case "Supabase": {
      const ref = cfg.project_ref;
      if (!ref) return { ok: false, detail: "Project Ref não configurado na conexão." };
      const res = await fetch(`https://${ref}.supabase.co/rest/v1/?apikey=${encodeURIComponent(secret)}`, {
        headers: { apikey: secret },
      });
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}: ${(await res.text()).slice(0, 180)}` };
      return { ok: true, detail: `API do projeto ${ref} respondeu com sucesso.` };
    }
    default:
      return { ok: false, detail: `Teste automático não disponível para "${providerName}".` };
  }
}

async function loadConnection(connectionId: string) {
  const { data, error } = await supabaseAdmin
    .from("provider_connections")
    .select("id, name, status, config, organization_id, provider_id, providers(name)")
    .eq("id", connectionId)
    .single();
  if (error || !data) throw new Error("Conexão não encontrada.");
  return data as any;
}

export async function testIntegrationCredential(connectionId: string, userId?: string | null) {
  const conn = await loadConnection(connectionId);
  const providerName = (conn.providers?.name as string) ?? "—";
  const cfg = (conn.config ?? {}) as Record<string, any>;
  const secret = await readSecret(connectionId);

  let ok = false;
  let detail = "";
  if (!secret) {
    detail = "Nenhuma credencial armazenada para esta conexão.";
  } else {
    try {
      const result = await pingProvider(providerName, secret, cfg);
      ok = result.ok;
      detail = result.detail;
    } catch (err: any) {
      ok = false;
      detail = String(err?.message ?? err).slice(0, 300);
    }
  }

  const testedAt = new Date().toISOString();
  await supabaseAdmin
    .from("provider_connections")
    .update({
      config: { ...cfg, credential_last_test_at: testedAt, credential_last_test_ok: ok, credential_last_test_detail: detail } as never,
      status: ok ? "active" : conn.status === "inactive" ? "inactive" : "error",
    })
    .eq("id", connectionId);

  await audit("credential.tested", connectionId, conn.organization_id ?? null, userId ?? null, {
    provider: providerName,
    ok,
    detail,
  });

  return { ok, detail, tested_at: testedAt, provider_name: providerName };
}

export async function revokeIntegrationCredential(connectionId: string, userId?: string | null) {
  const conn = await loadConnection(connectionId);
  const cfg = (conn.config ?? {}) as Record<string, any>;

  const { error } = await supabaseAdmin.rpc("clear_connection_api_key", { _connection_id: connectionId });
  if (error) throw new Error(error.message);

  await supabaseAdmin
    .from("provider_connections")
    .update({
      status: "inactive",
      config: {
        ...cfg,
        credential_revoked_at: new Date().toISOString(),
        credential_last_test_ok: null,
        credential_last_test_detail: null,
      } as never,
    })
    .eq("id", connectionId);

  await audit("credential.revoked", connectionId, conn.organization_id ?? null, userId ?? null, {
    provider: conn.providers?.name ?? null,
  });

  return { ok: true, message: "Credencial revogada e conexão desativada." };
}

export async function renewIntegrationCredential(input: {
  connectionId: string;
  apiKey: string;
  expiresAt?: string | null;
  userId?: string | null;
}) {
  const conn = await loadConnection(input.connectionId);
  const cfg = (conn.config ?? {}) as Record<string, any>;

  const { error } = await supabaseAdmin.rpc("set_connection_api_key", {
    _connection_id: input.connectionId,
    _api_key: input.apiKey.trim(),
  });
  if (error) throw new Error(error.message);

  await supabaseAdmin
    .from("provider_connections")
    .update({
      status: "active",
      config: {
        ...cfg,
        credential_expires_at: input.expiresAt ?? null,
        credential_rotated_at: new Date().toISOString(),
        credential_revoked_at: null,
      } as never,
    })
    .eq("id", input.connectionId);

  await audit("credential.renewed", input.connectionId, conn.organization_id ?? null, input.userId ?? null, {
    provider: conn.providers?.name ?? null,
    expires_at: input.expiresAt ?? null,
  });

  const test = await testIntegrationCredential(input.connectionId, input.userId ?? null);
  return { ok: true, test };
}

export async function getCredentialAuditTrail(limit = 30) {
  const { data, error } = await supabaseAdmin
    .from("audit_logs")
    .select("id, action, entity_id, metadata, occurred_at, user_id")
    .eq("entity_type", "provider_connection")
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
