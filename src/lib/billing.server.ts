// Server-only billing sync logic (plans, quotas, per-model usage).
// Uses supabaseAdmin (service role) to read vault-stored API keys via
// get_connection_api_key_internal.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type BillingOutcome = {
  status: "success" | "skipped" | "error";
  message?: string;
  snapshots: number;
  usage_rows: number;
  invoices: number;
  meta?: Record<string, any>;
};

async function fetchUsdBrlRateRemote(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados/ultimos/1?formato=json",
      { headers: { Accept: "application/json" } },
    );
    if (res.ok) {
      const json: any = await res.json();
      const row = Array.isArray(json) ? json[0] : null;
      const val = Number(row?.valor?.replace?.(",", ".") ?? row?.valor);
      if (Number.isFinite(val) && val > 0) return val;
    }
  } catch {}
  try {
    const res = await fetch("https://economia.awesomeapi.com.br/json/last/USD-BRL");
    if (res.ok) {
      const json: any = await res.json();
      const bid = Number(json?.USDBRL?.bid);
      if (Number.isFinite(bid) && bid > 0) return bid;
    }
  } catch {}
  return null;
}

async function fetchUsdBrlRate(): Promise<number> {
  // Respect manual override — never overwrite it.
  const { data: existing } = await supabaseAdmin
    .from("system_settings")
    .select("value")
    .eq("key", "usd_brl_rate")
    .maybeSingle();
  const current = (existing?.value as any) ?? null;
  if (current?.manual === true && Number.isFinite(Number(current.rate)) && Number(current.rate) > 0) {
    return Number(current.rate);
  }
  const fetched = await fetchUsdBrlRateRemote();
  if (fetched) {
    await supabaseAdmin
      .from("system_settings")
      .upsert({ key: "usd_brl_rate", value: { rate: fetched, updated_at: new Date().toISOString() } });
    return fetched;
  }
  if (current?.rate && Number(current.rate) > 0) return Number(current.rate);
  return 5.0;
}

