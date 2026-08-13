// Server-only alert evaluation. Uses supabaseAdmin.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyAlert, periodLabelFor } from "@/lib/alert-notify.server";
import { buildCostEntriesReport } from "@/lib/alert-report.server";
import { dedupeKeyFor, ruleSilenceState, suppressAsDuplicate } from "@/lib/alert-suppression.server";


type Alert = {
  id: string;
  name: string;
  scope: "global" | "client" | "platform" | "provider";
  scope_id: string | null;
  metric: "monthly_cost" | "daily_cost" | "variance_pct" | "no_sync_days";
  comparison: ">" | ">=" | "<" | "<=";
  threshold: number;
  channel: string;
  enabled: boolean;
  muted?: boolean | null;
  snoozed_until?: string | null;
  dedupe_window_minutes?: number | null;
};

type EvalResult = {
  evaluated: number;
  triggered: number;
  silenced: number;
  deduped: number;
  events: Array<{ alert_id: string; title: string; value: number }>;
};

function firstOfMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function firstOfPrevMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
}
function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function compare(a: number, cmp: string, b: number) {
  switch (cmp) {
    case ">": return a > b;
    case ">=": return a >= b;
    case "<": return a < b;
    case "<=": return a <= b;
    default: return false;
  }
}

async function sumCosts(from: string, to: string, scope: Alert["scope"], scopeId: string | null): Promise<number> {
  let q = supabaseAdmin.from("cost_entries").select("cost_brl,client_id,platform_id,provider_id").gte("entry_date", from).lt("entry_date", to);
  if (scope === "client" && scopeId) q = q.eq("client_id", scopeId);
  if (scope === "platform" && scopeId) q = q.eq("platform_id", scopeId);
  if (scope === "provider" && scopeId) q = q.eq("provider_id", scopeId);
  const { data, error } = await q.limit(50000);
  if (error) throw error;
  return (data ?? []).reduce((acc: number, r: any) => acc + Number(r.cost_brl ?? 0), 0);
}

async function labelForScope(scope: Alert["scope"], scopeId: string | null): Promise<string> {
  if (scope === "global" || !scopeId) return "Global";
  const table = scope === "client" ? "clients" : scope === "platform" ? "platforms" : "providers";
  const { data } = await supabaseAdmin.from(table).select("name").eq("id", scopeId).maybeSingle();
  return (data as any)?.name ?? scope;
}

