/**
 * Reprocessamento da última sincronização com falha.
 *
 * Roda novamente o sync da conexão da falha (o que gera um novo registro em
 * sync_logs) e anota no log original que ele foi reprocessado, com o resultado
 * e o id do novo log, para manter o histórico rastreável.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type RetryFailedSyncResult = {
  ok: boolean;
  retried: boolean;
  message: string;
  original_log_id?: string;
  new_log_id?: string | null;
  connection_id?: string;
  connection_name?: string | null;
  status?: string;
  records?: number;
};

type FailedLog = {
  id: string;
  connection_id: string | null;
  provider_id: string | null;
  started_at: string;
  error_message: string | null;
  metadata: any;
  provider_connections?: { id: string; name: string } | null;
};

async function findFailedLog(args: {
  logId?: string | null;
  connectionId?: string | null;
}): Promise<FailedLog | null> {
  let q = supabaseAdmin
    .from("sync_logs")
    .select("id, connection_id, provider_id, started_at, error_message, metadata, provider_connections(id,name)")
    .eq("status", "error");
  if (args.logId) q = q.eq("id", args.logId);
  if (args.connectionId) q = q.eq("connection_id", args.connectionId);
  const { data, error } = await q.order("started_at", { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as any) ?? null;
}

export async function retryFailedSync(args: {
  logId?: string | null;
  connectionId?: string | null;
  initiatedBy?: string | null;
}): Promise<RetryFailedSyncResult> {
  const failed = await findFailedLog({ logId: args.logId ?? null, connectionId: args.connectionId ?? null });
  if (!failed) {
    return { ok: true, retried: false, message: "Nenhuma sincronização com falha para reprocessar." };
  }
  if (!failed.connection_id) {
    return {
      ok: false,
      retried: false,
      message: "A falha não está associada a uma conexão; não é possível reprocessar.",
      original_log_id: failed.id,
    };
  }

  const connectionName = failed.provider_connections?.name ?? null;
  const { runSyncForConnection } = await import("./sync.server");

  const beforeIds = new Set<string>();
  const { data: before } = await supabaseAdmin
    .from("sync_logs")
    .select("id")
    .eq("connection_id", failed.connection_id)
    .order("started_at", { ascending: false })
    .limit(5);
  for (const r of (before ?? []) as any[]) beforeIds.add(r.id);

  let status = "error";
  let records = 0;
  let message = "";
  let ok = false;
  try {
    const out: any = await runSyncForConnection(failed.connection_id);
    status = out?.status ?? "success";
    records = Number(out?.records ?? 0);
    ok = out?.ok !== false && status !== "error";
    message = out?.message ?? (ok ? "Reprocessamento concluído." : "Reprocessamento sem sucesso.");
  } catch (err: any) {
    message = String(err?.message ?? err);
  }

  // Descobre o novo log criado por runSyncForConnection.
  const { data: after } = await supabaseAdmin
    .from("sync_logs")
    .select("id, status")
    .eq("connection_id", failed.connection_id)
    .order("started_at", { ascending: false })
    .limit(5);
  const newLog = ((after ?? []) as any[]).find((r) => !beforeIds.has(r.id)) ?? null;

  await supabaseAdmin
    .from("sync_logs")
    .update({
      metadata: {
        ...(failed.metadata && typeof failed.metadata === "object" ? failed.metadata : {}),
        retry: {
          retried_at: new Date().toISOString(),
          retried_by: args.initiatedBy ?? null,
          result_status: ok ? status : "error",
          result_message: message.slice(0, 500),
          new_log_id: newLog?.id ?? null,
        },
      },
    })
    .eq("id", failed.id);

  if (newLog?.id) {
    const { data: created } = await supabaseAdmin
      .from("sync_logs")
      .select("metadata")
      .eq("id", newLog.id)
      .maybeSingle();
    await supabaseAdmin
      .from("sync_logs")
      .update({
        metadata: {
          ...((created as any)?.metadata && typeof (created as any).metadata === "object"
            ? (created as any).metadata
            : {}),
          retry_of_log_id: failed.id,
          trigger: "manual_retry",
          initiated_by: args.initiatedBy ?? null,
        },
      })
      .eq("id", newLog.id);
  }

  return {
    ok,
    retried: true,
    message,
    original_log_id: failed.id,
    new_log_id: newLog?.id ?? null,
    connection_id: failed.connection_id,
    connection_name: connectionName,
    status: ok ? status : "error",
    records,
  };
}
