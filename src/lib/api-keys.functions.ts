import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  environment: z.enum(["production", "sandbox"]),
  permissions: z.array(z.string().min(1)).min(1).max(20),
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
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
