import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const discoverGcp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { service_account_json: string }) => data)
  .handler(async ({ data }) => {
    const { discoverGcpFromServiceAccount } = await import("./gcp-discover.server");
    return discoverGcpFromServiceAccount(data.service_account_json);
  });
