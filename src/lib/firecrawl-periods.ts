// Helpers para o formato real do histórico da Firecrawl v2:
// { success: true, periods: [{ startDate, endDate, creditsUsed | tokensUsed }] }

export type FirecrawlPeriod = {
  startDate: string;
  endDate: string | null;
  used: number;
};

export function parsePeriods(payload: any, field: "creditsUsed" | "tokensUsed"): FirecrawlPeriod[] {
  const raw: any[] = Array.isArray(payload?.periods)
    ? payload.periods
    : Array.isArray(payload?.data?.periods)
      ? payload.data.periods
      : [];
  return raw
    .map((p) => ({
      startDate: String(p?.startDate ?? p?.start_date ?? ""),
      endDate: p?.endDate ?? p?.end_date ?? null,
      used: Number(p?.[field] ?? p?.[field === "creditsUsed" ? "credits_used" : "tokens_used"] ?? 0),
    }))
    .filter((p) => p.startDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** Consumo do período mais recente (o ciclo em aberto). `null` se indisponível. */
export function latestPeriodUsage(
  payload: any,
  field: "creditsUsed" | "tokensUsed",
): number | null {
  const periods = parsePeriods(payload, field);
  if (periods.length === 0) return null;
  const last = periods[periods.length - 1]!;
  return Number.isFinite(last.used) ? last.used : null;
}
