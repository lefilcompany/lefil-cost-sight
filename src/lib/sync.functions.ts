import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getUsdRate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { refreshUsdBrlRate } = await import("./usd-rate.server");
    const result = await refreshUsdBrlRate(true);
    return result;
  });

export const runProviderSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connection_id: string }) => data)
  .handler(async ({ data }) => {
    const { runSyncForConnection } = await import("./sync.server");
    return runSyncForConnection(data.connection_id);
  });

export const runSyncAllFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { runSyncAll } = await import("./sync.server");
    return runSyncAll();
  });

// Provisiona tudo que for possível para uma nova conexão:
// custos (cost_entries, provider_usage_daily) + billing (snapshots, invoices).
export const provisionConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { connection_id: string }) => data)
  .handler(async ({ data }) => {
    const { runSyncForConnection } = await import("./sync.server");
    const { runBillingSyncForConnection } = await import("./billing.server");

    const results: {
      costs: { ok: boolean; message?: string; records?: number; status?: string };
      billing: { ok: boolean; message?: string; snapshots?: number; usage_rows?: number; invoices?: number; status?: string };
    } = { costs: { ok: false }, billing: { ok: false } };

    try {
      const r: any = await runSyncForConnection(data.connection_id);
      results.costs = { ok: r?.ok ?? true, message: r?.message, records: r?.records ?? 0, status: r?.status };
    } catch (err: any) {
      results.costs = { ok: false, message: String(err?.message ?? err) };
    }

    try {
      const r: any = await runBillingSyncForConnection(data.connection_id);
      results.billing = {
        ok: r?.ok ?? true,
        message: r?.message,
        snapshots: r?.snapshots ?? 0,
        usage_rows: r?.usage_rows ?? 0,
        invoices: r?.invoices ?? 0,
        status: r?.status,
      };
    } catch (err: any) {
      results.billing = { ok: false, message: String(err?.message ?? err) };
    }

    return results;
  });
