import assert from "node:assert/strict";
import test from "node:test";

import {
  buildUsageDailyRows,
  cycleKey,
  isoDay,
  lastSnapshotPerDay,
} from "../../src/lib/usage-aggregation.ts";

const base = {
  connection_id: "conn-1",
  provider_id: "prov-1",
  platform_id: "plat-1",
  plan_name: "Standard",
  included_unit: "credits",
};

function snap(capturedAt, used, cost, cycleStart = "2026-08-01") {
  return {
    ...base,
    cycle_start: cycleStart,
    cycle_end: "2026-08-31",
    used_quantity: used,
    cost_period_usd: cost,
    captured_at: capturedAt,
  };
}

const SYNCED = "2026-08-13T00:00:00.000Z";

test("keeps only the last snapshot of each day", () => {
  const map = lastSnapshotPerDay([
    snap("2026-08-01T03:00:00Z", 10, 99),
    snap("2026-08-01T21:00:00Z", 40, 99),
    snap("2026-08-02T10:00:00Z", 60, 99),
  ]);
  assert.equal(map.size, 2);
  assert.equal(map.get("2026-08-01").used_quantity, 40);
  assert.equal(map.get("2026-08-02").used_quantity, 60);
});

test("cycle key falls back to the month when cycle_start is missing", () => {
  assert.equal(cycleKey({ cycle_start: "2026-08-01" }, "2026-08-05"), "2026-08-01");
  assert.equal(cycleKey({ cycle_start: null }, "2026-08-05"), "2026-08");
  assert.equal(isoDay("2026-08-05T23:10:00Z"), "2026-08-05");
});

test("derives daily quantities as deltas inside the cycle", () => {
  const rows = buildUsageDailyRows(
    [
      snap("2026-08-01T23:00:00Z", 100, 99),
      snap("2026-08-02T23:00:00Z", 250, 99),
      snap("2026-08-03T23:00:00Z", 400, 99),
    ],
    5,
    SYNCED,
  );
  assert.deepEqual(
    rows.map((r) => [r.usage_date, r.quantity]),
    [
      ["2026-08-01", 100],
      ["2026-08-02", 150],
      ["2026-08-03", 150],
    ],
  );
});

test("prorates the cycle cost proportionally to daily usage", () => {
  const rows = buildUsageDailyRows(
    [
      snap("2026-08-01T23:00:00Z", 100, 90),
      snap("2026-08-02T23:00:00Z", 200, 90),
      snap("2026-08-03T23:00:00Z", 400, 90),
    ],
    5,
    SYNCED,
  );
  // total do ciclo = 400 → 100/200/... rateando US$ 90
  assert.deepEqual(
    rows.map((r) => Number(r.cost_usd.toFixed(4))),
    [22.5, 22.5, 45],
  );
  const total = rows.reduce((a, r) => a + r.cost_usd, 0);
  assert.equal(Number(total.toFixed(6)), 90);
  // conversão em BRL usa a taxa informada
  assert.equal(Number(rows[2].cost_brl.toFixed(4)), 225);
});

test("uses the highest cost_period_usd of the cycle as total", () => {
  const rows = buildUsageDailyRows(
    [
      snap("2026-08-01T23:00:00Z", 50, 10),
      snap("2026-08-02T23:00:00Z", 150, 40),
    ],
    1,
    SYNCED,
  );
  assert.equal(rows.every((r) => r.raw.cost_cycle_total === 40), true);
  assert.equal(Number(rows.reduce((a, r) => a + r.cost_usd, 0).toFixed(6)), 40);
});

test("cleans spikes: negative or invalid deltas become zero", () => {
  const rows = buildUsageDailyRows(
    [
      snap("2026-08-01T23:00:00Z", 300, 90),
      snap("2026-08-02T23:00:00Z", 120, 90), // provedor regrediu o acumulado
      snap("2026-08-03T23:00:00Z", 400, 90),
      { ...snap("2026-08-04T23:00:00Z", null, 90), used_quantity: Number.NaN },
    ],
    1,
    SYNCED,
  );
  const byDay = Object.fromEntries(rows.map((r) => [r.usage_date, r.quantity]));
  assert.equal(byDay["2026-08-01"], 300);
  assert.equal(byDay["2026-08-02"], undefined); // linha zerada é descartada
  assert.equal(byDay["2026-08-03"], 280);
  assert.equal(byDay["2026-08-04"], undefined);
  assert.equal(rows.every((r) => r.quantity >= 0), true);
});

test("resets the accumulator when the billing cycle changes", () => {
  const rows = buildUsageDailyRows(
    [
      snap("2026-07-30T23:00:00Z", 900, 90, "2026-07-01"),
      snap("2026-08-01T23:00:00Z", 120, 90, "2026-08-01"),
      snap("2026-08-02T23:00:00Z", 300, 90, "2026-08-01"),
    ],
    1,
    SYNCED,
  );
  const aug = rows.filter((r) => r.usage_date.startsWith("2026-08"));
  assert.deepEqual(
    aug.map((r) => r.quantity),
    [120, 180],
  );
  // cada ciclo rateia seu próprio custo (nada é somado entre ciclos)
  assert.equal(Number(aug.reduce((a, r) => a + r.cost_usd, 0).toFixed(6)), 90);
});

test("emits no rows when there is neither usage nor cost", () => {
  assert.deepEqual(buildUsageDailyRows([], 5, SYNCED), []);
  const rows = buildUsageDailyRows([snap("2026-08-01T23:00:00Z", 0, 0)], 5, SYNCED);
  assert.deepEqual(rows, []);
});

test("keeps snapshot metadata and upsert keys stable", () => {
  const [row] = buildUsageDailyRows([snap("2026-08-01T23:00:00Z", 100, 50)], 5.2, SYNCED);
  assert.equal(row.connection_id, "conn-1");
  assert.equal(row.provider_id, "prov-1");
  assert.equal(row.platform_id, "plat-1");
  assert.equal(row.model, "Standard");
  assert.equal(row.endpoint, "billing_snapshot");
  assert.equal(row.unit, "credits");
  assert.equal(row.exchange_rate, 5.2);
  assert.equal(row.synced_at, SYNCED);
  assert.equal(row.raw.source, "billing_snapshot_delta");
  assert.equal(row.raw.cycle_start, "2026-08-01");
  assert.equal(row.raw.used_cycle_total, 100);
});

test("falls back to the 'plano' model label without plan_name", () => {
  const [row] = buildUsageDailyRows(
    [{ ...snap("2026-08-01T23:00:00Z", 10, 5), plan_name: null }],
    1,
    SYNCED,
  );
  assert.equal(row.model, "plano");
});
