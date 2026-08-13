/**
 * Rotação automática agendada das chaves de integração.
 *
 * Chaves com `auto_rotate = true` e data de expiração são rotacionadas
 * automaticamente `rotate_before_days` dias antes de expirar. O novo segredo é
 * guardado no cofre (vault) e pode ser revelado uma única vez por um
 * administrador na tela de Chaves de API.
 */
import { hashApiKey } from "./api-keys.server";
import { randomBytes } from "crypto";

const DAY = 86_400_000;

export type RotationCandidate = {
  id: string;
  name: string;
  organization_id: string;
  environment: string;
  status: string;
  expires_at: string | null;
  created_at: string;
  auto_rotate: boolean;
  rotate_before_days: number;
  rotation_interval_days: number | null;
  rotation_count: number;
};

export type RotationOutcome = {
  id: string;
  name: string;
  ok: boolean;
  previous_expires_at: string | null;
  new_expires_at?: string;
  message?: string;
};

export type RotationRunResult = {
  checked: number;
  rotated: number;
  failed: number;
  results: RotationOutcome[];
};

function generateRawKey(environment: string) {
  const env = environment === "sandbox" ? "test" : "live";
  return `qw_${env}_${randomBytes(24).toString("base64url")}`;
}

/** Dias de validade a aplicar na chave rotacionada. */
function nextValidityDays(key: RotationCandidate) {
  if (key.rotation_interval_days && key.rotation_interval_days > 0) return key.rotation_interval_days;
  if (key.expires_at) {
    const span = Math.round((new Date(key.expires_at).getTime() - new Date(key.created_at).getTime()) / DAY);
    if (span > 0) return Math.min(span, 3650);
  }
  return 90;
}

/** Momento em que a chave será rotacionada automaticamente. */
export function computeNextRotationAt(expiresAt: string | null, rotateBeforeDays: number) {
  if (!expiresAt) return null;
  return new Date(new Date(expiresAt).getTime() - Math.max(rotateBeforeDays, 0) * DAY).toISOString();
}

/**
 * Rotaciona todas as chaves elegíveis. `keyId` limita a execução a uma chave
 * (usado pela ação manual "rotacionar agora conforme a política").
 */
export async function rotateDueApiKeys(
  options: { keyId?: string; force?: boolean; initiatedBy?: string | null } = {},
): Promise<RotationRunResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  let query = supabaseAdmin
    .from("integration_api_keys")
    .select(
      "id, name, organization_id, environment, status, expires_at, created_at, auto_rotate, rotate_before_days, rotation_interval_days, rotation_count",
    )
    .eq("status", "active")
    .eq("auto_rotate", true)
    .not("expires_at", "is", null);

  if (options.keyId) query = query.eq("id", options.keyId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const candidates = (data ?? []) as RotationCandidate[];
  const now = Date.now();
  const due = options.force
    ? candidates
    : candidates.filter((key) => {
        const at = computeNextRotationAt(key.expires_at, key.rotate_before_days);
        return at !== null && new Date(at).getTime() <= now;
      });

  const results: RotationOutcome[] = [];

  for (const key of due) {
    try {
      const raw = generateRawKey(key.environment);
      const days = nextValidityDays(key);
      const newExpires = new Date(now + days * DAY).toISOString();
      const rotateBefore = key.rotate_before_days;

      const { error: updateError } = await supabaseAdmin
        .from("integration_api_keys")
        .update({
          key_prefix: raw.slice(0, 14),
          key_hash: hashApiKey(raw),
          expires_at: newExpires,
          last_used_at: null,
          last_rotated_at: new Date(now).toISOString(),
          rotation_count: (key.rotation_count ?? 0) + 1,
          next_rotation_at: computeNextRotationAt(newExpires, rotateBefore),
        })
        .eq("id", key.id);
      if (updateError) throw new Error(updateError.message);

      const { error: vaultError } = await supabaseAdmin.rpc("store_api_key_rotation_secret", {
        _key_id: key.id,
        _secret: raw,
      });
      if (vaultError) throw new Error(vaultError.message);

      await supabaseAdmin.from("audit_logs").insert({
        organization_id: key.organization_id,
        user_id: options.initiatedBy ?? null,
        action: "api_key.auto_rotated",
        entity_type: "integration_api_key",
        entity_id: key.id,
        metadata: {
          name: key.name,
          previous_expires_at: key.expires_at,
          new_expires_at: newExpires,
          validity_days: days,
          rotate_before_days: rotateBefore,
          trigger: options.force ? "manual" : "scheduled",
        } as never,
      });

      results.push({
        id: key.id,
        name: key.name,
        ok: true,
        previous_expires_at: key.expires_at,
        new_expires_at: newExpires,
      });
    } catch (err: any) {
      results.push({
        id: key.id,
        name: key.name,
        ok: false,
        previous_expires_at: key.expires_at,
        message: String(err?.message ?? err),
      });
    }
  }

  const rotated = results.filter((r) => r.ok).length;

  try {
    await supabaseAdmin.from("sync_logs").insert({
      started_at: new Date(now).toISOString(),
      finished_at: new Date().toISOString(),
      status: results.some((r) => !r.ok) ? "error" : "success",
      records_imported: rotated,
      metadata: {
        job: "rotate-api-keys",
        checked: candidates.length,
        rotated,
        failed: results.length - rotated,
      } as never,
    });
  } catch {
    // log é best-effort
  }

  return { checked: candidates.length, rotated, failed: results.length - rotated, results };
}
