import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Mapeamento tabela → query keys que devem ser invalidadas quando houver
 * qualquer mudança (INSERT/UPDATE/DELETE) via Postgres Changes (realtime).
 *
 * Mantém a UI (dashboard, custos, financeiro, sincronizações, alertas etc.)
 * sempre coerente com o banco sem depender de refetch manual.
 */
const TABLE_INVALIDATIONS: Record<string, string[]> = {
  sync_logs: ["sync_logs", "sync-connections", "provider_usage_syncs"],
  sync_jobs: ["sync_jobs"],
  provider_usage_syncs: ["provider_usage_syncs", "sync_logs"],
  provider_usage_daily: ["provider_usage_daily", "dashboard", "costs"],
  provider_connections: ["sync-connections", "provider_connections", "providers"],
  provider_invoices: ["provider_invoices", "billing", "financial"],
  provider_billing_snapshots: ["provider_billing_snapshots", "billing"],
  provider_service_mappings: ["provider_service_mappings"],
  cost_entries: ["cost_entries", "costs", "dashboard", "financial"],
  cost_alerts: ["cost_alerts", "alerts"],
  alert_events: ["alert_events", "alerts"],
  billing_cost_records: ["billing_cost_records", "billing"],
  cost_reconciliations: ["cost_reconciliations", "billing"],
  gemini_usage_events: ["gemini_usage_events", "dashboard"],
  dashboard_notes: ["dashboard_notes", "dashboard"],
  clients: ["clients"],
  platforms: ["platforms", "sync-dims"],
  providers: ["providers", "sync-dims"],
  cloud_projects: ["cloud_projects"],
  google_billing_connections: ["google_billing_connections"],
  pricing_skus: ["pricing_skus"],
  platform_presets: ["platform_presets"],
  integration_api_keys: ["integration_api_keys"],
  saved_filters: ["saved_filters"],
  system_settings: ["system_settings"],
};

export function useRealtimeSync() {
  const qc = useQueryClient();

  useEffect(() => {
    const channel = supabase.channel("app-realtime");

    for (const table of Object.keys(TABLE_INVALIDATIONS)) {
      channel.on(
        // @ts-expect-error postgres_changes typing is loose
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          for (const key of TABLE_INVALIDATIONS[table]) {
            qc.invalidateQueries({ queryKey: [key] });
          }
        },
      );
    }

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);
}
