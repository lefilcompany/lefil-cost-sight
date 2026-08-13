// Lógica PURA de agregação de uso diário a partir de snapshots de billing.
//
// Mantida sem dependências de banco para ser testável em unidade
// (tests/unit/usage-aggregation.test.mjs). Usada por:
//   - billing.server.ts (aggregateUsageDailyFromSnapshots)
//   - usage-backfill.server.ts (backfill incremental por ciclo)
//
// Regras:
//   1. snapshots são acumulativos dentro do ciclo → consumo do dia é o delta
//      entre o último snapshot do dia e o do dia anterior no MESMO ciclo;
//   2. ao trocar de ciclo o acumulado reinicia (base zero);
//   3. deltas negativos/inválidos (reset do provedor, pico espúrio) viram 0;
//   4. o custo conhecido do ciclo é rateado proporcionalmente ao consumo diário.

export type UsageSnapshot = {
  connection_id: string;
  provider_id: string;
  platform_id?: string | null;
  plan_name?: string | null;
  cycle_start?: string | null;
  cycle_end?: string | null;
  used_quantity?: number | null;
  included_unit?: string | null;
  cost_period_usd?: number | null;
  captured_at: string;
};

export type UsageDailyRow = {
  connection_id: string;
  provider_id: string;
  platform_id: string | null;
  usage_date: string;
  model: string;
  endpoint: string;
  input_tokens: number;
  output_tokens: number;
  requests: number;
  quantity: number;
  unit: string | null;
  cost_usd: number;
  exchange_rate: number;
  cost_brl: number;
  raw: Record<string, unknown>;
  synced_at: string;
};

export function isoDay(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}

/** Chave do ciclo: cycle_start quando existir, senão o mês do próprio dia. */
export function cycleKey(snap: UsageSnapshot, day: string): string {
  return String(snap.cycle_start ?? day.slice(0, 7));
}

/** Último snapshot de cada dia (ordem cronológica de captura). */
export function lastSnapshotPerDay(snaps: UsageSnapshot[]): Map<string, UsageSnapshot> {
  const ordered = [...snaps].sort(
    (a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime(),
  );
  const map = new Map<string, UsageSnapshot>();
  for (const s of ordered) map.set(isoDay(s.captured_at), s);
  return map;
}

/**
 * Converte snapshots de billing em linhas diárias prontas para upsert em
 * provider_usage_daily, com rateio do custo por ciclo.
 */
export function buildUsageDailyRows(
  snaps: UsageSnapshot[],
  rate: number,
  syncedAt: string = new Date().toISOString(),
): UsageDailyRow[] {
  if (!snaps.length) return [];

  const lastPerDay = lastSnapshotPerDay(snaps);
  const days = Array.from(lastPerDay.keys()).sort();

  type DayRow = { day: string; snap: UsageSnapshot; qty: number; cycle: string };
  const rows: DayRow[] = [];
  let prev: UsageSnapshot | null = null;

  for (const day of days) {
    const s = lastPerDay.get(day)!;
    const cycle = cycleKey(s, day);
    const sameCycle = prev != null && cycleKey(prev, isoDay(prev.captured_at)) === cycle;
    const usedNow = Number(s.used_quantity ?? 0);
    const usedPrev = sameCycle ? Number(prev!.used_quantity ?? 0) : 0;
    let qty = usedNow - usedPrev;
    // limpeza de picos: delta negativo (reset) ou não numérico não gera consumo
    if (!Number.isFinite(qty) || qty < 0) qty = 0;
    rows.push({ day, snap: s, qty, cycle });
    prev = s;
  }

  const cycleTotals = new Map<string, { cost: number; qty: number }>();
  for (const r of rows) {
    const cur = cycleTotals.get(r.cycle) ?? { cost: 0, qty: 0 };
    cur.cost = Math.max(cur.cost, Number(r.snap.cost_period_usd ?? 0));
    cur.qty += r.qty;
    cycleTotals.set(r.cycle, cur);
  }

  const payload: UsageDailyRow[] = [];
  for (const r of rows) {
    const totals = cycleTotals.get(r.cycle)!;
    const costUsd = totals.qty > 0 ? (totals.cost * r.qty) / totals.qty : 0;
    if (r.qty <= 0 && costUsd <= 0) continue;
    const s = r.snap;
    payload.push({
      connection_id: s.connection_id,
      provider_id: s.provider_id,
      platform_id: s.platform_id ?? null,
      usage_date: r.day,
      model: s.plan_name ? String(s.plan_name) : "plano",
      endpoint: "billing_snapshot",
      input_tokens: 0,
      output_tokens: 0,
      requests: 0,
      quantity: r.qty,
      unit: s.included_unit ?? null,
      cost_usd: costUsd,
      exchange_rate: rate,
      cost_brl: costUsd * rate,
      raw: {
        source: "billing_snapshot_delta",
        cycle_start: s.cycle_start ?? null,
        cycle_end: s.cycle_end ?? null,
        used_cycle_total: Number(s.used_quantity ?? 0),
        cost_cycle_total: totals.cost,
      },
      synced_at: syncedAt,
    });
  }
  return payload;
}
