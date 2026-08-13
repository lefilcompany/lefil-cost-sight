/**
 * Deduplicação e snooze/silenciamento por regra de alerta.
 *
 * - Silenciar (`muted`) desliga as notificações da regra até ser reativada.
 * - Snooze (`snoozed_until`) suspende os disparos até a data/hora informada.
 * - Deduplicação (`dedupe_window_minutes`) agrupa disparos idênticos dentro da
 *   janela: em vez de criar um novo evento e notificar de novo, incrementa o
 *   contador de repetições do evento existente.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const DEFAULT_DEDUPE_WINDOW_MINUTES = 1440;

export type SuppressionRule = {
  id: string;
  muted?: boolean | null;
  snoozed_until?: string | null;
  dedupe_window_minutes?: number | null;
};

export type SilenceState =
  | { silenced: false }
  | { silenced: true; kind: "muted" | "snoozed"; until?: string | null };

/** A regra está silenciada (mute permanente) ou em snooze ainda vigente? */
export function ruleSilenceState(rule: SuppressionRule): SilenceState {
  if (rule.muted) return { silenced: true, kind: "muted" };
  const until = rule.snoozed_until ? new Date(rule.snoozed_until).getTime() : 0;
  if (until && until > Date.now()) {
    return { silenced: true, kind: "snoozed", until: rule.snoozed_until ?? null };
  }
  return { silenced: false };
}

/** Impressão digital do disparo: mesma regra + escopo + severidade = mesmo alerta. */
export function dedupeKeyFor(input: {
  ruleId: string;
  scope?: string | null;
  scopeId?: string | null;
  severity?: string | null;
}): string {
  return [
    input.ruleId,
    input.scope ?? "global",
    input.scopeId ?? "-",
    (input.severity ?? "warning").toLowerCase(),
  ].join("|");
}

/**
 * Se já existe um evento equivalente (mesmo dedupe_key) aberto dentro da janela,
 * registra a repetição nele e devolve `true` (não deve notificar novamente).
 */
export async function suppressAsDuplicate(args: {
  alertId: string;
  dedupeKey: string;
  windowMinutes?: number | null;
  metricValue?: number | null;
}): Promise<{ suppressed: boolean; eventId?: string; repetitions?: number }> {
  const windowMinutes = Math.max(
    0,
    Number(args.windowMinutes ?? DEFAULT_DEDUPE_WINDOW_MINUTES) || 0,
  );
  if (windowMinutes === 0) return { suppressed: false };

  const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("alert_events")
    .select("id, suppressed_count, dedupe_key, created_at")
    .eq("alert_id", args.alertId)
    .eq("dedupe_key", args.dedupeKey)
    .neq("status", "resolved")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("[alert-suppression] lookup failed", error.message);
    return { suppressed: false };
  }
  const existing = (data ?? [])[0] as any;
  if (!existing) return { suppressed: false };

  const repetitions = Number(existing.suppressed_count ?? 0) + 1;
  await supabaseAdmin
    .from("alert_events")
    .update({
      suppressed_count: repetitions,
      last_occurred_at: new Date().toISOString(),
      ...(args.metricValue != null ? { metric_value: args.metricValue } : {}),
    })
    .eq("id", existing.id);

  return { suppressed: true, eventId: existing.id, repetitions };
}

/** Aplica snooze/mute/janela de dedupe em uma regra. */
export async function updateRuleSuppression(args: {
  ruleId: string;
  muted?: boolean;
  snoozedUntil?: string | null;
  dedupeWindowMinutes?: number;
  reason?: string | null;
}): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (args.muted !== undefined) patch["muted"] = args.muted;
  if (args.snoozedUntil !== undefined) patch["snoozed_until"] = args.snoozedUntil;
  if (args.dedupeWindowMinutes !== undefined) {
    patch["dedupe_window_minutes"] = Math.max(0, Math.round(args.dedupeWindowMinutes));
  }
  if (args.reason !== undefined) patch["snooze_reason"] = args.reason;
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabaseAdmin.from("cost_alerts").update(patch).eq("id", args.ruleId);
  if (error) throw new Error(error.message);
}
