import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const runBillingSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connection_id: string }) => data)
  .handler(async ({ data }) => {
    const { runBillingSyncForConnection } = await import("./billing.server");
    return runBillingSyncForConnection(data.connection_id);
  });

export const runBillingSyncAllFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { runBillingSyncAll } = await import("./billing.server");
    return runBillingSyncAll();
  });
