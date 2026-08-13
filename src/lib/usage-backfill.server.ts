// Backfill incremental de provider_usage_daily a partir de provider_billing_snapshots.
//
// Em vez de reprocessar todo o histórico a cada sync, guardamos uma marca d'água
// (watermark) por conexão em system_settings (`usage_backfill:<connection_id>`)
// com o maior `captured_at` já processado. A cada execução:
//   1. buscamos apenas snapshots capturados depois da marca d'água;
//   2. descobrimos quais ciclos de cobrança foram tocados por esses snapshots;
//   3. reprocessamos somente esses ciclos (necessário porque o rateio de custo
//      é proporcional ao consumo do ciclo inteiro);
//   4. avançamos a marca d'água.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildUsageDailyRows } from "./usage-aggregation";


const SETTING_PREFIX = "usage_backfill:";
const FULL_WINDOW_DAYS = 180;

export type BackfillResult = {
  connection_id: string;
  mode: "incremental" | "full";
  new_snapshots: number;
  cycles_processed: number;
  rows_upserted: number;
  watermark: string | null;
  skipped?: string;
};

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

function settingKey(connectionId: string) {
  return `${SETTING_PREFIX}${connectionId}`;
}

async function readWatermark(connectionId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("system_settings")
    .select("value")
    .eq("key", settingKey(connectionId))
    .maybeSingle();
  const v = (data as any)?.value;
  const wm = v?.last_captured_at;
  return typeof wm === "string" ? wm : null;
}

async function writeWatermark(connectionId: string, capturedAt: string, meta: Record<string, any>) {
  await supabaseAdmin.from("system_settings").upsert(
    {
      key: settingKey(connectionId),
      value: { last_captured_at: capturedAt, ...meta, updated_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
}

/** Limpa a marca d'água para forçar um reprocessamento completo na próxima execução. */
export async function resetUsageBackfillWatermark(connectionId: string) {
  await supabaseAdmin.from("system_settings").delete().eq("key", settingKey(connectionId));
}

type Snap = {
  connection_id: string;
  provider_id: string;
  platform_id: string | null;
  plan_name: string | null;
  cycle_start: string | null;
  cycle_end: string | null;
  used_quantity: number | null;
  included_unit: string | null;
  cost_period_usd: number | null;
  captured_at: string;
};

const SNAP_COLUMNS =
  "connection_id, provider_id, platform_id, plan_name, cycle_start, cycle_end, used_quantity, included_unit, cost_period_usd, captured_at";

/** Deriva as linhas diárias de um conjunto de snapshots de um mesmo ciclo. */
function buildRowsForCycle(snaps: Snap[], rate: number): any[] {
  return buildUsageDailyRows(snaps as any[], rate) as any[];
}


/**
 * Processa apenas os períodos novos/alterados desde o último sync desta conexão.
 * Passe `full: true` para reprocessar a janela histórica completa.
 */
export async function backfillUsageDailyIncremental(
  connectionId: string,
  rate: number,
  opts: { full?: boolean } = {},
): Promise<BackfillResult> {
  const watermark = opts.full ? null : await readWatermark(connectionId);
  const mode: BackfillResult["mode"] = watermark ? "incremental" : "full";

  // 1) Snapshots novos desde a marca d'água (ou janela completa no 1º run).
  let q = supabaseAdmin
    .from("provider_billing_snapshots")
    .select(SNAP_COLUMNS)
    .eq("connection_id", connectionId)
    .order("captured_at", { ascending: true });
  if (watermark) q = q.gt("captured_at", watermark);
  else q = q.gte("captured_at", new Date(Date.now() - FULL_WINDOW_DAYS * 86400_000).toISOString());

  const { data: fresh, error } = await q.limit(10000);
  if (error) throw error;
  const newSnaps = (fresh ?? []) as unknown as Snap[];

  if (newSnaps.length === 0) {
    return {
      connection_id: connectionId,
      mode,
      new_snapshots: 0,
      cycles_processed: 0,
      rows_upserted: 0,
      watermark,
      skipped: "nenhum snapshot novo desde o último backfill",
    };
  }

  // 2) Ciclos afetados pelos snapshots novos.
  const cycles = new Set<string>();
  for (const s of newSnaps) cycles.add(String(s.cycle_start ?? isoDay(new Date(s.captured_at)).slice(0, 7)));

  // 3) Reprocessa apenas esses ciclos (carregando o ciclo inteiro para o rateio).
  let rowsUpserted = 0;
  for (const cycle of cycles) {
    let cq = supabaseAdmin
      .from("provider_billing_snapshots")
      .select(SNAP_COLUMNS)
      .eq("connection_id", connectionId)
      .order("captured_at", { ascending: true });
    cq = cycle.length === 10 ? cq.eq("cycle_start", cycle) : cq.is("cycle_start", null);

    const { data: cycleSnaps } = await cq.limit(10000);
    let list = (cycleSnaps ?? []) as unknown as Snap[];
    if (cycle.length !== 10) {
      // ciclo desconhecido: restringe ao mês do agrupamento
      list = list.filter((s) => isoDay(new Date(s.captured_at)).slice(0, 7) === cycle);
    }
    if (list.length === 0) continue;

    const payload = buildRowsForCycle(list, rate);
    if (payload.length === 0) continue;

    const { error: upErr } = await supabaseAdmin
      .from("provider_usage_daily")
      .upsert(payload, { onConflict: "connection_id,usage_date,model,endpoint" });
    if (upErr) {
      console.warn(`[backfill] upsert do ciclo ${cycle} falhou:`, upErr.message);
      continue;
    }
    rowsUpserted += payload.length;
  }

  // 4) Avança a marca d'água.
  const newest = newSnaps[newSnaps.length - 1]!.captured_at;
  await writeWatermark(connectionId, newest, {
    mode,
    cycles: Array.from(cycles),
    rows_upserted: rowsUpserted,
  });

  return {
    connection_id: connectionId,
    mode,
    new_snapshots: newSnaps.length,
    cycles_processed: cycles.size,
    rows_upserted: rowsUpserted,
    watermark: newest,
  };
}

/** Roda o backfill incremental para todas as conexões ativas. */
export async function backfillUsageDailyAll(opts: { full?: boolean } = {}) {
  const { getUsdBrlRate } = await import("./usd-rate.server");
  const { rate } = await getUsdBrlRate();
  const { data: conns } = await supabaseAdmin
    .from("provider_connections")
    .select("id, name")
    .eq("status", "active");

  const results: Array<BackfillResult & { name?: string; error?: string }> = [];
  for (const c of (conns ?? []) as any[]) {
    try {
      const r = await backfillUsageDailyIncremental(c.id, rate, opts);
      results.push({ ...r, name: c.name });
    } catch (err: any) {
      results.push({
        connection_id: c.id,
        name: c.name,
        mode: opts.full ? "full" : "incremental",
        new_snapshots: 0,
        cycles_processed: 0,
        rows_upserted: 0,
        watermark: null,
        error: String(err?.message ?? err),
      });
    }
  }
  return {
    total: results.length,
    rows_upserted: results.reduce((a, r) => a + r.rows_upserted, 0),
    results,
  };
}