async function getConnectionKey(connectionId: string, fallbackEnv?: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc("get_connection_api_key_internal", {
    _connection_id: connectionId,
  });
  if (!error && data) return data as string;
  if (fallbackEnv && process.env[fallbackEnv]) return process.env[fallbackEnv]!;
  return null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthCycle(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const daysElapsed = Math.max(1, Math.floor((now.getTime() - start.getTime()) / 86400_000) + 1);
  const daysInCycle = end.getDate();
  return { start, end, daysElapsed, daysInCycle };
}

async function upsertUsageDaily(row: {
  connection_id: string;
  provider_id: string;
  platform_id: string | null;
  usage_date: string;
  model?: string;
  endpoint?: string;
  input_tokens?: number;
  output_tokens?: number;
  requests?: number;
  quantity?: number;
  unit?: string | null;
  cost_usd?: number;
  exchange_rate: number;
  raw?: any;
}) {
  const cost_usd = row.cost_usd ?? 0;
  await supabaseAdmin.from("provider_usage_daily").upsert(
    {
      connection_id: row.connection_id,
      provider_id: row.provider_id,
      platform_id: row.platform_id,
      usage_date: row.usage_date,
      model: row.model ?? "",
      endpoint: row.endpoint ?? "",
      input_tokens: row.input_tokens ?? 0,
      output_tokens: row.output_tokens ?? 0,
      requests: row.requests ?? 0,
      quantity: row.quantity ?? 0,
      unit: row.unit ?? null,
      cost_usd,
      exchange_rate: row.exchange_rate,
      cost_brl: cost_usd * row.exchange_rate,
      raw: row.raw ?? null,
      synced_at: new Date().toISOString(),
    },
    { onConflict: "connection_id,usage_date,model,endpoint" },
  );
}

// ---------- Firecrawl ----------
async function syncFirecrawlBilling(conn: any, rate: number): Promise<BillingOutcome> {
  const key = await getConnectionKey(conn.id, "FIRECRAWL_API_KEY");
  if (!key) throw new Error("API key da Firecrawl não configurada nesta conexão.");

  const headers = { Authorization: `Bearer ${key}` };

  // 1) Snapshot atual do plano
  const usageRes = await fetch("https://api.firecrawl.dev/v2/team/credit-usage", { headers });
  if (!usageRes.ok) throw new Error(`Firecrawl API ${usageRes.status}: ${await usageRes.text()}`);
  const usageJson: any = await usageRes.json();
  const total = Number(usageJson?.data?.plan_credits ?? 0);
  const remaining = Number(usageJson?.data?.remaining_credits ?? 0);
  const used = Math.max(0, total - remaining);

  const cycle = monthCycle();
  const projected = cycle.daysElapsed > 0 ? (used / cycle.daysElapsed) * cycle.daysInCycle : used;

  const cfg = (conn.config ?? {}) as any;
  const planMonthlyUsd = Number(cfg.plan_monthly_usd ?? 0);
  const planLabel = cfg.plan_name
    ? String(cfg.plan_name)
    : total > 0 ? `${total} credits/mo` : "pay-as-you-go";

  await supabaseAdmin.from("provider_billing_snapshots").insert({
    connection_id: conn.id,
    provider_id: conn.provider_id,
    platform_id: conn.platform_id,
    plan_name: planLabel,
    plan_tier: null,
    billing_cycle: "monthly",
    cycle_start: isoDate(cycle.start),
    cycle_end: isoDate(cycle.end),
    included_quantity: total,
    included_unit: "credits",
    used_quantity: used,
    remaining_quantity: remaining,
    cost_period_usd: planMonthlyUsd > 0 ? planMonthlyUsd : null,
    projected_cost_usd: planMonthlyUsd > 0 ? planMonthlyUsd : null,
    currency: "USD",
    raw: usageJson,
  });

  // 2) Uso histórico → usage_daily
  let usageRows = 0;
  try {
    const histRes = await fetch(
      "https://api.firecrawl.dev/v2/team/credit-usage-historical?byApiKey=false",
      { headers },
    );
    if (histRes.ok) {
      const histJson: any = await histRes.json();
      const days: any[] = Array.isArray(histJson?.data) ? histJson.data : histJson?.data?.usage ?? [];
      for (const d of days) {
        const date = d?.date ?? d?.day ?? d?.timestamp;
        const credits = Number(d?.credits ?? d?.creditsUsed ?? d?.usage ?? 0);
        if (!date || credits <= 0) continue;
        const iso = new Date(date).toISOString().slice(0, 10);
        await upsertUsageDaily({
          connection_id: conn.id,
          provider_id: conn.provider_id,
          platform_id: conn.platform_id,
          usage_date: iso,
          quantity: credits,
          unit: "credits",
          exchange_rate: rate,
          raw: d,
        });
        usageRows += 1;
      }
    }
  } catch {}

  return {
    status: "success",
    message: `Plano: ${used}/${total} créditos (proj. ${projected.toFixed(0)})`,
    snapshots: 1,
    usage_rows: usageRows,
    invoices: 0,
    meta: { used, remaining, total, projected },
  };
}

// ---------- OpenAI ----------
const OPENAI_USAGE_ENDPOINTS: { path: string; endpoint: string; unit: string }[] = [
  { path: "completions", endpoint: "chat/completions", unit: "tokens" },
  { path: "embeddings", endpoint: "embeddings", unit: "tokens" },
  { path: "images", endpoint: "images", unit: "images" },
  { path: "audio_speeches", endpoint: "audio/speech", unit: "characters" },
  { path: "audio_transcriptions", endpoint: "audio/transcriptions", unit: "seconds" },
  { path: "moderations", endpoint: "moderations", unit: "requests" },
];

async function syncOpenAIBilling(conn: any, rate: number): Promise<BillingOutcome> {
  const key = await getConnectionKey(conn.id, "OPENAI_ADMIN_KEY");
  if (!key)
    throw new Error(
      "Admin key da OpenAI não configurada. Gere em Settings → Admin keys (sk-admin-...) e salve nesta conexão.",
    );
  const cfg = (conn.config ?? {}) as any;
  const cycle = monthCycle();
  const startTime = Math.floor(cycle.start.getTime() / 1000);
  const endTime = Math.floor(Date.now() / 1000);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  if (cfg.org_id) headers["OpenAI-Organization"] = String(cfg.org_id);

  // 1) Uso detalhado por endpoint/modelo
  let usageRows = 0;
  for (const cfgEp of OPENAI_USAGE_ENDPOINTS) {
    const url = new URL(`https://api.openai.com/v1/organization/usage/${cfgEp.path}`);
    url.searchParams.set("start_time", String(startTime));
    url.searchParams.set("end_time", String(endTime));
    url.searchParams.set("bucket_width", "1d");
    url.searchParams.set("group_by", "model");
    url.searchParams.set("limit", "180");
    const res = await fetch(url, { headers });
    if (!res.ok) continue; // pula endpoints não habilitados no plano
    const json: any = await res.json();
    const buckets: any[] = Array.isArray(json?.data) ? json.data : [];
    for (const b of buckets) {
      const day = b?.start_time ? isoDate(new Date(b.start_time * 1000)) : isoDate(new Date());
      const results: any[] = Array.isArray(b?.results) ? b.results : [];
      for (const r of results) {
        const model = String(r?.model ?? "");
        const requests = Number(r?.num_model_requests ?? r?.num_requests ?? 0);
        const inTok = Number(r?.input_tokens ?? 0);
        const outTok = Number(r?.output_tokens ?? 0);
        const quantity =
          Number(r?.images ?? r?.characters ?? r?.seconds ?? 0) || inTok + outTok || requests;
        if (!requests && !quantity) continue;
        await upsertUsageDaily({
          connection_id: conn.id,
          provider_id: conn.provider_id,
          platform_id: conn.platform_id,
          usage_date: day,
          model,
          endpoint: cfgEp.endpoint,
          input_tokens: inTok,
          output_tokens: outTok,
          requests,
          quantity,
          unit: cfgEp.unit,
          exchange_rate: rate,
          raw: r,
        });
        usageRows += 1;
      }
    }
  }

  // 2) Snapshot do ciclo baseado em /organization/costs
  const costsUrl = new URL("https://api.openai.com/v1/organization/costs");
  costsUrl.searchParams.set("start_time", String(startTime));
  costsUrl.searchParams.set("end_time", String(endTime));
  costsUrl.searchParams.set("bucket_width", "1d");
  costsUrl.searchParams.set("limit", "180");
  const costsRes = await fetch(costsUrl, { headers });
  let totalUsd = 0;
  let costsJson: any = null;
  if (costsRes.ok) {
    costsJson = await costsRes.json();
    for (const b of costsJson?.data ?? []) {
      for (const r of b?.results ?? []) {
        totalUsd += Number(r?.amount?.value ?? 0);
      }
    }
  }
  const projected =
    cycle.daysElapsed > 0 ? (totalUsd / cycle.daysElapsed) * cycle.daysInCycle : totalUsd;

  await supabaseAdmin.from("provider_billing_snapshots").insert({
    connection_id: conn.id,
    provider_id: conn.provider_id,
    platform_id: conn.platform_id,
    plan_name: "pay-as-you-go",
    plan_tier: cfg.plan_tier ?? null,
    billing_cycle: "monthly",
    cycle_start: isoDate(cycle.start),
    cycle_end: isoDate(cycle.end),
    hard_limit_usd: cfg.hard_limit_usd ?? null,
    soft_limit_usd: cfg.soft_limit_usd ?? null,
    cost_period_usd: totalUsd,
    projected_cost_usd: projected,
    currency: "USD",
    raw: costsJson,
  });

  return {
    status: "success",
    message: `US$ ${totalUsd.toFixed(2)} no ciclo · proj. US$ ${projected.toFixed(2)}`,
    snapshots: 1,
    usage_rows: usageRows,
    invoices: 0,
    meta: { total_usd: totalUsd, projected_usd: projected },
  };
}

// ---------- GCP (Gemini) via BigQuery billing export ----------
function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = "";
  for (let i = 0; i < arr.byteLength; i++) str += String.fromCharCode(arr[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function signGcpJwt(
  sa: { client_email: string; private_key: string; token_uri?: string },
  scope: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope,
    aud: sa.token_uri || "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const enc = new TextEncoder();
  const headerB64 = b64urlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const keyBuf = pemToArrayBuffer(sa.private_key);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBuf,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, enc.encode(signingInput));
  return `${signingInput}.${b64urlEncode(sig)}`;
}

async function getGcpAccessToken(sa: any): Promise<string> {
  const jwt = await signGcpJwt(sa, "https://www.googleapis.com/auth/bigquery.readonly");
  const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`GCP OAuth ${res.status}: ${await res.text()}`);
  const json: any = await res.json();
  if (!json.access_token) throw new Error("GCP OAuth: sem access_token");
  return json.access_token as string;
}

async function runBigQuery(
  accessToken: string,
  projectId: string,
  query: string,
  params: { name: string; type: string; value: string }[] = [],
): Promise<any[]> {
  const res = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        useLegacySql: false,
        timeoutMs: 30000,
        maximumBytesBilled: "10737418240",
        parameterMode: "NAMED",
        queryParameters: params.map((p) => ({
          name: p.name,
          parameterType: { type: p.type },
          parameterValue: { value: p.value },
        })),
      }),
    },
  );
  if (!res.ok) throw new Error(`BigQuery ${res.status}: ${await res.text()}`);
  const json: any = await res.json();
  if (!json.jobComplete) throw new Error("BigQuery: job não completou no timeout");
  const schema: any[] = json.schema?.fields ?? [];
  const rows: any[] = json.rows ?? [];
  return rows.map((r) => {
    const obj: Record<string, any> = {};
    r.f.forEach((cell: any, i: number) => (obj[schema[i].name] = cell.v));
    return obj;
  });
}

