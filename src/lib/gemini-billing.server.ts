// Gemini / Vertex AI billing sync via BigQuery billing export.
// Requires the customer's GCP setup (see connect dialog help):
//  - BigQuery billing export enabled
//  - Service account with:
//      roles/bigquery.dataViewer on the dataset
//      roles/bigquery.jobUser on the BQ project
//      (optional) roles/monitoring.viewer on the Vertex project
//  - Config fields on provider_connections.config:
//      { gcp: { bq_project, bq_dataset, billing_account_id, bq_location?, gcp_project? } }

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  GCP_SCOPES,
  bigqueryQuery,
  getGcpAccessToken,
  parseServiceAccount,
  type BqRow,
} from "./gcp-auth.server";

export type SyncOutcome = {
  status: "success" | "skipped" | "error";
  records: number;
  message?: string;
  meta?: Record<string, any>;
};

async function getConnectionKey(connectionId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc("get_connection_api_key_internal", {
    _connection_id: connectionId,
  });
  if (error) throw new Error(`vault: ${error.message}`);
  return (data as string) ?? null;
}

function isoDate(d: Date | string): string {
  return (typeof d === "string" ? new Date(d) : d).toISOString().slice(0, 10);
}

export async function syncGeminiBilling(conn: any, rate: number): Promise<SyncOutcome> {
  const rawSa = await getConnectionKey(conn.id);
  if (!rawSa) {
    return {
      status: "skipped",
      records: 0,
      message: "Service account JSON não configurado. Edite a conexão e cole o JSON da service account.",
    };
  }

  const cfg = ((conn.config ?? {}) as any).gcp ?? {};
  const bqProject: string | undefined = cfg.bq_project;
  const bqDataset: string | undefined = cfg.bq_dataset;
  const billingId: string | undefined = cfg.billing_account_id;
  const bqLocation: string = cfg.bq_location ?? "US";

  const missing: string[] = [];
  if (!bqProject) missing.push("bq_project");
  if (!bqDataset) missing.push("bq_dataset");
  if (!billingId) missing.push("billing_account_id");
  if (missing.length) {
    return {
      status: "skipped",
      records: 0,
      message: `Configuração incompleta: falta ${missing.join(", ")}. Edite a conexão do Gemini.`,
    };
  }

  let sa;
  try {
    sa = parseServiceAccount(rawSa);
  } catch (e: any) {
    throw new Error(`Service account inválido: ${e.message}`);
  }

  const token = await getGcpAccessToken(sa, [GCP_SCOPES.bigqueryReadonly]);

  // Sync since last successful sync (bounded to 60d), else last 30d
  const now = new Date();
  const lookbackDays = 30;
  const since = conn.last_sync_at
    ? new Date(Math.max(new Date(conn.last_sync_at).getTime(), now.getTime() - 60 * 86400_000))
    : new Date(now.getTime() - lookbackDays * 86400_000);
  const startDate = isoDate(since);
  const endDate = isoDate(now);

  const billingIdEscaped = billingId!.replace(/-/g, "_");
  const tableIdent = `\`${bqProject}.${bqDataset}.gcp_billing_export_v1_${billingIdEscaped}\``;

  // Note: the export table name uses underscores where the billing account has hyphens? No —
  // Google keeps hyphens in the table name. We must quote with backticks and preserve hyphens.
  const tableIdentHyphen = `\`${bqProject}.${bqDataset}.gcp_billing_export_v1_${billingId}\``;

  const sql = `
    SELECT
      DATE(usage_start_time) AS usage_date,
      service.description AS service,
      sku.description AS sku,
      CAST(SUM(cost) AS FLOAT64) AS gross_cost,
      CAST(IFNULL(SUM((SELECT SUM(c.amount) FROM UNNEST(credits) c)), 0) AS FLOAT64) AS credits,
      CAST(SUM(usage.amount) AS FLOAT64) AS usage_amount,
      MAX(usage.unit) AS usage_unit
    FROM ${tableIdentHyphen}
    WHERE DATE(usage_start_time) BETWEEN DATE('${startDate}') AND DATE('${endDate}')
      AND (
        service.description LIKE '%Vertex AI%'
        OR service.description LIKE '%Generative Language%'
        OR sku.description LIKE '%Gemini%'
      )
    GROUP BY 1, 2, 3
    ORDER BY 1, 3
  `;

  let bq;
  try {
    bq = await bigqueryQuery(token, {
      projectId: bqProject!,
      location: bqLocation,
      query: sql,
      maximumBytesBilled: "10737418240",
    });
  } catch (e: any) {
    // Fallback: table name with underscores (some legacy exports)
    if (String(e.message).includes("Not found") || String(e.message).includes("Table")) {
      bq = await bigqueryQuery(token, {
        projectId: bqProject!,
        location: bqLocation,
        query: sql.replace(tableIdentHyphen, tableIdent),
        maximumBytesBilled: "10737418240",
      });
    } else {
      throw e;
    }
  }

  const rows: BqRow[] = bq.rows;
  if (rows.length === 0) {
    return {
      status: "success",
      records: 0,
      message: `Sem uso de Gemini/Vertex entre ${startDate} e ${endDate}`,
      meta: { bytes: bq.totalBytesProcessed },
    };
  }

  // Aggregate by day for cost_entries (one row per day), keep per-SKU in provider_usage_daily.
  const perDay = new Map<string, number>();
  let totalUsd = 0;

  // Replace window: delete existing entries in range (from this connection) then re-insert.
  await supabaseAdmin
    .from("cost_entries")
    .delete()
    .eq("provider_id", conn.provider_id)
    .gte("entry_date", startDate)
    .lte("entry_date", endDate)
    .contains("metadata", { connection_id: conn.id, source: "gcp_billing" });

  await supabaseAdmin
    .from("provider_usage_daily")
    .delete()
    .eq("connection_id", conn.id)
    .gte("usage_date", startDate)
    .lte("usage_date", endDate);

  const dailyRows: any[] = [];
  for (const r of rows) {
    const day = String(r.usage_date);
    const gross = Number(r.gross_cost ?? 0);
    const credits = Number(r.credits ?? 0);
    const net = gross + credits; // credits are negative
    const usageAmount = r.usage_amount != null ? Number(r.usage_amount) : null;
    const usageUnit = (r.usage_unit as string | null) ?? null;
    const sku = (r.sku as string | null) ?? "unknown";

    perDay.set(day, (perDay.get(day) ?? 0) + net);
    totalUsd += net;

    dailyRows.push({
      provider_id: conn.provider_id,
      platform_id: conn.platform_id,
      connection_id: conn.id,
      usage_date: day,
      model: sku,
      endpoint: r.service as string | null,
      input_tokens: null,
      output_tokens: null,
      requests: null,
      quantity: usageAmount,
      unit: usageUnit,
      cost_usd: net,
      exchange_rate: rate,
      cost_brl: net * rate,
      raw: r as any,
      synced_at: new Date().toISOString(),
    });
  }

  if (dailyRows.length) {
    const { error: dErr } = await supabaseAdmin.from("provider_usage_daily").insert(dailyRows);
    if (dErr) throw new Error(`provider_usage_daily: ${dErr.message}`);
  }

  const entries = Array.from(perDay.entries())
    .filter(([, usd]) => usd > 0.0001)
    .map(([day, usd]) => ({
      provider_id: conn.provider_id,
      platform_id: conn.platform_id,
      description: `Gemini/Vertex AI — ${day}`,
      entry_date: day,
      cost_usd: usd,
      exchange_rate: rate,
      cost_brl: usd * rate,
      origin: "api",
      metadata: { connection_id: conn.id, source: "gcp_billing" },
    }));

  if (entries.length) {
    const { error: eErr } = await supabaseAdmin.from("cost_entries").insert(entries);
    if (eErr) throw new Error(`cost_entries: ${eErr.message}`);
  }

  await supabaseAdmin.from("provider_usage_syncs").insert({
    provider_id: conn.provider_id,
    platform_id: conn.platform_id,
    period_start: startDate,
    period_end: endDate,
    usage_quantity: null,
    usage_unit: "usd",
    cost_usd: totalUsd,
    exchange_rate: rate,
    cost_brl: totalUsd * rate,
    raw_response: { rows_count: rows.length, bytes_processed: bq.totalBytesProcessed } as any,
  });

  return {
    status: "success",
    records: entries.length,
    message: `${entries.length} dias importados · US$ ${totalUsd.toFixed(2)} · ${rows.length} SKUs`,
    meta: { total_usd: totalUsd, skus: rows.length, bytes: bq.totalBytesProcessed },
  };
}
