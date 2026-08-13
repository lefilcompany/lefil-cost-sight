// Server-only data-quality validation.
// Compara provider_usage_daily com cost_entries e provider_billing_snapshots
// e gera eventos de alerta quando há divergência de valores ou lacunas de dias.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const TOLERANCE_PCT = 5; // divergência aceitável entre fontes
const MIN_ABS_USD = 1; // ignora diferenças irrelevantes
const GAP_WINDOW_DAYS = 14; // janela analisada para lacunas
const MAX_GAP_DAYS = 2; // até 2 dias sem dados é tolerado (atraso do provedor)

export type DataQualityIssue = {
  connection_id: string;
  connection_name: string;
  kind: "divergence_snapshot" | "divergence_cost_entries" | "missing_usage" | "gap_days";
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  metric_value: number;
  threshold: number;
  metadata: Record<string, any>;
};

export type DataQualityResult = {
  checked_connections: number;
  issues: number;
  created_events: number;
  details: DataQualityIssue[];
};

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number) {
  return new Date(d.getTime() + n * 86400000);
}
function pctDiff(a: number, b: number) {
  const base = Math.max(Math.abs(a), Math.abs(b));
  if (base <= 0) return 0;
  return (Math.abs(a - b) / base) * 100;
}
function round(n: number, p = 2) {
  return Math.round(n * 10 ** p) / 10 ** p;
}

/** Já existe evento aberto equivalente nas últimas 24h? */
async function hasRecentEvent(kind: string, connectionId: string): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from("alert_events")
    .select("id, metadata")
    .neq("status", "resolved")
    .gte("created_at", since)
    .limit(200);
  return (data ?? []).some(
    (e: any) => e?.metadata?.check === kind && e?.metadata?.connection_id === connectionId,
  );
}

