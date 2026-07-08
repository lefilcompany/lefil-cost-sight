import { createFileRoute } from "@tanstack/react-router";

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

export const Route = createFileRoute("/api/public/hooks/update-usd-rate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("apikey") ?? request.headers.get("authorization")?.replace("Bearer ", "");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!token || !expected || token !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const rate = (await fetchBcbUsdBrlRate()) ?? (await fetchAwesomeUsdBrlRate());
        if (!rate) {
          return new Response(JSON.stringify({ success: false, error: "rate unavailable" }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin
          .from("system_settings")
          .upsert({ key: "usd_brl_rate", value: { rate, updated_at: new Date().toISOString() } });

        if (error) {
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ success: true, rate }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
