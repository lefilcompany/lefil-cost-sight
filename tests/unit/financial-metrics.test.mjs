import assert from "node:assert/strict";
import test from "node:test";

import {
  entriesForMonth,
  latestByKey,
  percentageChange,
  previousMonth,
  projectMonthEnd,
  sumCostBrl,
} from "../../src/lib/financial-metrics.ts";

const entries = [
  { entry_date: "2026-07-01", cost_brl: 100 },
  { entry_date: "2026-07-02", cost_brl: 50 },
  { entry_date: "2026-06-30", cost_brl: 200 },
  { entry_date: "2026-07-03", cost_brl: null },
];

test("filters and sums entries for the requested month", () => {
  const july = entriesForMonth(entries, new Date(2026, 6, 14));
  assert.equal(july.length, 3);
  assert.equal(sumCostBrl(july), 150);
});

test("calculates percentage variation with zero-safe behavior", () => {
  assert.equal(percentageChange(120, 100), 20);
  assert.equal(percentageChange(0, 0), 0);
  assert.equal(percentageChange(100, 0), 100);
});

test("projects month end using elapsed days", () => {
  const projection = projectMonthEnd(1400, new Date(2026, 6, 14));
  assert.equal(projection, 3100);
  assert.equal(projectMonthEnd(0, new Date(2026, 6, 14)), 0);
});

test("selects the latest ordered row for each key", () => {
  const rows = [
    { connection: "a", captured: 3 },
    { connection: "a", captured: 2 },
    { connection: "b", captured: 1 },
  ];
  assert.deepEqual(latestByKey(rows, (row) => row.connection), [rows[0], rows[2]]);
});

test("resolves the previous calendar month across year boundaries", () => {
  const result = previousMonth(new Date(2026, 0, 10));
  assert.equal(result.getFullYear(), 2025);
  assert.equal(result.getMonth(), 11);
  assert.equal(result.getDate(), 1);
});
