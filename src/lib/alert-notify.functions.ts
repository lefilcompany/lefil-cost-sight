import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getAlertNotificationSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("system_settings")
      .select("value")
      .eq("key", "alert_notifications")
      .maybeSingle();
    const value = (data as any)?.value ?? {};
    const { slackConfigured } = await import("@/lib/alert-notify.server");
    return {
      emails: Array.isArray(value.emails) ? (value.emails as string[]) : [],
      slack_configured: slackConfigured(),
    };
  });

export const saveAlertNotificationSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { emails: string[] }) => ({
    emails: (input?.emails ?? [])
      .map((e) => String(e).trim().toLowerCase())
      .filter((e) => /.+@.+\..+/.test(e))
      .slice(0, 25),
  }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("system_settings")
      .upsert({ key: "alert_notifications", value: { emails: data.emails } }, { onConflict: "key" });
    if (error) throw new Error(error.message);
    return { emails: data.emails };
  });

export const sendTestAlertNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { notifyAlert, periodLabelFor } = await import("@/lib/alert-notify.server");
    const today = new Date().toISOString().slice(0, 10);
    const start = today.slice(0, 8) + "01";
    const result = await notifyAlert({
      ruleId: "teste",
      ruleName: "Teste de notificação",
      channel: "slack_email",
      severity: "info",
      title: "Teste de notificação de alerta",
      message: "Este é um envio de teste do Quiwi Cost Center. Se você recebeu, as notificações estão funcionando.",
      metricValue: 0,
      threshold: 0,
      scopeLabel: "Global",
      periodLabel: periodLabelFor("monthly_cost", { start, end: today }),
      periodStart: start,
      periodEnd: today,
    });
    return result;
  });

/** Dispara notificações de teste para várias regras selecionadas de uma vez. */
export const sendBulkTestAlertNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { rule_ids: string[]; targets?: Array<"slack" | "email"> }) => ({
    rule_ids: Array.from(new Set((input?.rule_ids ?? []).map((id) => String(id)).filter(Boolean))).slice(0, 50),
    targets: Array.from(
      new Set((input?.targets ?? []).filter((t) => t === "slack" || t === "email")),
    ) as Array<"slack" | "email">,
  }))
  .handler(async ({ data, context }) => {
    if (data.rule_ids.length === 0) throw new Error("Selecione ao menos uma regra");


    const { data: rules, error } = await context.supabase
      .from("cost_alerts")
      .select("id, name, metric, threshold, channel, scope, scope_id")
      .in("id", data.rule_ids);
    if (error) throw new Error(error.message);
    if (!rules || rules.length === 0) throw new Error("Nenhuma regra encontrada");

    const { notifyAlert, periodLabelFor } = await import("@/lib/alert-notify.server");
    const { sampleNotification } = await import("@/lib/alert-notify-format");

    const today = new Date().toISOString().slice(0, 10);
    const start = today.slice(0, 8) + "01";

    const results: Array<{
      rule_id: string;
      rule_name: string;
      queued: number;
      sent: number;
      pending: number;
      failed: number;
      error?: string;
    }> = [];

    for (const r of rules as any[]) {
      try {
        const sample = sampleNotification(r.metric, "info");
        const res = await notifyAlert({
          ruleId: r.id,
          ruleName: r.name,
          channel: data.targets.length > 0 ? data.targets.join("_") : r.channel,
          severity: "info",
          title: `[TESTE] ${r.name}`,
          message: `Envio de teste da regra "${r.name}". ${sample.message}`,
          metricValue: sample.metricValue,
          threshold: Number(r.threshold ?? 0),
          scopeLabel: sample.scopeLabel,
          periodLabel:
            r.metric === "no_sync_days"
              ? periodLabelFor("no_sync_days", { days: Number(r.threshold ?? 0) })
              : periodLabelFor(r.metric, { start, end: today }),
          periodStart: start,
          periodEnd: today,
        });
        results.push({ rule_id: r.id, rule_name: r.name, ...res });
      } catch (err: any) {
        results.push({
          rule_id: r.id,
          rule_name: r.name,
          queued: 0,
          sent: 0,
          pending: 0,
          failed: 0,
          error: String(err?.message ?? err),
        });
      }
    }

    const totals = results.reduce(
      (acc, r) => ({
        queued: acc.queued + r.queued,
        sent: acc.sent + r.sent,
        pending: acc.pending + r.pending,
        failed: acc.failed + r.failed,
      }),
      { queued: 0, sent: 0, pending: 0, failed: 0 },
    );
    return { rules: results.length, totals, results };
  });
