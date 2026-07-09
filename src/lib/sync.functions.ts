import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function fetchBcbUsdBrlRate(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados/ultimos/1?formato=json",
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) return null;
    const json: any = await res.json();
    const row = Array.isArray(json) ? json[0] : null;
    const val = Number(row?.valor?.replace?.(",", ".") ?? row?.valor);
    if (Number.isFinite(val) && val > 0) return val;
  } catch {}
  return null;
}

async function fetchAwesomeUsdBrlRate(): Promise<number | null> {
  try {
    const res = await fetch("https://economia.awesomeapi.com.br/json/last/USD-BRL");
    if (!res.ok) return null;
    const json: any = await res.json();
    const bid = Number(json?.USDBRL?.bid);
    if (Number.isFinite(bid) && bid > 0) return bid;
  } catch {}
  return null;
}

async function fetchUsdBrlRate(): Promise<number> {
  const rate = await fetchBcbUsdBrlRate();
  if (rate) return rate;
  const fallback = await fetchAwesomeUsdBrlRate();
  if (fallback) return fallback;
  throw new Error("Não foi possível buscar a cotação USD→BRL. Tente novamente mais tarde.");
}

export const getUsdRate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const rate = await fetchUsdBrlRate();
    await context.supabase
      .from("system_settings")
      .upsert({ key: "usd_brl_rate", value: { rate, updated_at: new Date().toISOString() } });
    return { rate };
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
