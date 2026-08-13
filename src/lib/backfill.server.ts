import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type BackfillInput = {
  connectionId: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  purge?: boolean;
  /** Roda a reconciliação estimado x confirmado ao final do backfill. */
  reconcile?: boolean;
  initiatedBy?: string | null;
};

export type BackfillReconciliationSummary = {
  tolerance_pct: number;
  months: number;
  checked: number;
  divergent: number;
  created_events: number;
};

export type BackfillResult = {
  job_id: string | null;
  status: "success" | "partial" | "error";
  deleted_usage_rows: number;
  deleted_cost_entries: number;
  usage_rows: number;
  snapshots: number;
  invoices: number;
  records_imported: number;
  steps: { step: string; ok: boolean; message?: string; records?: number }[];
  reconciliation?: BackfillReconciliationSummary | null;
};


const DAY = 86_400_000;

/** Tempo máximo que um job de backfill pode ficar "running" antes de ser considerado travado. */
const STALE_BACKFILL_MINUTES = 30;

function formatBr(date: string) {
  const [y, m, d] = date.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Marca como erro jobs de backfill presos em "running" além do tempo limite, liberando a trava. */
async function releaseStaleBackfillLocks(connectionId: string) {
  const cutoff = new Date(Date.now() - STALE_BACKFILL_MINUTES * 60_000).toISOString();
  await supabaseAdmin
    .from("sync_jobs")
    .update({
      status: "error",
      finished_at: new Date().toISOString(),
      error_code: "backfill_timeout",
      error_message: `Backfill interrompido: sem atualização por mais de ${STALE_BACKFILL_MINUTES} minutos.`,
    })
    .eq("provider_connection_id", connectionId)
    .eq("sync_type", "backfill")
    .eq("status", "running")
    .lt("started_at", cutoff);
}

/** Retorna um backfill em execução na mesma conexão cujo período se sobreponha ao solicitado. */
async function findRunningBackfill(
  connectionId: string,
  periodStart: string,
  periodEnd: string,
  excludeJobId?: string,
) {
  let query = supabaseAdmin
    .from("sync_jobs")
    .select("id, period_start, period_end, started_at")
    .eq("provider_connection_id", connectionId)
    .eq("sync_type", "backfill")
    .eq("status", "running")
    .lte("period_start", periodEnd)
    .gte("period_end", periodStart)
    .order("started_at", { ascending: true })
    .limit(2);
  if (excludeJobId) query = query.neq("id", excludeJobId);
  const { data } = await query;
  return data?.[0] ?? null;
}


/**
 * Reprocessa custos de uma conexão em um período: opcionalmente limpa os
 * lançamentos vindos de API no intervalo, re-executa o sync de uso e billing e
 * reconstrói o uso diário a partir dos snapshots. Todo o andamento é gravado em
 * sync_jobs para auditoria.
 */
export async function runConnectionBackfill(input: BackfillInput): Promise<BackfillResult> {
  const {
    connectionId,
    periodStart,
    periodEnd,
    purge = true,
    reconcile = true,
    initiatedBy = null,
  } = input;


  const { data: conn, error: connErr } = await supabaseAdmin
    .from("provider_connections")
    .select("id, name, organization_id, provider_id, providers(name)")
    .eq("id", connectionId)
    .single();
  if (connErr || !conn) throw new Error("Conexão não encontrada");

  if (new Date(`${periodStart}T00:00:00Z`) > new Date(`${periodEnd}T00:00:00Z`)) {
    throw new Error("A data inicial deve ser anterior à data final");
  }

  await releaseStaleBackfillLocks(conn.id);
  const running = await findRunningBackfill(conn.id, periodStart, periodEnd);
  if (running) {
    const since = running.started_at ? new Date(running.started_at) : null;
    const minutes = since ? Math.max(1, Math.round((Date.now() - since.getTime()) / 60_000)) : null;
    const periodo =
      running.period_start && running.period_end
        ? ` para o período ${formatBr(running.period_start)} a ${formatBr(running.period_end)}`
        : "";
    throw new Error(
      `Já existe um backfill em execução nesta conexão${periodo}` +
        (minutes ? `, iniciado há ${minutes} min` : "") +
        ". Aguarde a conclusão ou escolha um período que não se sobreponha antes de tentar novamente.",
    );
  }

  const startedAt = new Date();

  const { data: job } = await supabaseAdmin
    .from("sync_jobs")
    .insert({
      organization_id: conn.organization_id,
      provider_connection_id: conn.id,
      sync_type: "backfill",
      trigger_type: "manual",
      status: "running",
      period_start: periodStart,
      period_end: periodEnd,
      started_at: startedAt.toISOString(),
      initiated_by: initiatedBy,
      metadata: { purge, provider: (conn as any).providers?.name ?? null },
    })
    .select("id")
    .single();

  // Segunda checagem: se outro job entrou em execução ao mesmo tempo, desiste do nosso.
  if (job?.id) {
    const competitor = await findRunningBackfill(conn.id, periodStart, periodEnd, job.id);
    if (competitor && (competitor.started_at ?? "") <= startedAt.toISOString()) {
      await supabaseAdmin
        .from("sync_jobs")
        .update({
          status: "cancelled",
          finished_at: new Date().toISOString(),
          error_code: "backfill_locked",
          error_message: "Cancelado: outro backfill já estava em execução para esta conexão e período.",
        })
        .eq("id", job.id);
      throw new Error(
        "Outro backfill acabou de iniciar para esta conexão e período. Aguarde a conclusão antes de tentar novamente.",
      );
    }
  }


  const steps: BackfillResult["steps"] = [];
  let deletedUsage = 0;
  let deletedEntries = 0;
  let usageRows = 0;
  let snapshots = 0;
  let invoices = 0;

  const finish = async (status: BackfillResult["status"], errorMessage?: string) => {
    if (!job?.id) return;
    await supabaseAdmin
      .from("sync_jobs")
      .update({
        status,
        finished_at: new Date().toISOString(),
        records_read: usageRows + snapshots + invoices,
        records_inserted: usageRows + invoices,
        records_updated: snapshots,
        records_skipped: deletedUsage + deletedEntries,
        error_count: steps.filter((s) => !s.ok).length,
        error_message: errorMessage ?? steps.find((s) => !s.ok)?.message ?? null,
        metadata: {
          purge,
          provider: (conn as any).providers?.name ?? null,
          deleted_usage_rows: deletedUsage,
          deleted_cost_entries: deletedEntries,
          steps,
        },
      })
      .eq("id", job.id);
  };

  try {
    if (purge) {
      const { data: removedUsage, error: usageErr } = await supabaseAdmin
        .from("provider_usage_daily")
        .delete()
        .eq("connection_id", conn.id)
        .gte("usage_date", periodStart)
        .lte("usage_date", periodEnd)
        .select("id");
      deletedUsage = removedUsage?.length ?? 0;
      steps.push({
        step: "Limpeza do uso diário",
        ok: !usageErr,
        message: usageErr?.message,
        records: deletedUsage,
      });

      const { data: removedEntries, error: entriesErr } = await supabaseAdmin
        .from("cost_entries")
        .delete()
        .eq("origin", "api")
        .contains("metadata", { connection_id: conn.id })
        .gte("entry_date", periodStart)
        .lte("entry_date", periodEnd)
        .select("id");
      deletedEntries = removedEntries?.length ?? 0;
      steps.push({
        step: "Limpeza de lançamentos de API",
        ok: !entriesErr,
        message: entriesErr?.message,
        records: deletedEntries,
      });
    }

    try {
      const { resetUsageBackfillWatermark } = await import("./usage-backfill.server");
      await resetUsageBackfillWatermark(conn.id);
      steps.push({ step: "Marcador de reprocessamento reiniciado", ok: true });
    } catch (err: any) {
      steps.push({ step: "Marcador de reprocessamento reiniciado", ok: false, message: String(err?.message ?? err) });
    }

    try {
      const { runSyncForConnection } = await import("./sync.server");
      const r: any = await runSyncForConnection(conn.id);
      steps.push({
        step: "Sincronização de uso e custos",
        ok: r?.ok !== false,
        message: r?.message,
        records: r?.records ?? 0,
      });
    } catch (err: any) {
      steps.push({ step: "Sincronização de uso e custos", ok: false, message: String(err?.message ?? err) });
    }

    try {
      const { runBillingSyncForConnection } = await import("./billing.server");
      const r: any = await runBillingSyncForConnection(conn.id);
      snapshots += r?.snapshots ?? 0;
      usageRows += r?.usage_rows ?? 0;
      invoices += r?.invoices ?? 0;
      steps.push({
        step: "Sincronização de billing e faturas",
        ok: r?.ok !== false,
        message: r?.message,
        records: (r?.snapshots ?? 0) + (r?.usage_rows ?? 0) + (r?.invoices ?? 0),
      });
    } catch (err: any) {
      steps.push({ step: "Sincronização de billing e faturas", ok: false, message: String(err?.message ?? err) });
    }

    try {
      const { aggregateUsageDailyFromSnapshots } = await import("./billing.server");
      const { getUsdBrlRate } = await import("./usd-rate.server");
      const rate = (await getUsdBrlRate()).rate;
      const days = Math.max(
        1,
        Math.ceil((Date.now() - new Date(`${periodStart}T00:00:00Z`).getTime()) / DAY) + 1,
      );
      const rows = await aggregateUsageDailyFromSnapshots(conn.id, rate, days);
      usageRows += rows;
      steps.push({ step: "Reconstrução do uso diário por snapshots", ok: true, records: rows });
    } catch (err: any) {
      steps.push({
        step: "Reconstrução do uso diário por snapshots",
        ok: false,
        message: String(err?.message ?? err),
      });
    }

    // Reconciliação automática ao final do backfill: compara estimado x confirmado
    // no período reprocessado e gera alertas quando a divergência excede a tolerância.
    if (reconcile) {
      try {
        const { runReconciliation } = await import("./reconciliation.server");
        const months = monthsBetween(periodStart, periodEnd);
        const r = await runReconciliation({ months, connectionIds: [conn.id] });
        reconciliation = {
          tolerance_pct: r.tolerance_pct,
          months: r.months,
          checked: r.rows.length,
          divergent: r.divergent,
          created_events: r.created_events,
        };
        steps.push({
          step: "Reconciliação automática de custos",
          ok: true,
          records: r.rows.length,
          message:
            r.divergent > 0
              ? `${r.divergent} mês(es) divergente(s) acima de ${r.tolerance_pct}% · ${r.created_events} alerta(s) gerado(s)`
              : `Sem divergências acima de ${r.tolerance_pct}%`,
        });
      } catch (err: any) {
        steps.push({
          step: "Reconciliação automática de custos",
          ok: false,
          message: String(err?.message ?? err),
        });
      }
    }

    const failed = steps.filter((s) => !s.ok).length;
    const status: BackfillResult["status"] = failed === 0 ? "success" : failed === steps.length ? "error" : "partial";
    await finish(status);

    return {
      job_id: job?.id ?? null,
      status,
      deleted_usage_rows: deletedUsage,
      deleted_cost_entries: deletedEntries,
      usage_rows: usageRows,
      snapshots,
      invoices,
      records_imported: usageRows + snapshots + invoices,
      steps,
      reconciliation,
    };

  } catch (err: any) {
    const message = String(err?.message ?? err);
    await finish("error", message);
    throw new Error(message);
  }
}
