import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function fetchUsdBrlRate(): Promise<number> {
  try {
    const res = await fetch("https://economia.awesomeapi.com.br/json/last/USD-BRL");
    if (!res.ok) throw new Error("rate fetch failed");
    const json: any = await res.json();
    const bid = Number(json?.USDBRL?.bid);
    if (Number.isFinite(bid) && bid > 0) return bid;
  } catch {}
  return 5.0;
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
