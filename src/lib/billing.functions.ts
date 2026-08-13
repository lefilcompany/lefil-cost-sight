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

export const runUsageBackfill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connection_id?: string; full?: boolean } | undefined) => data ?? {})
  .handler(async ({ data }) => {
    const { backfillUsageDailyIncremental, backfillUsageDailyAll } = await import("./usage-backfill.server");
    if (data.connection_id) {
      const { getUsdBrlRate } = await import("./usd-rate.server");
      const { rate } = await getUsdBrlRate();
      const r = await backfillUsageDailyIncremental(data.connection_id, rate, { full: data.full });
      return { total: 1, rows_upserted: r.rows_upserted, results: [r] };
    }
    return backfillUsageDailyAll({ full: data.full });
  });
