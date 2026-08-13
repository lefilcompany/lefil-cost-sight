import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listCredentialsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { listIntegrationCredentials } = await import("./credentials.server");
    return listIntegrationCredentials();
  });

export const testCredentialFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connection_id: string }) => {
    if (!data?.connection_id) throw new Error("Conexão inválida.");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { testIntegrationCredential } = await import("./credentials.server");
    return testIntegrationCredential(data.connection_id, context.userId);
  });

export const revokeCredentialFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connection_id: string }) => {
    if (!data?.connection_id) throw new Error("Conexão inválida.");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { revokeIntegrationCredential } = await import("./credentials.server");
    return revokeIntegrationCredential(data.connection_id, context.userId);
  });

export const renewCredentialFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connection_id: string; api_key: string; expires_at?: string | null }) => {
    if (!data?.connection_id) throw new Error("Conexão inválida.");
    if (!data.api_key || data.api_key.trim().length < 8) throw new Error("Informe a nova credencial.");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { renewIntegrationCredential } = await import("./credentials.server");
    return renewIntegrationCredential({
      connectionId: data.connection_id,
      apiKey: data.api_key,
      expiresAt: data.expires_at ?? null,
      userId: context.userId,
    });
  });

export const credentialAuditFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { getCredentialAuditTrail } = await import("./credentials.server");
    return getCredentialAuditTrail(30);
  });
