
CREATE OR REPLACE FUNCTION public.default_org_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND status='active' ORDER BY joined_at LIMIT 1),
    (SELECT id FROM public.organizations WHERE slug='default' LIMIT 1)
  );
$$;

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'provider_connections','providers','cost_entries','provider_usage_daily',
    'cost_alerts','alert_events','platforms','clients','sync_logs',
    'provider_billing_snapshots','provider_invoices','provider_usage_syncs',
    'dashboard_notes'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET DEFAULT public.default_org_id()', t);
  END LOOP;
END $$;
