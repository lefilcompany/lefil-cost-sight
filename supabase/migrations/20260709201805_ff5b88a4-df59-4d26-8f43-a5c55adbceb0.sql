
-- Add admin-only write policies for tables that only had SELECT policies.
-- Service role bypasses RLS, so backend syncs continue to work.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'alert_events',
    'billing_cost_records',
    'cost_entries',
    'cost_reconciliations',
    'gemini_usage_events',
    'provider_billing_snapshots',
    'provider_invoices',
    'provider_usage_daily',
    'provider_usage_syncs',
    'sync_jobs',
    'sync_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS "admins_can_insert" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "admins_can_update" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "admins_can_delete" ON public.%I', t);
    EXECUTE format('CREATE POLICY "admins_can_insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), ''admin''))', t);
    EXECUTE format('CREATE POLICY "admins_can_update" ON public.%I FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), ''admin'')) WITH CHECK (public.has_role(auth.uid(), ''admin''))', t);
    EXECUTE format('CREATE POLICY "admins_can_delete" ON public.%I FOR DELETE TO authenticated USING (public.has_role(auth.uid(), ''admin''))', t);
  END LOOP;
END $$;

-- Revoke EXECUTE from anon/authenticated on SECURITY DEFINER functions that are
-- internal-only (triggers, cron jobs, service-side helpers). Keep functions that
-- are called from RLS policies (has_role, has_org_role, is_org_member,
-- default_org_id, current_org_role, has_active_access, is_authenticated) or via
-- authenticated RPC (approve_user, block_user, set/get/clear_connection_api_key).

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_owner_from_connection() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_owner_from_alert() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_owner_user_id() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fill_organization_id() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_connection_api_key_internal(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.run_evaluate_alerts_job(text, text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.run_sync_billing_job(text, text) FROM anon, authenticated, PUBLIC;

-- Also revoke from anon on authenticated-only RPCs / RLS helpers.
REVOKE EXECUTE ON FUNCTION public.approve_user(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.block_user(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_connection_api_key(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.clear_connection_api_key(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_connection_api_key(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_org_role(uuid, public.org_role[], uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_org_member(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.default_org_id() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_org_role(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_active_access(uuid) FROM anon, PUBLIC;
