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
