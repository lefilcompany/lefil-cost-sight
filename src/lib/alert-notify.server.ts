import {
  buildEmailContent,
  buildSlackPayload,
  fmtBRLNotify as fmtBRL,
  periodLabelFor as periodLabelForShared,
} from "@/lib/alert-notify-format";

// Server-only: envia notificações (Slack / e-mail) quando um alerta é disparado.
// Slack: usa o webhook em SLACK_WEBHOOK_URL (Incoming Webhook).
// E-mail: usa a rota interna de app emails quando a infraestrutura de e-mail estiver configurada.

export type AlertNotification = {
  ruleId: string;
  ruleName: string;
  channel: string; // in_app | slack | email | slack_email | all
  severity: string;
  title: string;
  message: string;
  metricValue: number;
  threshold: number;
  scopeLabel: string;
  periodLabel: string;
  periodStart?: string;
  periodEnd?: string;
};

function baseUrl(): string {
  return (
    process.env["APP_BASE_URL"] ??
    process.env["PUBLIC_APP_URL"] ??
    "https://lefil-cost-sight.lovable.app"
  ).replace(/\/$/, "");
}

export function ruleLink(ruleId: string): string {
  return `${baseUrl()}/alerts?rule=${encodeURIComponent(ruleId)}`;
}

export function wantsChannel(channel: string, target: "slack" | "email"): boolean {
  const c = (channel ?? "").toLowerCase();
  if (c === "all") return true;
  return c.includes(target);
}

export function slackConfigured(): boolean {
  return Boolean(process.env["SLACK_WEBHOOK_URL"]);
}

/** Uma tentativa de envio ao Slack. Nunca lança. */
export async function attemptSlack(n: AlertNotification): Promise<{ ok: boolean; error?: string }> {
  const webhook = process.env["SLACK_WEBHOOK_URL"];
  if (!webhook) return { ok: false, error: "SLACK_WEBHOOK_URL não configurado" };

  const payload = buildSlackPayload(n, ruleLink(n.ruleId));

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[alert-notify] slack failed", res.status, body);
      return { ok: false, error: `Slack HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err: any) {
    const error = String(err?.message ?? err);
    console.error("[alert-notify] slack error", error);
    return { ok: false, error };
  }
}

export async function emailRecipients(): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("system_settings")
    .select("value")
    .eq("key", "alert_notifications")
    .maybeSingle();
  const raw = (data as any)?.value?.emails;
  if (Array.isArray(raw)) return raw.filter((e: unknown) => typeof e === "string" && e.includes("@"));
  return [];
}

/** Uma tentativa de envio de e-mail para um destinatário. Nunca lança. */
export async function attemptEmail(
  n: AlertNotification,
  email: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!email || !email.includes("@")) return { ok: false, error: "destinatário inválido" };

  const { subject, body } = buildEmailContent(n, ruleLink(n.ruleId));

  try {
    const res = await fetch(`${baseUrl()}/lovable/email/transactional/send`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? ""}`,
      },
      body: JSON.stringify({
        templateName: "alert-notification",
        recipientEmail: email,
        idempotencyKey: `alert-${n.ruleId}-${n.periodStart ?? ""}-${n.periodEnd ?? ""}-${email}`,
        templateData: {
          subject,
          title: n.title,
          body,
          ruleName: n.ruleName,
          periodLabel: n.periodLabel,
          ruleUrl: ruleLink(n.ruleId),
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[alert-notify] email failed", res.status, text);
      return { ok: false, error: `E-mail HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err: any) {
    const error = String(err?.message ?? err);
    console.error("[alert-notify] email error", error);
    return { ok: false, error };
  }
}

/**
 * Enfileira as notificações do canal da regra e tenta enviar imediatamente.
 * Falhas ficam na fila com retry (ver notification-queue.server.ts). Nunca lança.
 */
export async function notifyAlert(
  n: AlertNotification,
  meta: { alertEventId?: string | null; organizationId?: string | null } = {},
): Promise<{ queued: number; sent: number; pending: number; failed: number }> {
  try {
    const { enqueueAndDeliver } = await import("@/lib/notification-queue.server");
    return await enqueueAndDeliver(n, meta);
  } catch (err: any) {
    console.error("[alert-notify] notifyAlert error", err?.message ?? err);
    return { queued: 0, sent: 0, pending: 0, failed: 0 };
  }
}

/** Rótulo legível do período afetado por métrica. */
export function periodLabelFor(
  metric: string,
  range: { start?: string; end?: string; days?: number },
): string {
  return periodLabelForShared(metric, range);
}
