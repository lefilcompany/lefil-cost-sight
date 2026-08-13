// Server-only cost reconciliation.
//
// Compara o custo ESTIMADO (uso diário agregado em provider_usage_daily)
// com o custo CONFIRMADO (faturas do fornecedor ou, na ausência delas,
// o snapshot de billing do ciclo) por conexão e por mês.
//
// Resultados são gravados em public.cost_reconciliations e divergências
// acima da tolerância geram eventos em public.alert_events.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const DEFAULT_TOLERANCE_PCT = 5;
const MIN_ABS_USD = 1; // ignora ruído irrelevante

export type ReconciliationStatus = "matched" | "divergent" | "pending";

export type ReconciliationRow = {
  connection_id: string;
  connection_name: string;
  organization_id: string | null;
  month: string; // YYYY-MM-01
  estimated_cost: number;
  confirmed_cost: number | null;
  confirmed_source: "invoice" | "billing_snapshot" | "none";
  difference_amount: number;
  difference_percentage: number;
  status: ReconciliationStatus;
  explanation: string;
};

export type ReconciliationResult = {
  tolerance_pct: number;
  months: number;
  checked_connections: number;
  rows: ReconciliationRow[];
  divergent: number;
  created_events: number;
};

function monthStart(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
function round(n: number, p = 2) {
  return Math.round(n * 10 ** p) / 10 ** p;
}
function pctDiff(estimated: number, confirmed: number) {
  const base = Math.max(Math.abs(confirmed), Math.abs(estimated));
  if (base <= 0) return 0;
  return ((estimated - confirmed) / base) * 100;
}

export async function getReconciliationTolerance(): Promise<number> {
  const { data } = await supabaseAdmin
    .from("system_settings")
    .select("value")
    .eq("key", "reconciliation")
    .maybeSingle();
  const pct = Number((data as any)?.value?.tolerance_pct);
  return Number.isFinite(pct) && pct > 0 ? pct : DEFAULT_TOLERANCE_PCT;
}

export async function setReconciliationTolerance(pct: number): Promise<number> {
  const value = Number.isFinite(pct) && pct > 0 ? Math.min(pct, 100) : DEFAULT_TOLERANCE_PCT;
  await supabaseAdmin
    .from("system_settings")
    .upsert({ key: "reconciliation", value: { tolerance_pct: value } as any }, { onConflict: "key" });
  return value;
}

/** Meses analisados, do mais antigo ao mais recente (inclui o mês atual). */
function monthWindow(months: number): { start: string; end: string; key: string }[] {
  const base = monthStart(new Date());
  const out: { start: string; end: string; key: string }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const s = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
    const e = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 0));
    out.push({ start: iso(s), end: iso(e), key: iso(s) });
  }
  return out;
}

async function hasRecentEvent(connectionId: string, month: string): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from("alert_events")
    .select("id, metadata")
    .neq("status", "resolved")
    .gte("created_at", since)
    .limit(300);
  return (data ?? []).some(
    (e: any) =>
      e?.metadata?.check === "reconciliation" &&
      e?.metadata?.connection_id === connectionId &&
      e?.metadata?.month === month,
  );
}

