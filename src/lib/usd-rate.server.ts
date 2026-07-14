// Fonte única da cotação USD → BRL.
// Primária: AwesomeAPI (tempo real). Fallback: Banco Central. Respeita override manual.
// Cache curto em system_settings (TTL 15 min) para não bater na API a cada request.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type UsdRateSource = "manual" | "awesomeapi" | "bcb" | "cache" | "fallback";

export type UsdRateResult = {
  rate: number;
  source: UsdRateSource;
  updated_at: string;
  manual: boolean;
};

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutos
const LAST_RESORT_RATE = 5.0;

async function fetchFromAwesomeApi(): Promise<number | null> {
  try {
    const res = await fetch("https://economia.awesomeapi.com.br/json/last/USD-BRL", {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const bid = Number(json?.USDBRL?.bid);
    if (Number.isFinite(bid) && bid > 0) return bid;
  } catch {}
  return null;
}

async function fetchFromBcb(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados/ultimos/1?formato=json",
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const json: any = await res.json();
    const row = Array.isArray(json) ? json[0] : null;
    const val = Number(row?.valor?.replace?.(",", ".") ?? row?.valor);
    if (Number.isFinite(val) && val > 0) return val;
  } catch {}
  return null;
}

async function readStored(): Promise<{ rate: number | null; updated_at: string | null; manual: boolean; source: UsdRateSource | null }> {
  const { data } = await supabaseAdmin
    .from("system_settings")
    .select("value")
    .eq("key", "usd_brl_rate")
    .maybeSingle();
  const v = (data?.value as any) ?? null;
  const rate = Number(v?.rate);
  return {
    rate: Number.isFinite(rate) && rate > 0 ? rate : null,
    updated_at: v?.updated_at ?? null,
    manual: v?.manual === true,
    source: (v?.source as UsdRateSource) ?? null,
  };
}

async function writeStored(rate: number, source: UsdRateSource): Promise<string> {
  const updated_at = new Date().toISOString();
  await supabaseAdmin
    .from("system_settings")
    .upsert({ key: "usd_brl_rate", value: { rate, updated_at, source, manual: false } });
  return updated_at;
}

/**
 * Retorna a cotação atual. Usa cache de 15 min; se estiver frio, busca em tempo real
 * (AwesomeAPI → BCB). Nunca sobrescreve override manual.
 */
export async function getUsdBrlRate(): Promise<UsdRateResult> {
  const stored = await readStored();

  if (stored.manual && stored.rate) {
    return { rate: stored.rate, source: "manual", updated_at: stored.updated_at ?? new Date().toISOString(), manual: true };
  }

  const age = stored.updated_at ? Date.now() - new Date(stored.updated_at).getTime() : Infinity;
  if (stored.rate && age < CACHE_TTL_MS) {
    return { rate: stored.rate, source: "cache", updated_at: stored.updated_at!, manual: false };
  }

  return refreshUsdBrlRate(false);
}

/**
 * Busca a cotação em tempo real e persiste em system_settings.
 * Se `force` for false e existir override manual, retorna o valor manual sem tocar em API.
 */
export async function refreshUsdBrlRate(force = false): Promise<UsdRateResult> {
  const stored = await readStored();

  if (!force && stored.manual && stored.rate) {
    return { rate: stored.rate, source: "manual", updated_at: stored.updated_at ?? new Date().toISOString(), manual: true };
  }

  const awesome = await fetchFromAwesomeApi();
  if (awesome) {
    const updated_at = await writeStored(awesome, "awesomeapi");
    return { rate: awesome, source: "awesomeapi", updated_at, manual: false };
  }

  const bcb = await fetchFromBcb();
  if (bcb) {
    const updated_at = await writeStored(bcb, "bcb");
    return { rate: bcb, source: "bcb", updated_at, manual: false };
  }

  if (stored.rate) {
    return { rate: stored.rate, source: "fallback", updated_at: stored.updated_at ?? new Date().toISOString(), manual: stored.manual };
  }

  return { rate: LAST_RESORT_RATE, source: "fallback", updated_at: new Date().toISOString(), manual: false };
}