export async function evaluateAlerts(): Promise<EvalResult> {
  const { data: alerts, error } = await supabaseAdmin
    .from("cost_alerts")
    .select("*")
    .eq("enabled", true);
  if (error) throw error;

  const now = new Date();
  const monthStart = firstOfMonth(now);
  const prevStart = firstOfPrevMonth(now);
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrow = new Date(todayStart.getTime() + 86400000);

  const events: EvalResult["events"] = [];
  let evaluated = 0;
  let silenced = 0;
  let deduped = 0;

  for (const a of (alerts ?? []) as Alert[]) {
    evaluated++;
    try {
      const silence = ruleSilenceState(a);
      if (silence.silenced) {
        silenced++;
        await supabaseAdmin
          .from("cost_alerts")
          .update({ last_evaluated_at: new Date().toISOString() })
          .eq("id", a.id);
        continue;
      }

      let value = 0;
      let title = "";
      let message = "";

      if (a.metric === "monthly_cost") {
        value = await sumCosts(iso(monthStart), iso(tomorrow), a.scope, a.scope_id);
        title = `Custo do mês acima do limite`;
        message = `Custo acumulado no mês: R$ ${value.toFixed(2)} (limite: R$ ${Number(a.threshold).toFixed(2)}).`;
      } else if (a.metric === "daily_cost") {
        value = await sumCosts(iso(todayStart), iso(tomorrow), a.scope, a.scope_id);
        title = `Custo do dia acima do limite`;
        message = `Custo hoje: R$ ${value.toFixed(2)} (limite: R$ ${Number(a.threshold).toFixed(2)}).`;
      } else if (a.metric === "variance_pct") {
        const cur = await sumCosts(iso(monthStart), iso(tomorrow), a.scope, a.scope_id);
        const prev = await sumCosts(iso(prevStart), iso(monthStart), a.scope, a.scope_id);
        if (prev <= 0) continue; // não avaliar sem base
        value = ((cur - prev) / prev) * 100;
        title = `Variação mensal acima de ${a.threshold}%`;
        message = `Mês atual R$ ${cur.toFixed(2)} vs. anterior R$ ${prev.toFixed(2)} → ${value.toFixed(1)}%.`;
      } else if (a.metric === "no_sync_days") {
        // Última sincronização por plataforma (proxy: created_at do provider_usage_syncs).
        let syncQ = supabaseAdmin
          .from("provider_usage_syncs")
          .select("platform_id, created_at")
          .not("platform_id", "is", null);
        if (a.scope === "platform" && a.scope_id) syncQ = syncQ.eq("platform_id", a.scope_id);
        const { data: syncs } = await syncQ.order("created_at", { ascending: false }).limit(2000);

        const { data: pfs } = await supabaseAdmin.from("platforms").select("id,name").eq("status", "active");
        const lastByPf = new Map<string, string>();
        for (const s of (syncs ?? []) as any[]) {
          if (s.platform_id && !lastByPf.has(s.platform_id)) lastByPf.set(s.platform_id, s.created_at);
        }
        const stale: { id: string; name: string; days: number }[] = [];
        for (const p of (pfs ?? []) as any[]) {
          if (a.scope === "platform" && a.scope_id && p.id !== a.scope_id) continue;
          const last = lastByPf.get(p.id);
          const days = last ? (Date.now() - new Date(last).getTime()) / 86400000 : Infinity;
          if (compare(days, a.comparison, a.threshold)) stale.push({ id: p.id, name: p.name, days: Number.isFinite(days) ? days : 999 });
        }
        if (stale.length === 0) {
          await supabaseAdmin.from("cost_alerts").update({ last_evaluated_at: new Date().toISOString() }).eq("id", a.id);
          continue;
        }
        // um evento por plataforma stale (com dedupe por alert+24h já falha se existir, aqui usaremos scope_id)
        for (const s of stale) {
          const staleKey = dedupeKeyFor({ ruleId: a.id, scope: "platform", scopeId: s.id, severity: "warning" });
          const dup = await suppressAsDuplicate({
            alertId: a.id,
            dedupeKey: staleKey,
            windowMinutes: a.dedupe_window_minutes,
            metricValue: s.days,
          });
          if (dup.suppressed) {
            deduped++;
            continue;
          }
          const { data: staleEvent } = await supabaseAdmin.from("alert_events").insert({
            alert_id: a.id,
            dedupe_key: staleKey,
            last_occurred_at: new Date().toISOString(),
            severity: "warning",
            title: `Sem sincronização há ${Math.floor(s.days)}d`,
            message: `Plataforma "${s.name}" não sincroniza há ${Math.floor(s.days)} dias.`,
            metric_value: s.days,
            threshold: a.threshold,
            scope: "platform",
            scope_id: s.id,
            scope_label: s.name,
          }).select("id, organization_id").maybeSingle();
          await notifyAlert({
            ruleId: a.id,
            ruleName: a.name,
            channel: a.channel,
            severity: "warning",
            title: `${a.name} — ${s.name}`,
            message: `Plataforma "${s.name}" não sincroniza há ${Math.floor(s.days)} dias.`,
            metricValue: s.days,
            threshold: Number(a.threshold),
            scopeLabel: s.name,
            periodLabel: periodLabelFor("no_sync_days", { days: s.days }),
          }, {
            alertEventId: (staleEvent as any)?.id ?? null,
            organizationId: (staleEvent as any)?.organization_id ?? null,
          });
          events.push({ alert_id: a.id, title: s.name, value: s.days });
        }

        await supabaseAdmin.from("cost_alerts").update({ last_evaluated_at: new Date().toISOString() }).eq("id", a.id);
        continue;
      }

      await supabaseAdmin.from("cost_alerts").update({ last_evaluated_at: new Date().toISOString() }).eq("id", a.id);

      if (!compare(value, a.comparison, a.threshold)) continue;

      const scopeLabel = await labelForScope(a.scope, a.scope_id);
      const severity = a.metric === "variance_pct" && value >= Number(a.threshold) * 2 ? "critical" : "warning";
      const dedupeKey = dedupeKeyFor({ ruleId: a.id, scope: a.scope, scopeId: a.scope_id, severity });
      const duplicate = await suppressAsDuplicate({
        alertId: a.id,
        dedupeKey,
        windowMinutes: a.dedupe_window_minutes,
        metricValue: value,
      });
      if (duplicate.suppressed) {
        deduped++;
        continue;
      }
      const { data: insertedEvent } = await supabaseAdmin.from("alert_events").insert({
        alert_id: a.id,
        dedupe_key: dedupeKey,
        last_occurred_at: new Date().toISOString(),
        severity,
        title: `${a.name} — ${scopeLabel}`,
        message,
        metric_value: value,
        threshold: a.threshold,
        scope: a.scope,
        scope_id: a.scope_id,
        scope_label: scopeLabel,
      }).select("id, organization_id").maybeSingle();

      const periodStart =
        a.metric === "daily_cost" ? iso(todayStart) : a.metric === "variance_pct" ? iso(prevStart) : iso(monthStart);
      const periodEnd = iso(now);
      const report = await buildCostEntriesReport({
        ruleId: a.id,
        ruleName: a.name,
        periodStart,
        periodEnd,
        scope: { scope: a.scope, scopeId: a.scope_id },
        organizationId: (insertedEvent as any)?.organization_id ?? null,
      });
      await notifyAlert({
        ruleId: a.id,
        ruleName: a.name,
        channel: a.channel,
        severity,
        title: `${a.name} — ${scopeLabel}`,
        message,
        metricValue: value,
        threshold: Number(a.threshold),
        scopeLabel,
        periodLabel: periodLabelFor(a.metric, { start: periodStart, end: periodEnd }),
        periodStart,
        periodEnd,
        reportUrl: report?.url ?? null,
        reportRows: report?.rows ?? null,
        reportTotalBrl: report?.totalBrl ?? null,
      }, {
        alertEventId: (insertedEvent as any)?.id ?? null,
        organizationId: (insertedEvent as any)?.organization_id ?? null,
      });
      events.push({ alert_id: a.id, title, value });

    } catch (err: any) {
      console.error(`[alerts] failed to evaluate ${a.id}:`, err?.message ?? err);
    }
  }

  return { evaluated, triggered: events.length, silenced, deduped, events };
}
