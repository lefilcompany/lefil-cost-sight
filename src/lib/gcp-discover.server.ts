// Google Cloud autodiscovery: given a service account JSON, list projects,
// billing accounts, datasets, and detect the standard billing export table.

import { GCP_SCOPES, getGcpAccessToken, parseServiceAccount } from "./gcp-auth.server";

export type DiscoverResult = {
  service_account: {
    client_email: string;
    project_id: string;
    private_key_id_last4: string;
  };
  projects: { projectId: string; name: string; lifecycleState?: string }[];
  billing_accounts: { name: string; displayName: string; open: boolean; id: string }[];
  datasets: { projectId: string; datasetId: string; location?: string }[];
  detected_tables: {
    bq_project: string;
    bq_dataset: string;
    billing_account_id: string;
    standard_table?: string;
    detailed_table?: string;
    pricing_table?: string;
  }[];
  warnings: string[];
};

async function gfetch(url: string, token: string): Promise<any> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${url}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : {};
}

async function safe<T>(fn: () => Promise<T>, warnings: string[], label: string, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    warnings.push(`${label}: ${String(e.message || e).slice(0, 240)}`);
    return fallback;
  }
}

export async function discoverGcpFromServiceAccount(rawSaJson: string): Promise<DiscoverResult> {
  const sa = parseServiceAccount(rawSaJson);
  const warnings: string[] = [];

  const token = await getGcpAccessToken(sa, [
    GCP_SCOPES.cloudPlatformReadonly,
    GCP_SCOPES.billingReadonly,
    GCP_SCOPES.bigqueryReadonly,
  ]);

  const projects = await safe(
    async () => {
      const data = await gfetch("https://cloudresourcemanager.googleapis.com/v1/projects?pageSize=200", token);
      return (data.projects ?? [])
        .filter((p: any) => (p.lifecycleState ?? "ACTIVE") === "ACTIVE")
        .map((p: any) => ({ projectId: p.projectId, name: p.name, lifecycleState: p.lifecycleState }));
    },
    warnings,
    "cloudresourcemanager.projects.list",
    [] as DiscoverResult["projects"],
  );

  const billingAccounts = await safe(
    async () => {
      const data = await gfetch("https://cloudbilling.googleapis.com/v1/billingAccounts?pageSize=200", token);
      return (data.billingAccounts ?? []).map((b: any) => ({
        name: b.name,
        displayName: b.displayName ?? b.name,
        open: !!b.open,
        id: String(b.name || "").replace(/^billingAccounts\//, ""),
      }));
    },
    warnings,
    "cloudbilling.billingAccounts.list",
    [] as DiscoverResult["billing_accounts"],
  );

  // Discover datasets across up to first 15 projects (avoid huge scans)
  const datasets: DiscoverResult["datasets"] = [];
  for (const p of projects.slice(0, 15)) {
    const list = await safe(
      async () => {
        const data = await gfetch(
          `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(p.projectId)}/datasets?maxResults=100`,
          token,
        );
        return (data.datasets ?? []).map((d: any) => ({
          projectId: p.projectId,
          datasetId: d.datasetReference?.datasetId,
          location: d.location,
        }));
      },
      warnings,
      `bigquery.datasets.list(${p.projectId})`,
      [] as DiscoverResult["datasets"],
    );
    datasets.push(...list);
  }

  // Detect billing export tables: for each dataset, list tables and match the
  // canonical billing export naming (gcp_billing_export_*).
  const detected: DiscoverResult["detected_tables"] = [];
  for (const d of datasets) {
    if (!d.datasetId) continue;
    const tables = await safe(
      async () => {
        const data = await gfetch(
          `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(d.projectId)}/datasets/${encodeURIComponent(
            d.datasetId,
          )}/tables?maxResults=200`,
          token,
        );
        return (data.tables ?? []).map((t: any) => t.tableReference?.tableId as string).filter(Boolean);
      },
      warnings,
      `bigquery.tables.list(${d.projectId}.${d.datasetId})`,
      [] as string[],
    );
    if (!tables.length) continue;
    const buckets = new Map<string, { standard?: string; detailed?: string; pricing?: string }>();
    for (const t of tables) {
      // matches gcp_billing_export_v1_XXXXXX_XXXXXX_XXXXXX or resource_v1_ or pricing_export_
      const std = t.match(/^gcp_billing_export_v1_(.+)$/);
      const det = t.match(/^gcp_billing_export_resource_v1_(.+)$/);
      const prc = t.match(/^cloud_pricing_export$/);
      if (std) {
        const id = std[1];
        const b = buckets.get(id) ?? {};
        b.standard = t;
        buckets.set(id, b);
      } else if (det) {
        const id = det[1];
        const b = buckets.get(id) ?? {};
        b.detailed = t;
        buckets.set(id, b);
      } else if (prc) {
        // pricing table is shared; attach to first bucket
        const b = buckets.get("__pricing__") ?? {};
        b.pricing = t;
        buckets.set("__pricing__", b);
      }
    }
    const pricing = buckets.get("__pricing__")?.pricing;
    for (const [id, b] of buckets) {
      if (id === "__pricing__") continue;
      // billing_account_id in table is with underscores; convert to hyphenated form
      const parts = id.split("_");
      const hyphenated = parts.length >= 3 ? `${parts[0]}-${parts[1]}-${parts.slice(2).join("_")}` : id.replace(/_/g, "-");
      detected.push({
        bq_project: d.projectId,
        bq_dataset: d.datasetId,
        billing_account_id: hyphenated,
        standard_table: b.standard,
        detailed_table: b.detailed,
        pricing_table: pricing,
      });
    }
  }

  return {
    service_account: {
      client_email: sa.client_email,
      project_id: sa.project_id,
      private_key_id_last4: (sa.private_key_id || "").slice(-4),
    },
    projects,
    billing_accounts: billingAccounts,
    datasets,
    detected_tables: detected,
    warnings,
  };
}