async function syncGCPBilling(conn: any, rate: number): Promise<BillingOutcome> {
  const cfg = (conn.config ?? {}) as any;
  let sa = cfg.service_account_json;
  const dataset = cfg.billing_export_dataset as string | undefined;
  if (!sa || !dataset) {
    return {
      status: "skipped",
      message:
        "Configure service_account_json e billing_export_dataset (ex: 'meu-projeto.billing_export') em 'Configurar GCP' na conexão.",
      snapshots: 0,
      usage_rows: 0,
      invoices: 0,
    };
  }
  if (typeof sa === "string") {
    try {
      sa = JSON.parse(sa);
    } catch {
      throw new Error("service_account_json inválido (JSON não parseável).");
    }
  }
  if (!sa.client_email || !sa.private_key || !sa.project_id) {
    throw new Error("service_account_json faltando client_email/private_key/project_id.");
  }

  const cycle = monthCycle();
  const startIso = isoDate(cycle.start);
  const runProject = cfg.billing_run_project || sa.project_id;
  const token = await getGcpAccessToken(sa);

  const [dsProject, dsName] = dataset.includes(".")
    ? dataset.split(".")
    : [sa.project_id, dataset];
  const table = `\`${dsProject}.${dsName}.gcp_billing_export_v1_*\``;
  const filter = `(
      LOWER(service.description) LIKE '%gemini%'
      OR LOWER(service.description) LIKE '%generative language%'
      OR LOWER(service.description) LIKE '%vertex ai%'
      OR LOWER(sku.description) LIKE '%gemini%'
    )`;

  // 1) Uso diário por SKU (modelo)
  const usageSql = `
    SELECT
      FORMAT_DATE('%Y-%m-%d', DATE(usage_start_time)) AS day,
      sku.description AS sku,
      service.description AS service,
      SUM(cost) AS cost_usd,
      SUM(IFNULL(usage.amount, 0)) AS usage_amount,
      ANY_VALUE(usage.unit) AS usage_unit
    FROM ${table}
    WHERE DATE(_PARTITIONTIME) >= DATE_SUB(@start, INTERVAL 2 DAY)
      AND DATE(usage_start_time) >= @start
      AND ${filter}
    GROUP BY day, sku, service
    ORDER BY day
  `;
  const usageRowsRaw = await runBigQuery(token, runProject, usageSql, [
    { name: "start", type: "DATE", value: startIso },
  ]);

  let usageRows = 0;
  for (const r of usageRowsRaw) {
    const cost = Number(r.cost_usd ?? 0);
    const amount = Number(r.usage_amount ?? 0);
    if (cost <= 0 && amount <= 0) continue;
    await upsertUsageDaily({
      connection_id: conn.id,
      provider_id: conn.provider_id,
      platform_id: conn.platform_id,
      usage_date: String(r.day),
      model: String(r.sku ?? ""),
      endpoint: String(r.service ?? ""),
      quantity: amount,
      unit: r.usage_unit ? String(r.usage_unit) : null,
      cost_usd: cost,
      exchange_rate: rate,
      raw: r,
    });
    usageRows += 1;
  }

  // 2) Snapshot
  const totalUsd = usageRowsRaw.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
  const projected =
    cycle.daysElapsed > 0 ? (totalUsd / cycle.daysElapsed) * cycle.daysInCycle : totalUsd;

  await supabaseAdmin.from("provider_billing_snapshots").insert({
    connection_id: conn.id,
    provider_id: conn.provider_id,
    platform_id: conn.platform_id,
    plan_name: "Google Cloud (pay-as-you-go)",
    plan_tier: cfg.plan_tier ?? null,
    billing_cycle: "monthly",
    cycle_start: isoDate(cycle.start),
    cycle_end: isoDate(cycle.end),
    hard_limit_usd: cfg.hard_limit_usd ?? null,
    soft_limit_usd: cfg.soft_limit_usd ?? null,
    cost_period_usd: totalUsd,
    projected_cost_usd: projected,
    currency: "USD",
    raw: { source: "bigquery", dataset, rows: usageRowsRaw.length },
  });

  // 3) Faturas mensais (últimos 6 meses fechados)
  let invoicesCount = 0;
  try {
    const invSql = `
      SELECT
        invoice.month AS invoice_month,
        SUM(cost) AS gross_usd,
        SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS net_usd
      FROM ${table}
      WHERE invoice.month IS NOT NULL
        AND PARSE_DATE('%Y%m', invoice.month) >= DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH)
        AND ${filter}
      GROUP BY invoice_month
      ORDER BY invoice_month
    `;
    const invRows = await runBigQuery(token, runProject, invSql);
    for (const r of invRows) {
      const month = String(r.invoice_month);
      const y = Number(month.slice(0, 4));
      const m = Number(month.slice(4, 6));
      if (!y || !m) continue;
      const periodStart = new Date(y, m - 1, 1);
      const periodEnd = new Date(y, m, 0);
      const net = Number(r.net_usd ?? 0);
      const gross = Number(r.gross_usd ?? 0);
      const amount = net > 0 ? net : gross;
      if (amount <= 0) continue;

      const { data: existing } = await supabaseAdmin
        .from("provider_invoices")
        .select("id")
        .eq("connection_id", conn.id)
        .eq("period_start", isoDate(periodStart))
        .eq("source", "api")
        .maybeSingle();

      const payload = {
        connection_id: conn.id,
        provider_id: conn.provider_id,
        platform_id: conn.platform_id,
        invoice_number: `GCP-${month}`,
        issued_at: isoDate(periodEnd),
        period_start: isoDate(periodStart),
        period_end: isoDate(periodEnd),
        amount_usd: amount,
        exchange_rate: rate,
        amount_brl: amount * rate,
        status: "paid",
        pdf_url: null,
        source: "api",
        notes: `Agregado BigQuery (bruto US$ ${gross.toFixed(2)})`,
        raw: r,
      };
      if (existing) {
        await supabaseAdmin.from("provider_invoices").update(payload).eq("id", existing.id);
      } else {
        await supabaseAdmin.from("provider_invoices").insert(payload);
      }
      invoicesCount += 1;
    }
  } catch (err: any) {
    console.warn("[GCP billing] invoices skipped:", err?.message);
  }

  return {
    status: "success",
    message: `US$ ${totalUsd.toFixed(2)} no ciclo · proj. US$ ${projected.toFixed(2)} · ${usageRows} linhas de uso`,
    snapshots: 1,
    usage_rows: usageRows,
    invoices: invoicesCount,
    meta: { total_usd: totalUsd, projected_usd: projected, dataset, run_project: runProject },
  };
}