export async function runReconciliation(
  options: { months?: number } = {},
): Promise<ReconciliationResult> {
  const months = Math.min(Math.max(options.months ?? 3, 1), 12);
  const tolerance = await getReconciliationTolerance();
  const windows = monthWindow(months);
  const from = windows[0].start;
  const to = windows[windows.length - 1].end;

  const { data: connections, error } = await supabaseAdmin
    .from("provider_connections")
    .select("id, name, provider_id, platform_id, organization_id, status")
    .eq("status", "active");
  if (error) throw error;

  const rows: ReconciliationRow[] = [];

  for (const c of (connections ?? []) as any[]) {
    // Uso diário (estimado)
    const { data: usage } = await supabaseAdmin
      .from("provider_usage_daily")
      .select("usage_date, cost_usd")
      .eq("connection_id", c.id)
      .gte("usage_date", from)
      .lte("usage_date", to)
      .limit(20000);

    // Faturas (confirmado, fonte oficial)
    const { data: invoices } = await supabaseAdmin
      .from("provider_invoices")
      .select("period_start, period_end, issued_at, amount_usd, invoice_number, status")
      .eq("connection_id", c.id)
      .limit(2000);

    // Snapshots de billing (confirmado alternativo)
    const { data: snaps } = await supabaseAdmin
      .from("provider_billing_snapshots")
      .select("cycle_start, cycle_end, cost_period_usd, captured_at")
      .eq("connection_id", c.id)
      .order("captured_at", { ascending: false })
      .limit(500);

    for (const w of windows) {
      const estimated = ((usage ?? []) as any[])
        .filter((r) => String(r.usage_date) >= w.start && String(r.usage_date) <= w.end)
        .reduce((a, r) => a + Number(r.cost_usd ?? 0), 0);

      const invoiceTotal = ((invoices ?? []) as any[])
        .filter((inv) => {
          const ref = String(inv.period_start ?? inv.issued_at ?? "");
          return ref >= w.start && ref <= w.end;
        })
        .reduce((a, inv) => a + Number(inv.amount_usd ?? 0), 0);

      let confirmed: number | null = null;
      let source: ReconciliationRow["confirmed_source"] = "none";
      if (invoiceTotal > 0) {
        confirmed = invoiceTotal;
        source = "invoice";
      } else {
        const snap = ((snaps ?? []) as any[]).find((s) => {
          const ref = String(s.cycle_start ?? "");
          return ref >= w.start && ref <= w.end;
        });
        const snapCost = Number(snap?.cost_period_usd ?? 0);
        if (snapCost > 0) {
          confirmed = snapCost;
          source = "billing_snapshot";
        }
      }

      if (estimated <= 0 && (confirmed ?? 0) <= 0) continue;

      const diffAmount = confirmed == null ? 0 : estimated - confirmed;
      const diffPct = confirmed == null ? 0 : pctDiff(estimated, confirmed);
      let status: ReconciliationStatus;
      if (confirmed == null) status = "pending";
      else if (Math.abs(diffPct) > tolerance && Math.abs(diffAmount) > MIN_ABS_USD) status = "divergent";
      else status = "matched";

      const label =
        source === "invoice" ? "fatura do fornecedor" : source === "billing_snapshot" ? "billing do provedor" : "—";
      const explanation =
        status === "pending"
          ? `Sem custo confirmado para ${w.key.slice(0, 7)}: uso estimado de US$ ${round(estimated)} aguardando fatura ou snapshot de billing.`
          : status === "matched"
            ? `Uso estimado US$ ${round(estimated)} confere com o custo confirmado US$ ${round(confirmed!)} (${round(diffPct, 1)}%), dentro da tolerância de ${tolerance}%, fonte: ${label}.`
            : `Uso estimado US$ ${round(estimated)} contra US$ ${round(confirmed!)} confirmados (${round(diffPct, 1)}%), acima da tolerância de ${tolerance}%, fonte: ${label}.`;

      rows.push({
        connection_id: c.id,
        connection_name: c.name,
        organization_id: c.organization_id ?? null,
        month: w.key,
        estimated_cost: round(estimated),
        confirmed_cost: confirmed == null ? null : round(confirmed),
        confirmed_source: source,
        difference_amount: round(diffAmount),
        difference_percentage: round(diffPct, 2),
        status,
        explanation,
      });
    }
  }

  // Persistência (update quando já existe a mesma chave conexão + mês)
  for (const r of rows) {
    const payload = {
      organization_id: r.organization_id,
      reconciliation_date: r.month,
      model: r.connection_name,
      sku_id: r.connection_id,
      estimated_cost: r.estimated_cost,
      confirmed_cost: r.confirmed_cost,
      difference_amount: r.difference_amount,
      difference_percentage: r.difference_percentage,
      status: r.status,
      explanation: r.explanation,
      reconciled_at: new Date().toISOString(),
    };

    const { data: existing } = await supabaseAdmin
      .from("cost_reconciliations")
      .select("id")
      .eq("sku_id", r.connection_id)
      .eq("reconciliation_date", r.month)
      .maybeSingle();

    if (existing?.id) {
      const { error: upErr } = await supabaseAdmin
        .from("cost_reconciliations")
        .update(payload as any)
        .eq("id", existing.id);
      if (upErr) console.error("[reconciliation] update falhou:", upErr.message);
    } else {
      const { error: insErr } = await supabaseAdmin
        .from("cost_reconciliations")
        .insert(payload as any);
      if (insErr) console.error("[reconciliation] insert falhou:", insErr.message);
    }
  }

  // Eventos de alerta para divergências
  let created = 0;
  for (const r of rows.filter((x) => x.status === "divergent")) {
    if (await hasRecentEvent(r.connection_id, r.month)) continue;
    const conn = (connections ?? []).find((c: any) => c.id === r.connection_id) as any;
    const { error: evErr } = await supabaseAdmin.from("alert_events").insert({
      alert_id: null,
      severity: Math.abs(r.difference_percentage) > tolerance * 4 ? "critical" : "warning",
      title: `Divergência de reconciliação — ${r.connection_name}`,
      message: r.explanation,
      metric_value: Math.abs(r.difference_percentage),
      threshold: tolerance,
      scope: "provider",
      scope_id: conn?.provider_id ?? null,
      scope_label: r.connection_name,
      organization_id: r.organization_id,
      metadata: {
        check: "reconciliation",
        connection_id: r.connection_id,
        month: r.month,
        estimated_usd: r.estimated_cost,
        confirmed_usd: r.confirmed_cost,
        source: r.confirmed_source,
      },
    });
    if (evErr) console.error("[reconciliation] evento falhou:", evErr.message);
    else created++;
  }

  return {
    tolerance_pct: tolerance,
    months,
    checked_connections: (connections ?? []).length,
    rows,
    divergent: rows.filter((r) => r.status === "divergent").length,
    created_events: created,
  };
}
