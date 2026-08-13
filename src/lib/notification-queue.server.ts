/**
 * Fila + retry das notificações de alerta (Slack / e-mail).
 *
 * Cada tentativa é registrada em public.alert_notification_deliveries, ligada ao
 * evento do alerta, para que o histórico mostre o status do envio.
 * Falhas voltam para "pending" com backoff exponencial até max_attempts.
 */

import type { AlertNotification } from "@/lib/alert-notify.server";

export type DeliveryChannel = "slack" | "email";

const BACKOFF_MINUTES = [1, 5, 15, 60, 180];

function nextAttemptAt(attempts: number): string {
  const minutes = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)] ?? 180;
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

export type DeliveryMeta = {
  alertEventId?: string | null;
  organizationId?: string | null;
};

type DeliveryRow = {
  id: string;
  channel: string;
  target: string | null;
  attempts: number;
  max_attempts: number;
  payload: any;
};

/** Cria as linhas da fila para os canais configurados na regra. */
export async function enqueueAlertNotifications(
  n: AlertNotification,
  meta: DeliveryMeta = {},
): Promise<DeliveryRow[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { wantsChannel, slackConfigured, emailRecipients } = await import("@/lib/alert-notify.server");

  const rows: Record<string, unknown>[] = [];
  const base = {
    organization_id: meta.organizationId ?? null,
    alert_event_id: meta.alertEventId ?? null,
    alert_id: /^[0-9a-f-]{36}$/i.test(n.ruleId) ? n.ruleId : null,
    rule_name: n.ruleName,
    severity: n.severity,
    title: n.title,
    body: n.message,
    period_label: n.periodLabel,
    payload: n as unknown as Record<string, unknown>,
    status: "pending",
    next_attempt_at: new Date().toISOString(),
  };

  if (wantsChannel(n.channel, "slack") && slackConfigured()) {
    rows.push({ ...base, channel: "slack", target: "webhook" });
  }
  if (wantsChannel(n.channel, "email")) {
    for (const email of await emailRecipients()) {
      rows.push({ ...base, channel: "email", target: email });
    }
  }
  if (rows.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from("alert_notification_deliveries")
    .insert(rows as any)
    .select("id, channel, target, attempts, max_attempts, payload");
  if (error) {
    console.error("[notif-queue] enqueue failed", error.message);
    return [];
  }
  return (data ?? []) as DeliveryRow[];
}

/** Executa uma entrega e grava o resultado. Nunca lança. */
export async function runDelivery(row: DeliveryRow): Promise<"sent" | "pending" | "failed"> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { attemptSlack, attemptEmail } = await import("@/lib/alert-notify.server");
  const attempts = (row.attempts ?? 0) + 1;
  const notification = row.payload as AlertNotification;

  let result: { ok: boolean; error?: string };
  try {
    result =
      row.channel === "slack"
        ? await attemptSlack(notification)
        : await attemptEmail(notification, row.target ?? "");
  } catch (err: any) {
    result = { ok: false, error: String(err?.message ?? err) };
  }

  if (result.ok) {
    await supabaseAdmin
      .from("alert_notification_deliveries")
      .update({ status: "sent", attempts, sent_at: new Date().toISOString(), last_error: null })
      .eq("id", row.id);
    return "sent";
  }

  const exhausted = attempts >= (row.max_attempts ?? 5);
  await supabaseAdmin
    .from("alert_notification_deliveries")
    .update({
      status: exhausted ? "failed" : "pending",
      attempts,
      last_error: (result.error ?? "erro desconhecido").slice(0, 500),
      next_attempt_at: exhausted ? new Date().toISOString() : nextAttemptAt(attempts),
    })
    .eq("id", row.id);
  return exhausted ? "failed" : "pending";
}

/** Enfileira e tenta enviar imediatamente. */
export async function enqueueAndDeliver(
  n: AlertNotification,
  meta: DeliveryMeta = {},
): Promise<{ queued: number; sent: number; pending: number; failed: number }> {
  const rows = await enqueueAlertNotifications(n, meta);
  const summary = { queued: rows.length, sent: 0, pending: 0, failed: 0 };
  for (const row of rows) {
    const status = await runDelivery(row);
    summary[status] += 1;
  }
  return summary;
}

/** Processa entregas pendentes cuja próxima tentativa já venceu. */
export async function processNotificationQueue(limit = 50): Promise<{
  processed: number;
  sent: number;
  pending: number;
  failed: number;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("alert_notification_deliveries")
    .select("id, channel, target, attempts, max_attempts, payload")
    .eq("status", "pending")
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  const summary = { processed: 0, sent: 0, pending: 0, failed: 0 };
  for (const row of (data ?? []) as DeliveryRow[]) {
    const status = await runDelivery(row);
    summary.processed += 1;
    summary[status] += 1;
  }
  return summary;
}

/** Reagenda uma entrega para tentativa imediata (uso manual na UI). */
export async function requeueDelivery(id: string): Promise<"sent" | "pending" | "failed"> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("alert_notification_deliveries")
    .update({ status: "pending", next_attempt_at: new Date().toISOString(), attempts: 0, last_error: null })
    .eq("id", id)
    .select("id, channel, target, attempts, max_attempts, payload")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Entrega não encontrada");
  return runDelivery(data as DeliveryRow);
}
