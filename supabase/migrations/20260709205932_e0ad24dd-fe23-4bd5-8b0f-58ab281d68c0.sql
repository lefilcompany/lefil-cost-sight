
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'sync_logs','sync_jobs','provider_usage_syncs','provider_usage_daily',
    'provider_connections','provider_invoices','provider_billing_snapshots',
    'provider_service_mappings','cost_entries','cost_alerts','alert_events',
    'billing_cost_records','cost_reconciliations','gemini_usage_events',
    'dashboard_notes','clients','platforms','providers','cloud_projects',
    'google_billing_connections','pricing_skus','platform_presets',
    'integration_api_keys','saved_filters','system_settings'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
             WHEN undefined_table THEN NULL;
    END;
    BEGIN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
  END LOOP;
END $$;
