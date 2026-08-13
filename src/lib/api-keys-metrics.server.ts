import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

type Client = SupabaseClient<Database>;

export type ApiKeyDailyMetric = {
  day: string;
  requests: number;
  estimatedCostBrl: number;
};

export type ApiKeyMetrics = {
  days: number;
  since: string;
  daily: ApiKeyDailyMetric[];
  totals: {
    requests: number;
    estimatedCostBrl: number;
    scopedCostBrl: number;
    avgRequestsPerDay: number;
    lastRequestAt: string | null;
  };
  scope: {
    providerIds: string[];
    platformIds: string[];
    unrestricted: boolean;
  };
  hasRequestData: boolean;
  hasCostData: boolean;
};

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

function numberFrom(value: unknown) {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Extrai o custo estimado registrado no evento de uso da chave, quando a
 * integração informa esse valor (cost_brl, cost_usd convertido ou estimated_cost).
 */
function costFromMetadata(metadata: unknown, usdRate: number) {
  if (!metadata || typeof metadata !== "object") return 0;
  const record = metadata as Record<string, unknown>;
  const brl = numberFrom(record["cost_brl"] ?? record["estimated_cost_brl"]);
  if (brl) return brl;
  const usd = numberFrom(record["cost_usd"] ?? record["estimated_cost"] ?? record["cost"]);
  return usd ? usd * usdRate : 0;
}

async function resolveUsdRate(supabase: Client) {
  const { data } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "usd_brl_rate")
    .maybeSingle();
  const value = (data?.value ?? null) as { rate?: number | string } | number | string | null;
  if (value && typeof value === "object") return numberFrom(value.rate) || 5;
  return numberFrom(value) || 5;
}

/**
 * Métricas de uso de uma chave de API: solicitações por dia (a partir dos
 * eventos de auditoria `api_key.used`) e custo estimado associado, além do
 * custo do escopo (fornecedores/plataformas liberados) no mesmo período.
 */
export async function getApiKeyMetrics(
  supabase: Client,
  id: string,
  days: number,
): Promise<ApiKeyMetrics> {
  const since = new Date(Date.now() - (days - 1) * 86_400_000);
  since.setUTCHours(0, 0, 0, 0);
  const sinceIso = since.toISOString();

  const { data: key, error: keyError } = await supabase
    .from("integration_api_keys")
    .select("id, scope_provider_ids, scope_platform_ids")
    .eq("id", id)
    .single();
  if (keyError) throw new Error(keyError.message);

  const providerIds = key.scope_provider_ids ?? [];
  const platformIds = key.scope_platform_ids ?? [];

  const [usdRate, events] = await Promise.all([
    resolveUsdRate(supabase),
    supabase
      .from("audit_logs")
      .select("occurred_at, metadata")
      .eq("entity_type", "integration_api_key")
      .eq("entity_id", id)
      .eq("action", "api_key.used")
      .gte("occurred_at", sinceIso)
      .order("occurred_at", { ascending: true })
      .limit(5000),
  ]);

  if (events.error) throw new Error(events.error.message);

  const buckets = new Map<string, ApiKeyDailyMetric>();
  for (let index = 0; index < days; index += 1) {
    const day = new Date(since.getTime() + index * 86_400_000).toISOString().slice(0, 10);
    buckets.set(day, { day, requests: 0, estimatedCostBrl: 0 });
  }

  let lastRequestAt: string | null = null;
  for (const event of events.data ?? []) {
    const day = dayKey(event.occurred_at);
    const bucket = buckets.get(day);
    if (!bucket) continue;
    bucket.requests += 1;
    bucket.estimatedCostBrl += costFromMetadata(event.metadata, usdRate);
    lastRequestAt = event.occurred_at;
  }

  // Custo do escopo no período: referência de quanto a chave "enxerga".
  let scopedQuery = supabase
    .from("cost_entries")
    .select("cost_brl, entry_date, provider_id, platform_id")
    .gte("entry_date", sinceIso.slice(0, 10));
  if (providerIds.length) scopedQuery = scopedQuery.in("provider_id", providerIds);
  if (platformIds.length) scopedQuery = scopedQuery.in("platform_id", platformIds);

  const { data: costs, error: costError } = await scopedQuery.limit(20000);
  if (costError) throw new Error(costError.message);

  let scopedCostBrl = 0;
  for (const row of costs ?? []) {
    scopedCostBrl += numberFrom(row.cost_brl);
  }

  const daily = [...buckets.values()];
  const requests = daily.reduce((sum, item) => sum + item.requests, 0);
  const estimatedCostBrl = daily.reduce((sum, item) => sum + item.estimatedCostBrl, 0);

  return {
    days,
    since: sinceIso,
    daily,
    totals: {
      requests,
      estimatedCostBrl,
      scopedCostBrl,
      avgRequestsPerDay: days ? requests / days : 0,
      lastRequestAt,
    },
    scope: {
      providerIds,
      platformIds,
      unrestricted: providerIds.length === 0 && platformIds.length === 0,
    },
    hasRequestData: requests > 0,
    hasCostData: estimatedCostBrl > 0,
  };
}

/**
 * Registra uma solicitação feita com a chave (alimenta o painel de métricas).
 * Best-effort: nunca deve bloquear a resposta da API.
 */
export async function recordApiKeyUsage(input: {
  keyId: string;
  organizationId: string;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("audit_logs").insert({
      organization_id: input.organizationId,
      action: "api_key.used",
      entity_type: "integration_api_key",
      entity_id: input.keyId,
      metadata: (input.metadata ?? {}) as never,
    });
    await supabaseAdmin
      .from("integration_api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", input.keyId);
  } catch {
    // métricas são best-effort
  }
}