const HANDLERS: Record<string, (c: any, r: number) => Promise<BillingOutcome>> = {
  Firecrawl: syncFirecrawlBilling,
  OpenAI: syncOpenAIBilling,
  Gemini: syncGCPBilling,
  "Google Gemini": syncGCPBilling,
};

export async function runBillingSyncForConnection(connectionId: string) {
  const { data: conn, error } = await supabaseAdmin
    .from("provider_connections")
    .select("*, providers(name)")
    .eq("id", connectionId)
    .single();
  if (error || !conn) throw new Error("Conexão não encontrada");
  const providerName = (conn as any).providers?.name as string;
  const started = new Date();

  const { data: logRow } = await supabaseAdmin
    .from("sync_logs")
    .insert({
      provider_id: conn.provider_id,
      connection_id: conn.id,
      status: "running",
      metadata: { job: "billing" },
    })
    .select("id")
    .single();

  try {
    const rate = await fetchUsdBrlRate();
    const handler = HANDLERS[providerName];
    let out: BillingOutcome;
    if (!handler) {
      out = {
        status: "skipped",
        message: `Billing automático para "${providerName}" ainda não implementado.`,
        snapshots: 0,
        usage_rows: 0,
        invoices: 0,
      };
    } else {
      out = await handler(conn, rate);
    }

    await supabaseAdmin
      .from("sync_logs")
      .update({
        status: out.status,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - started.getTime(),
        records_imported: out.snapshots + out.usage_rows + out.invoices,
        error_message: out.status === "skipped" ? out.message ?? null : null,
        metadata: { job: "billing", ...(out.meta ?? {}), message: out.message },
      })
      .eq("id", logRow!.id);

    return { ok: out.status !== "error", ...out };
  } catch (err: any) {
    const message = String(err?.message ?? err);
    await supabaseAdmin
      .from("sync_logs")
      .update({
        status: "error",
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - started.getTime(),
        error_message: message,
        metadata: { job: "billing" },
      })
      .eq("id", logRow!.id);
    throw new Error(message);
  }
}

export async function runBillingSyncAll() {
  const { data: conns } = await supabaseAdmin
    .from("provider_connections")
    .select("id, name")
    .eq("status", "active");
  const results: any[] = [];
  for (const c of conns ?? []) {
    try {
      const r = await runBillingSyncForConnection(c.id);
      results.push({ id: c.id, name: c.name, ...r });
    } catch (err: any) {
      results.push({ id: c.id, name: c.name, ok: false, error: String(err?.message ?? err) });
    }
  }
  return { total: results.length, results };
}
