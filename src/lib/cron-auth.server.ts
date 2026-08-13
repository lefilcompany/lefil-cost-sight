/**
 * Authorization for scheduled (cron) HTTP endpoints under /api/public/cron/*.
 *
 * These routes bypass site auth, so each one must authenticate its caller.
 * Accepted credentials (constant-time compared):
 *   1. `x-cron-secret` header matching the CRON_SECRET server secret, or
 *   2. `x-cron-secret` header matching the private `public.cron_credentials`
 *      row used by the pg_cron jobs.
 * The public anon/publishable key is NOT a valid credential — it ships to browsers.
 */

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function extractToken(request: Request): string {
  const header = request.headers.get("x-cron-secret");
  if (header) return header.trim();
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return "";
}

let cachedDbSecret: { value: string; at: number } | null = null;
const DB_SECRET_TTL_MS = 5 * 60 * 1000;

async function getDbCronSecret(): Promise<string> {
  const now = Date.now();
  if (cachedDbSecret && now - cachedDbSecret.at < DB_SECRET_TTL_MS) return cachedDbSecret.value;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("cron_credentials")
      .select("secret")
      .eq("name", "cron")
      .maybeSingle();
    const value = (data as { secret?: string } | null)?.secret ?? "";
    cachedDbSecret = { value, at: now };
    return value;
  } catch {
    return "";
  }
}

export const unauthorizedResponse = () =>
  new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });

/** Returns null when authorized, or a 401 Response to return immediately. */
export async function authorizeCronRequest(request: Request): Promise<Response | null> {
  const token = extractToken(request);
  if (!token) return unauthorizedResponse();

  const envSecret = process.env["CRON_SECRET"] ?? "";
  if (envSecret && timingSafeEqual(token, envSecret)) return null;

  const dbSecret = await getDbCronSecret();
  if (dbSecret && timingSafeEqual(token, dbSecret)) return null;

  return unauthorizedResponse();
}