export async function validateUsageConsistency(): Promise<DataQualityResult> {
  const { data: connections, error } = await supabaseAdmin
    .from("provider_connections")
    .select("id, name, provider_id, platform_id, organization_id, status")
    .eq("status", "active");
  if (error) throw error;

  const today = new Date();
  const windowStart = iso(addDays(today, -GAP_WINDOW_DAYS));
  const yesterday = iso(addDays(today, -1));

  const details: DataQualityIssue[] = [];

  for (const c of (connections ?? []) as any[]) {
    try {
      // Snapshot de billing mais recente (fonte "oficial" do provedor).
      const { data: snap } = await supabaseAdmin
        .from("provider_billing_snapshots")
        .select("cycle_start, cycle_end, cost_period_usd, plan_name, captured_at")
        .eq("connection_id", c.id)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const cycleStart: string = (snap as any)?.cycle_start ?? windowStart;
      const cycleEnd: string = (snap as any)?.cycle_end ?? iso(today);

      // Uso diário agregado no ciclo.
      const { data: usage } = await supabaseAdmin
        .from("provider_usage_daily")
        .select("usage_date, cost_usd")
        .eq("connection_id", c.id)
        .gte("usage_date", cycleStart)
        .lte("usage_date", cycleEnd)
        .limit(20000);

      const usageRows = (usage ?? []) as any[];
      const usageTotal = usageRows.reduce((a, r) => a + Number(r.cost_usd ?? 0), 0);

      // Custos lançados no mesmo período (cost_entries do fornecedor).
      const { data: entries } = await supabaseAdmin
        .from("cost_entries")
        .select("entry_date, cost_usd")
        .eq("provider_id", c.provider_id)
        .gte("entry_date", cycleStart)
        .lte("entry_date", cycleEnd)
        .limit(20000);
      const entriesTotal = ((entries ?? []) as any[]).reduce((a, r) => a + Number(r.cost_usd ?? 0), 0);

      const snapCost = Number((snap as any)?.cost_period_usd ?? 0);

      // 1) Sem nenhuma linha de uso diário, mas com custo apurado.
      if (usageRows.length === 0 && (snapCost > MIN_ABS_USD || entriesTotal > MIN_ABS_USD)) {
        details.push({
          connection_id: c.id,
          connection_name: c.name,
          kind: "missing_usage",
          severity: "critical",
          title: `Sem uso diário registrado — ${c.name}`,
          message: `Não há linhas em "uso por dia/modelo" entre ${cycleStart} e ${cycleEnd}, apesar de custo apurado de US$ ${round(Math.max(snapCost, entriesTotal))}.`,
          metric_value: 0,
          threshold: MIN_ABS_USD,
          metadata: { cycle_start: cycleStart, cycle_end: cycleEnd, snapshot_usd: round(snapCost), cost_entries_usd: round(entriesTotal) },
        });
      }

      // 2) Divergência uso diário x snapshot do provedor.
      if (snapCost > MIN_ABS_USD && usageTotal > 0) {
        const diff = pctDiff(usageTotal, snapCost);
        if (diff > TOLERANCE_PCT && Math.abs(usageTotal - snapCost) > MIN_ABS_USD) {
          details.push({
            connection_id: c.id,
            connection_name: c.name,
            kind: "divergence_snapshot",
            severity: diff > TOLERANCE_PCT * 4 ? "critical" : "warning",
            title: `Divergência uso x billing — ${c.name}`,
            message: `Uso diário soma US$ ${round(usageTotal)} e o billing do provedor indica US$ ${round(snapCost)} (${round(diff, 1)}% de diferença) no ciclo ${cycleStart} a ${cycleEnd}.`,
            metric_value: round(diff, 2),
            threshold: TOLERANCE_PCT,
            metadata: { cycle_start: cycleStart, cycle_end: cycleEnd, usage_usd: round(usageTotal), snapshot_usd: round(snapCost) },
          });
        }
      }

      // 3) Divergência uso diário x cost_entries.
      if (entriesTotal > MIN_ABS_USD && usageTotal > 0) {
        const diff = pctDiff(usageTotal, entriesTotal);
        if (diff > TOLERANCE_PCT && Math.abs(usageTotal - entriesTotal) > MIN_ABS_USD) {
          details.push({
            connection_id: c.id,
            connection_name: c.name,
            kind: "divergence_cost_entries",
            severity: diff > TOLERANCE_PCT * 4 ? "critical" : "warning",
            title: `Divergência uso x custos — ${c.name}`,
            message: `Uso diário soma US$ ${round(usageTotal)} e os custos lançados somam US$ ${round(entriesTotal)} (${round(diff, 1)}% de diferença) no período ${cycleStart} a ${cycleEnd}.`,
            metric_value: round(diff, 2),
            threshold: TOLERANCE_PCT,
            metadata: { cycle_start: cycleStart, cycle_end: cycleEnd, usage_usd: round(usageTotal), cost_entries_usd: round(entriesTotal) },
          });
        }
      }

      // 4) Lacunas: dias sem uso diário na janela recente (até ontem).
      if (usageRows.length > 0) {
        const present = new Set(usageRows.map((r) => String(r.usage_date)));
        const gaps: string[] = [];
        const gapFrom = cycleStart > windowStart ? cycleStart : windowStart;
        for (let d = new Date(`${gapFrom}T00:00:00Z`); iso(d) <= yesterday; d = addDays(d, 1)) {
          const day = iso(d);
          if (!present.has(day)) gaps.push(day);
        }
        if (gaps.length > MAX_GAP_DAYS) {
          details.push({
            connection_id: c.id,
            connection_name: c.name,
            kind: "gap_days",
            severity: gaps.length > 7 ? "critical" : "warning",
            title: `Lacunas de dados (${gaps.length} dias) — ${c.name}`,
            message: `Faltam dados de uso em ${gaps.length} dia(s) entre ${gapFrom} e ${yesterday}: ${gaps.slice(0, 8).join(", ")}${gaps.length > 8 ? "…" : ""}.`,
            metric_value: gaps.length,
            threshold: MAX_GAP_DAYS,
            metadata: { from: gapFrom, to: yesterday, missing_days: gaps },
          });
        }
      }
    } catch (err: any) {
      console.error(`[data-quality] conexão ${c.id} falhou:`, err?.message ?? err);
    }
  }

  // Gera eventos (com dedupe por checagem + conexão em 24h).
  let created = 0;
  for (const issue of details) {
    if (await hasRecentEvent(issue.kind, issue.connection_id)) continue;
    const conn = (connections ?? []).find((c: any) => c.id === issue.connection_id) as any;
    const { error: insErr } = await supabaseAdmin.from("alert_events").insert({
      alert_id: null,
      severity: issue.severity,
      title: issue.title,
      message: issue.message,
      metric_value: issue.metric_value,
      threshold: issue.threshold,
      scope: "provider",
      scope_id: conn?.provider_id ?? null,
      scope_label: issue.connection_name,
      organization_id: conn?.organization_id ?? null,
      metadata: { check: issue.kind, connection_id: issue.connection_id, source: "data-quality", ...issue.metadata },
    });
    if (insErr) console.error("[data-quality] insert falhou:", insErr.message);
    else created++;
  }

  return {
    checked_connections: (connections ?? []).length,
    issues: details.length,
    created_events: created,
    details,
  };
}
