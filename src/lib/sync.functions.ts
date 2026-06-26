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
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: conn, error: connErr } = await supabase
      .from("provider_connections")
      .select("*, providers(name), platforms(id,name)")
      .eq("id", data.connection_id)
      .single();
    if (connErr || !conn) throw new Error("Conexão não encontrada");

    const providerName = (conn as any).providers?.name as string;
    const startedAt = new Date();
    const { data: logRow } = await supabase
      .from("sync_logs")
      .insert({
        provider_id: (conn as any).provider_id,
        connection_id: conn.id,
        status: "running",
      })
      .select()
      .single();

    try {
      let records = 0;
      const rate = await fetchUsdBrlRate();

      if (providerName === "Firecrawl") {
        const apiKey = process.env.FIRECRAWL_API_KEY;
        if (!apiKey) throw new Error("FIRECRAWL_API_KEY não configurada. Adicione nas configurações de segredos.");
        const res = await fetch("https://api.firecrawl.dev/v2/team/credit-usage", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) throw new Error(`Firecrawl API: ${res.status}`);
        const json: any = await res.json();
        const used = Number(json?.data?.remaining_credits ? (json?.data?.plan_credits ?? 0) - json.data.remaining_credits : json?.data?.usage ?? 0);
        const remaining = Number(json?.data?.remaining_credits ?? 0);
        const total = Number(json?.data?.plan_credits ?? used + remaining);

        // Estimate cost (Firecrawl is not per-credit pricing; we log usage only as informational with 0 USD if unknown).
        const costUsd = 0;
        await supabase.from("provider_usage_syncs").insert({
          provider_id: (conn as any).provider_id,
          platform_id: (conn as any).platform_id,
          usage_quantity: used,
          usage_unit: "credits",
          cost_usd: costUsd,
          exchange_rate: rate,
          cost_brl: costUsd * rate,
          raw_response: json,
        });
        records = 1;
        await supabase.from("provider_connections").update({ last_sync_at: new Date().toISOString() }).eq("id", conn.id);

        await supabase
          .from("sync_logs")
          .update({
            status: "success",
            finished_at: new Date().toISOString(),
            duration_ms: Date.now() - startedAt.getTime(),
            records_imported: records,
            metadata: { used, remaining, total },
          })
          .eq("id", logRow!.id);

        return { ok: true, used, remaining, total };
      }

      // Generic fallback: mark as skipped
      await supabase
        .from("sync_logs")
        .update({
          status: "skipped",
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt.getTime(),
          error_message: `Sincronização automática para ${providerName} ainda não implementada.`,
        })
        .eq("id", logRow!.id);
      return { ok: false, message: `Sincronização para ${providerName} não implementada ainda.` };
    } catch (err: any) {
      await supabase
        .from("sync_logs")
        .update({
          status: "error",
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt.getTime(),
          error_message: String(err?.message ?? err),
        })
        .eq("id", logRow!.id);
      throw err;
    }
  });
