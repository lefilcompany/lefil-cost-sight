import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  environment: z.enum(["production", "sandbox"]),
  permissions: z.array(z.string().min(1)).min(1).max(20),
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
  scopeProviderIds: z.array(z.string().uuid()).max(50).optional(),
  scopePlatformIds: z.array(z.string().uuid()).max(50).optional(),
});

const scopeSchema = z.object({
  id: z.string().uuid(),
  scopeProviderIds: z.array(z.string().uuid()).max(50),
  scopePlatformIds: z.array(z.string().uuid()).max(50),
});

const idSchema = z.object({ id: z.string().uuid() });

export const createIntegrationApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { createApiKey } = await import("./api-keys.server");
    return createApiKey(context.supabase, context.userId, {
      name: data.name,
      environment: data.environment,
      permissions: data.permissions,
      expiresInDays: data.expiresInDays ?? null,
      scopeProviderIds: data.scopeProviderIds ?? [],
      scopePlatformIds: data.scopePlatformIds ?? [],
    });
  });

/** Atualiza o escopo (fornecedores/plataformas) que a chave pode acessar. */
export const updateIntegrationApiKeyScope = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => scopeSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { updateApiKeyScope } = await import("./api-keys.server");
    return updateApiKeyScope(context.supabase, context.userId, data.id, {
      providerIds: data.scopeProviderIds,
      platformIds: data.scopePlatformIds,
    });
  });

export const revokeIntegrationApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => idSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { revokeApiKey } = await import("./api-keys.server");
    return revokeApiKey(context.supabase, context.userId, data.id);
  });

export const rotateIntegrationApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => idSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { rotateApiKey } = await import("./api-keys.server");
    return rotateApiKey(context.supabase, context.userId, data.id);
  });

export const getIntegrationApiKeyEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => idSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { listApiKeyEvents } = await import("./api-keys.server");
    return { events: await listApiKeyEvents(context.supabase, data.id) };
  });

const rotationPolicySchema = z.object({
  id: z.string().uuid(),
  autoRotate: z.boolean(),
  rotateBeforeDays: z.number().int().min(1).max(365),
  rotationIntervalDays: z.number().int().min(1).max(3650).nullable().optional(),
});

/** Ativa/atualiza a política de rotação automática de uma chave. */
export const updateIntegrationApiKeyRotation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => rotationPolicySchema.parse(data))
  .handler(async ({ data, context }) => {
    const { computeNextRotationAt } = await import("./api-keys-rotation.server");
    const { data: current, error: readError } = await context.supabase
      .from("integration_api_keys")
      .select("id, expires_at")
      .eq("id", data.id)
      .single();
    if (readError) throw new Error(readError.message);

    const { data: updated, error } = await context.supabase
      .from("integration_api_keys")
      .update({
        auto_rotate: data.autoRotate,
        rotate_before_days: data.rotateBeforeDays,
        rotation_interval_days: data.rotationIntervalDays ?? null,
        next_rotation_at: data.autoRotate
          ? computeNextRotationAt(current.expires_at, data.rotateBeforeDays)
          : null,
      })
      .eq("id", data.id)
      .select("id, auto_rotate, rotate_before_days, rotation_interval_days, next_rotation_at")
      .single();
    if (error) throw new Error(error.message);
    return { key: updated };
  });

/** Executa a rotação agendada imediatamente (uma chave ou todas as vencidas). */
export const runIntegrationApiKeyRotation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ id: z.string().uuid().optional(), force: z.boolean().optional() }).parse(data ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { rotateDueApiKeys } = await import("./api-keys-rotation.server");
    return rotateDueApiKeys({
      keyId: data.id,
      force: data.force ?? Boolean(data.id),
      initiatedBy: context.userId,
    });
  });

/** Revela (uma única vez) o segredo gerado pela última rotação automática. */
export const revealRotatedApiKeySecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => idSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: secret, error } = await context.supabase.rpc("reveal_api_key_rotation_secret", {
      _key_id: data.id,
    });
    if (error) throw new Error(error.message);
    if (!secret) throw new Error("Nenhuma chave rotacionada pendente de leitura");
    return { secret: secret as string };
  });
