import { createHash, randomBytes } from "crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

export type ApiKeyEnvironment = "production" | "sandbox";

export const API_KEY_PERMISSIONS = [
  "costs:read",
  "costs:write",
  "billing:read",
  "alerts:read",
  "alerts:write",
  "sync:trigger",
] as const;

export type ApiKeyPermission = (typeof API_KEY_PERMISSIONS)[number];

type Client = SupabaseClient<Database>;

export function hashApiKey(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

function generateRawKey(environment: ApiKeyEnvironment) {
  const env = environment === "production" ? "live" : "test";
  const secret = randomBytes(24).toString("base64url");
  return `qw_${env}_${secret}`;
}

async function resolveOrgId(supabase: Client) {
  const { data, error } = await supabase.rpc("default_org_id");
  if (error) throw new Error(error.message);
  if (!data) throw new Error("organization_not_found");
  return data as string;
}

async function writeAudit(input: {
  organizationId: string;
  userId: string;
  action: string;
  entityId: string;
  metadata: Record<string, string | number | boolean | null | string[]>;
}) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("audit_logs").insert({
      organization_id: input.organizationId,
      user_id: input.userId,
      action: input.action,
      entity_type: "integration_api_key",
      entity_id: input.entityId,
      metadata: input.metadata as never,
    });
  } catch {
    // auditoria é best-effort: nunca deve bloquear a operação
  }
}

export type ApiKeyScope = {
  providerIds: string[];
  platformIds: string[];
};

/**
 * Verifica se um provider/platform está dentro do escopo da chave.
 * Listas vazias significam acesso irrestrito àquela dimensão.
 */
export function isWithinApiKeyScope(
  scope: { scope_provider_ids?: string[] | null; scope_platform_ids?: string[] | null },
  target: { providerId?: string | null; platformId?: string | null },
) {
  const providers = scope.scope_provider_ids ?? [];
  const platforms = scope.scope_platform_ids ?? [];
  if (providers.length && (!target.providerId || !providers.includes(target.providerId))) return false;
  if (platforms.length && (!target.platformId || !platforms.includes(target.platformId))) return false;
  return true;
}

/** Lança erro quando o recurso pedido está fora do escopo da chave. */
export function assertApiKeyScope(
  scope: { scope_provider_ids?: string[] | null; scope_platform_ids?: string[] | null },
  target: { providerId?: string | null; platformId?: string | null },
) {
  if (!isWithinApiKeyScope(scope, target)) {
    throw new Error("api_key_out_of_scope");
  }
}

export async function updateApiKeyScope(
  supabase: Client,
  userId: string,
  id: string,
  scope: ApiKeyScope,
) {
  const { data, error } = await supabase
    .from("integration_api_keys")
    .update({
      scope_provider_ids: scope.providerIds,
      scope_platform_ids: scope.platformIds,
    })
    .eq("id", id)
    .select("id, name, organization_id, scope_provider_ids, scope_platform_ids")
    .single();

  if (error) throw new Error(error.message);

  await writeAudit({
    organizationId: data.organization_id,
    userId,
    action: "api_key.scope_updated",
    entityId: data.id,
    metadata: {
      name: data.name,
      providers: scope.providerIds.length ? scope.providerIds : ["*"],
      platforms: scope.platformIds.length ? scope.platformIds : ["*"],
    },
  });

  return { key: data };
}

export async function createApiKey(
  supabase: Client,
  userId: string,
  input: {
    name: string;
    environment: ApiKeyEnvironment;
    permissions: string[];
    expiresInDays?: number | null;
    scopeProviderIds?: string[];
    scopePlatformIds?: string[];
  },
) {
  const organizationId = await resolveOrgId(supabase);
  const raw = generateRawKey(input.environment);
  const expiresAt =
    input.expiresInDays && input.expiresInDays > 0
      ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString()
      : null;

  const { data, error } = await supabase
    .from("integration_api_keys")
    .insert({
      organization_id: organizationId,
      name: input.name,
      key_prefix: raw.slice(0, 14),
      key_hash: hashApiKey(raw),
      permissions: input.permissions,
      environment: input.environment,
      status: "active",
      expires_at: expiresAt,
      created_by: userId,
      scope_provider_ids: input.scopeProviderIds ?? [],
      scope_platform_ids: input.scopePlatformIds ?? [],
    })
    .select(
      "id, name, key_prefix, permissions, environment, status, expires_at, created_at, scope_provider_ids, scope_platform_ids",
    )
    .single();

  if (error) throw new Error(error.message);

  await writeAudit({
    organizationId,
    userId,
    action: "api_key.created",
    entityId: data.id,
    metadata: {
      name: input.name,
      environment: input.environment,
      permissions: input.permissions,
      providers: input.scopeProviderIds?.length ? input.scopeProviderIds : ["*"],
      platforms: input.scopePlatformIds?.length ? input.scopePlatformIds : ["*"],
    },
  });

  return { key: data, secret: raw };
}

export async function revokeApiKey(supabase: Client, userId: string, id: string) {
  const { data, error } = await supabase
    .from("integration_api_keys")
    .update({ status: "revoked" })
    .eq("id", id)
    .select("id, name, organization_id")
    .single();

  if (error) throw new Error(error.message);

  await writeAudit({
    organizationId: data.organization_id,
    userId,
    action: "api_key.revoked",
    entityId: data.id,
    metadata: { name: data.name },
  });

  return { id: data.id };
}

export async function rotateApiKey(supabase: Client, userId: string, id: string) {
  const { data: current, error: readError } = await supabase
    .from("integration_api_keys")
    .select("id, name, environment, permissions, expires_at, organization_id")
    .eq("id", id)
    .single();

  if (readError) throw new Error(readError.message);

  const environment = (current.environment === "sandbox" ? "sandbox" : "production") as ApiKeyEnvironment;
  const raw = generateRawKey(environment);

  const { data, error } = await supabase
    .from("integration_api_keys")
    .update({
      key_prefix: raw.slice(0, 14),
      key_hash: hashApiKey(raw),
      status: "active",
      last_used_at: null,
    })
    .eq("id", id)
    .select("id, name, key_prefix, permissions, environment, status, expires_at, created_at, last_used_at")
    .single();

  if (error) throw new Error(error.message);

  await writeAudit({
    organizationId: current.organization_id,
    userId,
    action: "api_key.rotated",
    entityId: id,
    metadata: { name: current.name },
  });

  return { key: data, secret: raw };
}

export async function listApiKeyEvents(supabase: Client, id: string) {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, action, occurred_at, metadata, user_id")
    .eq("entity_type", "integration_api_key")
    .eq("entity_id", id)
    .order("occurred_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);
  return data ?? [];
}
