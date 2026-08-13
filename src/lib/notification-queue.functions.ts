import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Entregas de notificação de um evento de alerta (status, tentativas, erro). */
export const listAlertDeliveries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { event_id: string }) => ({ event_id: String(input?.event_id ?? "") }))
  .handler(async ({ data, context }) => {
    if (!data.event_id) return { deliveries: [] };
    const { data: rows, error } = await context.supabase
      .from("alert_notification_deliveries")
      .select("id, channel, target, status, attempts, max_attempts, last_error, next_attempt_at, sent_at, created_at")
      .eq("alert_event_id", data.event_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { deliveries: rows ?? [] };
  });

/** Reenvia uma entrega imediatamente. */
export const retryAlertDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => ({ id: String(input?.id ?? "") }))
  .handler(async ({ data, context }) => {
    if (!data.id) throw new Error("id obrigatório");
    // valida que o usuário enxerga a entrega (RLS) antes de reprocessar
    const { data: row, error } = await context.supabase
      .from("alert_notification_deliveries")
      .select("id")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Entrega não encontrada");

    const { requeueDelivery } = await import("@/lib/notification-queue.server");
    const status = await requeueDelivery(data.id);
    return { status };
  });

/** Processa manualmente a fila pendente. */
export const processAlertNotificationQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { processNotificationQueue } = await import("@/lib/notification-queue.server");
    return processNotificationQueue(100);
  });
