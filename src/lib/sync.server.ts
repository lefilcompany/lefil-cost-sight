// Server-only sync logic. Uses supabaseAdmin (service role) so it can read
// API keys from vault via get_connection_api_key_internal.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type SyncOutcome = {
  status: "success" | "skipped" | "error";
  records: number;
  message?: string;
  meta?: Record<string, any>;
};

async function fetchUsdBrlRate(): Promise<number | null> {
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

async function resolveUsdBrlRate(): Promise<number> {
  // Respect manual override — never overwrite it during syncs.
  const { data: existing } = await supabaseAdmin
    .from("system_settings")
    .select("value")
    .eq("key", "usd_brl_rate")
    .maybeSingle();
  const current = (existing?.value as any) ?? null;
  if (current?.manual === true && Number.isFinite(Number(current.rate)) && Number(current.rate) > 0) {
    return Number(current.rate);
  }
  const fetched = await fetchUsdBrlRate();
  if (fetched) {
    await supabaseAdmin
      .from("system_settings")
      .upsert({ key: "usd_brl_rate", value: { rate: fetched, updated_at: new Date().toISOString() } });
    return fetched;
  }
  // Fallback: keep the last known rate if fetch failed, else 5.0 as a last resort.
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

async function fcFetch(path: string, key: string): Promise<any> {
  const res = await fetch(`https://api.firecrawl.dev/v2${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Firecrawl ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

async function syncFirecrawl(conn: any, rate: number): Promise<SyncOutcome> {
  const key = await getConnectionKey(conn.id, "FIRECRAWL_API_KEY");
  if (!key) throw new Error("API key da Firecrawl não configurada nesta conexão.");

  const [credits, tokens, creditsHist, tokensHist] = await Promise.all([
    fcFetch("/team/credit-usage", key).catch((e) => ({ error: String(e?.message ?? e) })),
    fcFetch("/team/token-usage", key).catch((e) => ({ error: String(e?.message ?? e) })),
    fcFetch("/team/credit-usage/historical?byApiKey=true", key).catch((e) => ({ error: String(e?.message ?? e) })),
    fcFetch("/team/token-usage/historical?byApiKey=true", key).catch((e) => ({ error: String(e?.message ?? e) })),
  ]);

  const cData = credits?.data ?? {};
  const tData = tokens?.data ?? {};
  const remainingCredits = Number(cData.remaining_credits ?? cData.remainingCredits ?? 0);
  const totalCredits = Number(cData.plan_credits ?? cData.planCredits ?? 0);
  const usedCredits = Math.max(0, totalCredits - remainingCredits);
  const remainingTokens = Number(tData.remaining_tokens ?? tData.remainingTokens ?? 0);
  const totalTokens = Number(tData.plan_tokens ?? tData.planTokens ?? 0);
  const usedTokens = Math.max(0, totalTokens - remainingTokens);
  const billingPeriodStart = cData.billing_period_start ?? cData.billingPeriodStart ?? null;
  const billingPeriodEnd = cData.billing_period_end ?? cData.billingPeriodEnd ?? null;

  const now = new Date();
  const start = billingPeriodStart ? new Date(billingPeriodStart) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = billingPeriodEnd ? new Date(billingPeriodEnd) : now;

  const cfg = (conn.config ?? {}) as any;
  const pricePer1k = Number(cfg.usd_per_1k_credits ?? 0);
  const planMonthlyUsd = Number(cfg.plan_monthly_usd ?? 0);
  // Firecrawl é plano fixo: se houver plan_monthly_usd, usamos ele como custo do ciclo.
  // Caso contrário, calcula por créditos consumidos.
  const costUsd = planMonthlyUsd > 0
    ? planMonthlyUsd
    : pricePer1k > 0 ? (usedCredits / 1000) * pricePer1k : 0;
  const costBrl = costUsd * rate;

  await supabaseAdmin.from("provider_usage_syncs").insert({
    provider_id: conn.provider_id,
    platform_id: conn.platform_id,
    period_start: isoDate(start),
    period_end: isoDate(end),
    usage_quantity: usedCredits,
    usage_unit: "credits",
    cost_usd: costUsd,
    exchange_rate: rate,
    cost_brl: costBrl,
    raw_response: {
      credits,
      tokens,
      credits_historical: creditsHist,
      tokens_historical: tokensHist,
      summary: {
        credits: { used: usedCredits, remaining: remainingCredits, total: totalCredits },
        tokens: { used: usedTokens, remaining: remainingTokens, total: totalTokens },
        billing_period: { start: billingPeriodStart, end: billingPeriodEnd },
        pricing: { usd_per_1k_credits: pricePer1k, cost_usd: costUsd },
      },
    },
  });

  // Upsert one cost_entries row per (connection, billing period) so o dashboard/financeiro reflete o Firecrawl.
  if (costUsd > 0) {
    const dayIso = isoDate(start);
    const description = `Firecrawl — ciclo ${isoDate(start)}→${isoDate(end)}`;
    await supabaseAdmin
      .from("cost_entries")
      .delete()
      .eq("provider_id", conn.provider_id)
      .eq("origin", "api")
      .contains("metadata", { connection_id: conn.id, source: "firecrawl_credits" });
    await supabaseAdmin.from("cost_entries").insert({
      provider_id: conn.provider_id,
      platform_id: conn.platform_id,
      description,
      entry_date: dayIso,
      cost_usd: costUsd,
      exchange_rate: rate,
      cost_brl: costBrl,
      origin: "api",
      metadata: {
        connection_id: conn.id,
        source: "firecrawl_credits",
        billing_period_start: isoDate(start),
        billing_period_end: isoDate(end),
        used_credits: usedCredits,
        usd_per_1k_credits: pricePer1k,
        plan_monthly_usd: planMonthlyUsd,
      },
    });
  }

  // Snapshot de plano/quota → alimenta a página Billing automaticamente
  try {
    const projected = planMonthlyUsd > 0
      ? planMonthlyUsd
      : (() => {
          const daysTotal = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400_000) + 1);
          const daysElapsed = Math.max(1, Math.round((now.getTime() - start.getTime()) / 86400_000) + 1);
          return costUsd > 0 ? (costUsd / daysElapsed) * daysTotal : 0;
        })();
    await supabaseAdmin.from("provider_billing_snapshots").insert({
      connection_id: conn.id,
      provider_id: conn.provider_id,
      platform_id: conn.platform_id,
      plan_name: cfg.plan_name ?? (totalCredits > 0 ? `${totalCredits.toLocaleString("en-US")} credits/mo` : "pay-as-you-go"),
      billing_cycle: "monthly",
      cycle_start: isoDate(start),
      cycle_end: isoDate(end),
      included_quantity: totalCredits,
      included_unit: "credits",
      used_quantity: usedCredits,
      remaining_quantity: remainingCredits,
      cost_period_usd: costUsd > 0 ? costUsd : (planMonthlyUsd > 0 ? planMonthlyUsd : null),
      projected_cost_usd: projected > 0 ? projected : null,
      currency: "USD",
      raw: { credits: cData, tokens: tData },
    });
  } catch (e) {
    console.warn("firecrawl billing snapshot failed", e);
  }

  return {
    status: "success",
    records: 1,
    message: `Créditos: ${usedCredits.toLocaleString("pt-BR")}/${totalCredits.toLocaleString("pt-BR")} · Tokens: ${usedTokens.toLocaleString("pt-BR")}/${totalTokens.toLocaleString("pt-BR")}${costUsd > 0 ? ` · ~US$ ${costUsd.toFixed(2)}` : ""}`,
    meta: {
      credits: { used: usedCredits, remaining: remainingCredits, total: totalCredits },
      tokens: { used: usedTokens, remaining: remainingTokens, total: totalTokens },
      billing_period: { start: billingPeriodStart, end: billingPeriodEnd },
      cost_usd: costUsd,

    },
  };
}


async function syncOpenAI(conn: any, rate: number): Promise<SyncOutcome> {
  const key = await getConnectionKey(conn.id, "OPENAI_ADMIN_KEY");
  if (!key) throw new Error("Admin key da OpenAI não configurada. Gere em Settings → Admin keys (sk-admin-...) e salve nesta conexão.");
  const cfg = (conn.config ?? {}) as any;
  // Sync since last successful sync (or last 7 days).
  const now = new Date();
  // OpenAI Costs API requires day-aligned UTC timestamps and end_time strictly after start_time.
  const endUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const sinceRaw = conn.last_sync_at ? new Date(conn.last_sync_at) : new Date(now.getTime() - 7 * 86400_000);
  let startUtc = new Date(Date.UTC(sinceRaw.getUTCFullYear(), sinceRaw.getUTCMonth(), sinceRaw.getUTCDate()));
  if (startUtc.getTime() >= endUtc.getTime()) {
    startUtc = new Date(endUtc.getTime() - 86400_000);
  }
  const startTime = Math.floor(startUtc.getTime() / 1000);
  const endTime = Math.floor(endUtc.getTime() / 1000);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  if (cfg.org_id) headers["OpenAI-Organization"] = String(cfg.org_id);

  // Fetch all pages of the OpenAI Costs API following has_more/next_page cursors.
  async function fetchAllCostBuckets(params: Record<string, string>): Promise<any[]> {
    const all: any[] = [];
    let page: string | undefined = undefined;
    // Hard safety cap to avoid infinite loops on unexpected API responses.
    for (let i = 0; i < 200; i++) {
      const u = new URL("https://api.openai.com/v1/organization/costs");
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      if (page) u.searchParams.set("page", page);
      const r = await fetch(u, { headers });
      if (!r.ok) throw new Error(`OpenAI Costs API ${r.status}: ${await r.text()}`);
      const j: any = await r.json();
      if (Array.isArray(j?.data)) all.push(...j.data);
      if (!j?.has_more || !j?.next_page) break;
      page = String(j.next_page);
    }
    return all;
  }

  const baseParams = {
    start_time: String(startTime),
    end_time: String(endTime),
    bucket_width: "1d",
    limit: "180",
  };
  const buckets = await fetchAllCostBuckets(baseParams);

  let totalUsd = 0;
  let inserted = 0;

  for (const bucket of buckets) {
    const results: any[] = Array.isArray(bucket?.results) ? bucket.results : [];
    const bucketStart = bucket?.start_time ? new Date(bucket.start_time * 1000) : null;
    const bucketEnd = bucket?.end_time ? new Date(bucket.end_time * 1000) : null;
    const dayIso = bucketStart ? isoDate(bucketStart) : isoDate(now);
    let bucketUsd = 0;
    for (const r of results) {
      const amt = Number(r?.amount?.value ?? 0);
      if (Number.isFinite(amt)) bucketUsd += amt;
    }
    if (bucketUsd <= 0) continue;
    totalUsd += bucketUsd;
    const costBrl = bucketUsd * rate;

    await supabaseAdmin.from("provider_usage_syncs").insert({
      provider_id: conn.provider_id,
      platform_id: conn.platform_id,
      period_start: bucketStart ? bucketStart.toISOString() : null,
      period_end: bucketEnd ? bucketEnd.toISOString() : null,
      usage_quantity: null,
      usage_unit: "usd",
      cost_usd: bucketUsd,
      exchange_rate: rate,
      cost_brl: costBrl,
      raw_response: bucket,
    });

    await supabaseAdmin.from("cost_entries").insert({
      provider_id: conn.provider_id,
      platform_id: conn.platform_id,
      description: `OpenAI — ${dayIso}`,
      entry_date: dayIso,
      cost_usd: bucketUsd,
      exchange_rate: rate,
      cost_brl: costBrl,
      origin: "api",
      metadata: { connection_id: conn.id, source: "openai_costs" },
      raw_response: bucket,
    });
    inserted += 1;
  }

  // ------- Detalhamento por modelo + tipo (input/output/cached) -------
  // Reconsulta a Costs API agrupando por line_item para popular provider_usage_daily.
  let detailRowsCount = 0;
  try {
    const dBuckets = await fetchAllCostBuckets({ ...baseParams, group_by: "line_item" });
    const rowsByKey = new Map<string, {
      day: string; model: string; type: string; costUsd: number; raw: any[];
    }>();
    for (const b of dBuckets) {
      const dayIso = b?.start_time ? isoDate(new Date(b.start_time * 1000)) : isoDate(now);
      for (const r of b?.results ?? []) {
        const lineItem = String(r?.line_item ?? "").trim();
        if (!lineItem) continue;
        const [rawModel, rawType] = lineItem.split(",").map((s: string) => s.trim());
        const model = rawModel || "unknown";
        const type = (rawType || "usage").toLowerCase().replace(/\s+/g, "_");
        const amt = Number(r?.amount?.value ?? 0);
        if (!Number.isFinite(amt) || amt <= 0) continue;
        const key = `${dayIso}::${model}::${type}`;
        const cur = rowsByKey.get(key) ?? { day: dayIso, model, type, costUsd: 0, raw: [] };
        cur.costUsd += amt;
        cur.raw.push(r);
        rowsByKey.set(key, cur);
      }
    }
    const detailRows = Array.from(rowsByKey.values());
    if (detailRows.length > 0) {
      const payload = detailRows.map((r) => ({
        connection_id: conn.id,
        provider_id: conn.provider_id,
        platform_id: conn.platform_id,
        usage_date: r.day,
        model: r.model,
        endpoint: r.type,
        input_tokens: 0,
        output_tokens: 0,
        requests: 0,
        quantity: 0,
        unit: "usd",
        cost_usd: r.costUsd,
        exchange_rate: rate,
        cost_brl: r.costUsd * rate,
        raw: { source: "openai_costs_line_item", entries: r.raw },
      }));
      await supabaseAdmin
        .from("provider_usage_daily")
        .upsert(payload, { onConflict: "connection_id,usage_date,model,endpoint" });
      detailRowsCount = detailRows.length;
    }
  } catch (e) {
    console.warn("openai line_item breakdown failed", e);
  }


  // ------- Detalhamento por projeto (project_id) -------
  let projectRowsCount = 0;
  try {
    const pBuckets = await fetchAllCostBuckets({ ...baseParams, group_by: "project_id" });
    // Opcional: lista de projetos para mapear id -> nome
    const projectNames = new Map<string, string>();
    try {
      const listRes = await fetch("https://api.openai.com/v1/organization/projects?limit=100", { headers });
      if (listRes.ok) {
        const listJson: any = await listRes.json();
        for (const p of listJson?.data ?? []) {
          if (p?.id) projectNames.set(String(p.id), String(p?.name ?? p.id));
        }
      }
    } catch { /* ignore */ }

    const rowsByKey = new Map<string, {
      day: string; projectId: string; projectName: string; costUsd: number; raw: any[];
    }>();
    for (const b of pBuckets) {
      const dayIso = b?.start_time ? isoDate(new Date(b.start_time * 1000)) : isoDate(now);
      for (const r of b?.results ?? []) {
        const projectId = String(r?.project_id ?? "").trim() || "unattributed";
        const amt = Number(r?.amount?.value ?? 0);
        if (!Number.isFinite(amt) || amt <= 0) continue;
        const projectName = projectNames.get(projectId) ?? projectId;
        const key = `${dayIso}::${projectId}`;
        const cur = rowsByKey.get(key) ?? { day: dayIso, projectId, projectName, costUsd: 0, raw: [] };
        cur.costUsd += amt;
        cur.raw.push(r);
        rowsByKey.set(key, cur);
      }
    }
    const projectRows = Array.from(rowsByKey.values());
    if (projectRows.length > 0) {
      // model="__project__" reserva estas linhas apenas para agregações por projeto (não somam com model breakdown).
      const payload = projectRows.map((r) => ({
        connection_id: conn.id,
        provider_id: conn.provider_id,
        platform_id: conn.platform_id,
        usage_date: r.day,
        model: "__project__",
        endpoint: r.projectId,
        input_tokens: 0,
        output_tokens: 0,
        requests: 0,
        quantity: 0,
        unit: "usd",
        cost_usd: r.costUsd,
        exchange_rate: rate,
        cost_brl: r.costUsd * rate,
        raw: { source: "openai_costs_project", project_name: r.projectName, entries: r.raw },
      }));
      await supabaseAdmin
        .from("provider_usage_daily")
        .upsert(payload, { onConflict: "connection_id,usage_date,model,endpoint" });
      projectRowsCount = projectRows.length;
    }
  } catch (e) {
    console.warn("openai project breakdown failed", e);
  }

  // ------- Uso detalhado por endpoint (tokens, requests, cached, batch) -------
  // Consulta cada endpoint /v1/organization/usage/* para popular tokens e requests.
  const USAGE_ENDPOINTS = [
    "completions",
    "embeddings",
    "images",
    "audio_speeches",
    "audio_transcriptions",
    "moderations",
    "vector_stores",
    "code_interpreter_sessions",
  ] as const;

  async function fetchAllUsageBuckets(endpoint: string, params: Record<string, string>): Promise<any[]> {
    const all: any[] = [];
    let page: string | undefined = undefined;
    for (let i = 0; i < 200; i++) {
      const u = new URL(`https://api.openai.com/v1/organization/usage/${endpoint}`);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      if (page) u.searchParams.set("page", page);
      const r = await fetch(u, { headers });
      if (!r.ok) throw new Error(`OpenAI Usage/${endpoint} ${r.status}: ${await r.text()}`);
      const j: any = await r.json();
      if (Array.isArray(j?.data)) all.push(...j.data);
      if (!j?.has_more || !j?.next_page) break;
      page = String(j.next_page);
    }
    return all;
  }

  let usageRowsCount = 0;
  for (const endpoint of USAGE_ENDPOINTS) {
    try {
      const uBuckets = await fetchAllUsageBuckets(endpoint, {
        start_time: String(startTime),
        end_time: String(endTime),
        bucket_width: "1d",
        group_by: "model,project_id,batch",
        limit: "180",
      });
      const rowsByKey = new Map<string, {
        day: string; model: string; endpointKey: string;
        input: number; output: number; requests: number; quantity: number;
        raw: any[];
      }>();
      for (const b of uBuckets) {
        const dayIso = b?.start_time ? isoDate(new Date(b.start_time * 1000)) : isoDate(now);
        for (const r of b?.results ?? []) {
          const model = String(r?.model ?? "unknown");
          const projectId = String(r?.project_id ?? "");
          const batch = r?.batch === true ? ":batch" : "";
          const endpointKey = `${endpoint}${projectId ? `:${projectId}` : ""}${batch}`;
          const input = Number(r?.input_tokens ?? 0) || 0;
          const output = Number(r?.output_tokens ?? 0) || 0;
          const requests = Number(r?.num_model_requests ?? 0) || 0;
          // Endpoints não-texto usam contadores próprios (images, seconds, characters...).
          const quantity =
            Number(r?.images ?? r?.num_seconds ?? r?.characters ?? r?.num_sessions ?? r?.usage_bytes ?? 0) || 0;
          if (input + output + requests + quantity === 0) continue;
          const key = `${dayIso}::${model}::${endpointKey}`;
          const cur = rowsByKey.get(key) ?? {
            day: dayIso, model, endpointKey,
            input: 0, output: 0, requests: 0, quantity: 0, raw: [],
          };
          cur.input += input;
          cur.output += output;
          cur.requests += requests;
          cur.quantity += quantity;
          cur.raw.push(r);
          rowsByKey.set(key, cur);
        }
      }
      const rows = Array.from(rowsByKey.values());
      if (rows.length > 0) {
        const unitByEndpoint: Record<string, string> = {
          completions: "tokens",
          embeddings: "tokens",
          images: "images",
          audio_speeches: "characters",
          audio_transcriptions: "seconds",
          moderations: "requests",
          vector_stores: "bytes",
          code_interpreter_sessions: "sessions",
        };
        const payload = rows.map((r) => ({
          connection_id: conn.id,
          provider_id: conn.provider_id,
          platform_id: conn.platform_id,
          usage_date: r.day,
          model: r.model,
          endpoint: r.endpointKey,
          input_tokens: r.input,
          output_tokens: r.output,
          requests: r.requests,
          quantity: r.quantity,
          unit: unitByEndpoint[endpoint] ?? "units",
          cost_usd: 0,
          exchange_rate: rate,
          cost_brl: 0,
          raw: { source: `openai_usage_${endpoint}`, entries: r.raw },
        }));
        await supabaseAdmin
          .from("provider_usage_daily")
          .upsert(payload, { onConflict: "connection_id,usage_date,model,endpoint" });
        usageRowsCount += rows.length;
      }
    } catch (e) {
      console.warn(`openai usage/${endpoint} failed`, e);
    }
  }

  return {
    status: "success",
    records: inserted,
    message: inserted === 0
      ? "Nenhum custo novo no período"
      : `${inserted} dias · US$ ${totalUsd.toFixed(2)}${detailRowsCount ? ` · ${detailRowsCount} modelos` : ""}${projectRowsCount ? ` · ${projectRowsCount} projetos` : ""}${usageRowsCount ? ` · ${usageRowsCount} usos` : ""}`,
    meta: {
      total_usd: totalUsd,
      buckets: buckets.length,
      detail_rows: detailRowsCount,
      project_rows: projectRowsCount,
      usage_rows: usageRowsCount,
    },
  };
}


async function syncGemini(conn: any, rate: number): Promise<SyncOutcome> {
  const { syncGeminiBilling } = await import("./gemini-billing.server");
  return syncGeminiBilling(conn, rate);
}


const HANDLERS: Record<string, (c: any, r: number) => Promise<SyncOutcome>> = {
  Firecrawl: syncFirecrawl,
  OpenAI: syncOpenAI,
  Gemini: syncGemini,
  "Google Gemini": syncGemini,
};


export async function runSyncForConnection(connectionId: string) {
  const { data: conn, error: connErr } = await supabaseAdmin
    .from("provider_connections")
    .select("*, providers(name)")
    .eq("id", connectionId)
    .single();
  if (connErr || !conn) throw new Error("Conexão não encontrada");

  const providerName = (conn as any).providers?.name as string;
  const started = new Date();
  const { data: logRow } = await supabaseAdmin
    .from("sync_logs")
    .insert({ provider_id: conn.provider_id, connection_id: conn.id, status: "running" })
    .select("id")
    .single();

  try {
    const rate = await resolveUsdBrlRate();

    const handler = HANDLERS[providerName];
    let out: SyncOutcome;
    if (!handler) {
      out = {
        status: "skipped",
        records: 0,
        message: `Sincronização automática para "${providerName}" ainda não implementada.`,
      };
    } else {
      out = await handler(conn, rate);
    }

    await supabaseAdmin
      .from("provider_connections")
      .update({
        last_sync_at: new Date().toISOString(),
        status: out.status === "error" ? "error" : "active",
      })
      .eq("id", conn.id);

    await supabaseAdmin
      .from("sync_logs")
      .update({
        status: out.status,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - started.getTime(),
        records_imported: out.records,
        error_message: out.status === "skipped" ? out.message ?? null : null,
        metadata: out.meta ?? null,
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
      })
      .eq("id", logRow!.id);
    await supabaseAdmin.from("provider_connections").update({ status: "error" }).eq("id", conn.id);
    throw new Error(message);
  }
}

export async function runSyncAll() {
  const { data: conns, error } = await supabaseAdmin
    .from("provider_connections")
    .select("id, name")
    .eq("status", "active");
  if (error) throw error;
  const results: any[] = [];
  for (const c of conns ?? []) {
    try {
      const r = await runSyncForConnection(c.id);
      results.push({ id: c.id, name: c.name, ...r });
    } catch (err: any) {
      results.push({ id: c.id, name: c.name, ok: false, error: String(err?.message ?? err) });
    }
  }
  return { total: results.length, results };
}
