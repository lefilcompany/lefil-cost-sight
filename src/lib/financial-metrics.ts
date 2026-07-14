export type CostLike = {
  entry_date: string;
  cost_brl: number | null;
};

export function isoMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function entriesForMonth<T extends CostLike>(entries: T[], date: Date): T[] {
  const month = isoMonth(date);
  return entries.filter((entry) => entry.entry_date.startsWith(month));
}

export function sumCostBrl(entries: CostLike[]): number {
  return entries.reduce((total, entry) => total + Number(entry.cost_brl ?? 0), 0);
}

export function percentageChange(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / previous) * 100;
}

export function projectMonthEnd(currentCost: number, now: Date): number {
  if (currentCost <= 0) return 0;
  const elapsedDays = Math.max(1, now.getDate());
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return (currentCost / elapsedDays) * daysInMonth;
}

export function latestByKey<T>(rows: T[], keyOf: (row: T) => string): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!latest.has(key)) latest.set(key, row);
  }
  return [...latest.values()];
}

export function previousMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() - 1, 1);
}
