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

function wants(channel: string, target: "slack" | "email"): boolean {
  const c = (channel ?? "").toLowerCase();
  if (c === "all") return true;
  return c.includes(target);
}

const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number.isFinite(n) ? n : 0);

export function slackConfigured(): boolean {
  return Boolean(process.env["SLACK_WEBHOOK_URL"]);
}

async function sendSlack(n: AlertNotification): Promise<"sent" | "skipped" | "failed"> {
  const webhook = process.env["SLACK_WEBHOOK_URL"];
  if (!webhook) return "skipped";

  const emoji = n.severity === "critical" ? ":rotating_light:" : n.severity === "info" ? ":information_source:" : ":warning:";
  const payload = {
    text: `${emoji} ${n.title}`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: `${n.severity === "critical" ? "🚨" : "⚠️"} ${n.title}`.slice(0, 150) } },
      { type: "section", text: { type: "mrkdwn", text: n.message } },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Regra:*\n${n.ruleName}` },
          { type: "mrkdwn", text: `*Escopo:*\n${n.scopeLabel}` },
          { type: "mrkdwn", text: `*Período afetado:*\n${n.periodLabel}` },
          { type: "mrkdwn", text: `*Limite:*\n${fmtBRL(n.threshold)}` },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Ver regra no Quiwi" },
            url: ruleLink(n.ruleId),
            style: n.severity === "critical" ? "danger" : "primary",
          },
        ],
      },
    ],
  };

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error("[alert-notify] slack failed", res.status, await res.text().catch(() => ""));
      return "failed";
    }
    return "sent";
  } catch (err: any) {
    console.error("[alert-notify] slack error", err?.message ?? err);
    return "failed";
  }
}

async function recipients(): Promise<string[]> {
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

async function sendEmail(n: AlertNotification): Promise<"sent" | "skipped" | "failed"> {
  const to = await recipients();
  if (to.length === 0) return "skipped";

  const subject = `[Quiwi] ${n.severity === "critical" ? "Crítico" : "Atenção"}: ${n.title}`;
  const body = [
    n.message,
    "",
    `Regra: ${n.ruleName}`,
    `Escopo: ${n.scopeLabel}`,
    `Período afetado: ${n.periodLabel}`,
    `Limite configurado: ${fmtBRL(n.threshold)}`,
    "",
    `Ver regra: ${ruleLink(n.ruleId)}`,
  ].join("\n");

  try {
    let ok = 0;
    for (const email of to) {
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
      if (res.ok) ok++;
      else console.error("[alert-notify] email failed", res.status, await res.text().catch(() => ""));
    }
    return ok > 0 ? "sent" : "failed";
  } catch (err: any) {
    console.error("[alert-notify] email error", err?.message ?? err);
    return "failed";
  }
}

/** Dispara as notificações configuradas para o canal da regra. Nunca lança. */
export async function notifyAlert(n: AlertNotification): Promise<{ slack: string; email: string }> {
  const [slack, email] = await Promise.all([
    wants(n.channel, "slack") ? sendSlack(n) : Promise.resolve("skipped" as const),
    wants(n.channel, "email") ? sendEmail(n) : Promise.resolve("skipped" as const),
  ]);
  return { slack, email };
}

/** Rótulo legível do período afetado por métrica. */
export function periodLabelFor(
  metric: string,
  range: { start?: string; end?: string; days?: number },
): string {
  const br = (d?: string) => (d ? d.split("-").reverse().join("/") : "—");
  switch (metric) {
    case "monthly_cost":
      return `Mês corrente (${br(range.start)} a ${br(range.end)})`;
    case "daily_cost":
      return `Dia ${br(range.start)}`;
    case "variance_pct":
      return `Mês corrente vs. mês anterior (${br(range.start)} a ${br(range.end)})`;
    case "no_sync_days":
      return `Últimos ${Math.floor(range.days ?? 0)} dias sem sincronização`;
    default:
      return `${br(range.start)} a ${br(range.end)}`;
  }
}
