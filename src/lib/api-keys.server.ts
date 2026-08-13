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

export async function createApiKey(
  supabase: Client,
  userId: string,
  input: {
    name: string;
    environment: ApiKeyEnvironment;
    permissions: string[];
    expiresInDays?: number | null;
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
    })
    .select("id, name, key_prefix, permissions, environment, status, expires_at, created_at")
    .single();

  if (error) throw new Error(error.message);

  await writeAudit({
    organizationId,
    userId,
    action: "api_key.created",
    entityId: data.id,
    metadata: { name: input.name, environment: input.environment, permissions: input.permissions },
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
