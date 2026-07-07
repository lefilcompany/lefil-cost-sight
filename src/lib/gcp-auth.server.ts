// Google Cloud auth for edge (Cloudflare Workers) using Web Crypto.
// Signs a JWT with a service account private key and exchanges it for an
// OAuth2 access token. Caches tokens in-memory per (client_email + scopes).

export interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  token_uri?: string;
}

export const GCP_SCOPES = {
  bigqueryReadonly: "https://www.googleapis.com/auth/bigquery.readonly",
  monitoringRead: "https://www.googleapis.com/auth/monitoring.read",
  billingReadonly: "https://www.googleapis.com/auth/cloud-billing.readonly",
  cloudPlatformReadonly: "https://www.googleapis.com/auth/cloud-platform.read-only",
};

export function parseServiceAccount(raw: string): ServiceAccountKey {
  const trimmed = raw.trim();
  const parsed = JSON.parse(trimmed) as ServiceAccountKey;
  if (!parsed.private_key || !parsed.client_email) {
    throw new Error("Service account JSON inválido: faltam private_key/client_email.");
  }
  return parsed;
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const contents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\\n/g, "\n")
    .replace(/\r?\n/g, "")
    .trim();
  const der = Uint8Array.from(atob(contents), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der.buffer as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function signJWT(sa: ServiceAccountKey, scopes: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: sa.private_key_id };
  const claims = {
    iss: sa.client_email,
    scope: scopes,
    aud: sa.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const enc = new TextEncoder();
  const input = `${base64url(enc.encode(JSON.stringify(header)))}.${base64url(enc.encode(JSON.stringify(claims)))}`;
  const key = await importPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(input));
  return `${input}.${base64url(sig)}`;
}

type Cached = { token: string; expiresAt: number };
const cache = new Map<string, Cached>();

export async function getGcpAccessToken(sa: ServiceAccountKey, scopes: string[]): Promise<string> {
  const scopeStr = scopes.join(" ");
  const key = `${sa.client_email}::${scopeStr}`;
  const now = Math.floor(Date.now() / 1000);
  const hit = cache.get(key);
  if (hit && hit.expiresAt - 60 > now) return hit.token;

  const jwt = await signJWT(sa, scopeStr);
  const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Falha na troca de token OAuth2 (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  const expiresAt = now + Number(data.expires_in ?? 3600);
  cache.set(key, { token: data.access_token, expiresAt });
  return data.access_token;
}

// -------- BigQuery jobs.query wrapper --------

export interface BqQueryOptions {
  projectId: string; // run/billing project
  location?: string; // "US" | "EU" | region
  query: string;
  maximumBytesBilled?: string; // string integer, bytes
  timeoutMs?: number;
}

export interface BqRow {
  [column: string]: string | null;
}

export async function bigqueryQuery(
  token: string,
  opts: BqQueryOptions,
): Promise<{ rows: BqRow[]; schemaFields: string[]; totalBytesProcessed?: string }> {
  const body = {
    query: opts.query,
    useLegacySql: false,
    timeoutMs: opts.timeoutMs ?? 60000,
    location: opts.location ?? "US",
    maximumBytesBilled: opts.maximumBytesBilled ?? "10737418240", // 10 GB safety
  };
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(opts.projectId)}/queries`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`BigQuery ${res.status}: ${errText}`);
  }
  const data: any = await res.json();

  if (data.jobComplete === false) {
    // Poll getQueryResults
    const jobId = data.jobReference?.jobId;
    const location = data.jobReference?.location ?? opts.location ?? "US";
    if (!jobId) throw new Error("BigQuery: jobComplete=false sem jobId");
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const pr = await fetch(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(opts.projectId)}/queries/${encodeURIComponent(jobId)}?location=${encodeURIComponent(location)}&timeoutMs=15000`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const pj: any = await pr.json();
      if (pr.ok && pj.jobComplete) {
        return parseBqResponse(pj);
      }
    }
    throw new Error("BigQuery: timeout aguardando resultado do job");
  }
  return parseBqResponse(data);
}

function parseBqResponse(data: any): { rows: BqRow[]; schemaFields: string[]; totalBytesProcessed?: string } {
  const fields: { name: string }[] = data.schema?.fields ?? [];
  const names = fields.map((f) => f.name);
  const rawRows: any[] = data.rows ?? [];
  const rows: BqRow[] = rawRows.map((row) => {
    const out: BqRow = {};
    (row.f ?? []).forEach((cell: any, i: number) => {
      out[names[i]] = cell?.v ?? null;
    });
    return out;
  });
  return { rows, schemaFields: names, totalBytesProcessed: data.totalBytesProcessed };
}
