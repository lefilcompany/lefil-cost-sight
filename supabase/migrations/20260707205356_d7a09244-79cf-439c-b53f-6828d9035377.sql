
CREATE TABLE public.google_billing_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_connection_id UUID NOT NULL UNIQUE REFERENCES public.provider_connections(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  gemini_project_id TEXT NOT NULL,
  gemini_project_number TEXT,
  billing_account_id TEXT NOT NULL,
  bigquery_project_id TEXT NOT NULL,
  bigquery_dataset_id TEXT NOT NULL,
  standard_billing_table TEXT NOT NULL,
  detailed_billing_table TEXT,
  pricing_table TEXT,
  dataset_location TEXT NOT NULL DEFAULT 'US',
  currency TEXT NOT NULL DEFAULT 'BRL',
  timezone TEXT NOT NULL DEFAULT 'America/Recife',
  billing_enabled BOOLEAN,
  billing_mode TEXT,
  gemini_tier TEXT,
  manual_spend_cap NUMERIC,
  manual_prepaid_balance NUMERIC,
  manual_balance_checked_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_billing_connections TO authenticated;
GRANT ALL ON public.google_billing_connections TO service_role;
ALTER TABLE public.google_billing_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gbc_read_members" ON public.google_billing_connections FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY "gbc_write_admin" ON public.google_billing_connections FOR ALL TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['owner','administrator']::org_role[]))
  WITH CHECK (public.has_org_role(organization_id, ARRAY['owner','administrator']::org_role[]));
CREATE TRIGGER trg_gbc_updated BEFORE UPDATE ON public.google_billing_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.cloud_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider_connection_id UUID NOT NULL REFERENCES public.provider_connections(id) ON DELETE CASCADE,
  external_project_id TEXT NOT NULL,
  external_project_number TEXT,
  name TEXT,
  billing_account_id TEXT,
  billing_enabled BOOLEAN,
  status TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_connection_id, external_project_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cloud_projects TO authenticated;
GRANT ALL ON public.cloud_projects TO service_role;
ALTER TABLE public.cloud_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cp_read_members" ON public.cloud_projects FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY "cp_write_admin" ON public.cloud_projects FOR ALL TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['owner','administrator']::org_role[]))
  WITH CHECK (public.has_org_role(organization_id, ARRAY['owner','administrator']::org_role[]));
CREATE TRIGGER trg_cp_updated BEFORE UPDATE ON public.cloud_projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.billing_cost_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider_connection_id UUID NOT NULL REFERENCES public.provider_connections(id) ON DELETE CASCADE,
  cloud_project_id UUID REFERENCES public.cloud_projects(id) ON DELETE SET NULL,
  usage_date DATE NOT NULL,
  usage_start_time TIMESTAMPTZ,
  usage_end_time TIMESTAMPTZ,
  service_id TEXT,
  service_description TEXT,
  sku_id TEXT,
  sku_description TEXT,
  gross_cost NUMERIC NOT NULL DEFAULT 0,
  credit_amount NUMERIC NOT NULL DEFAULT 0,
  net_cost NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  invoice_month TEXT,
  source TEXT NOT NULL DEFAULT 'bigquery',
  external_row_hash TEXT NOT NULL,
  raw_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_connection_id, external_row_hash)
);
CREATE INDEX idx_bcr_conn_date ON public.billing_cost_records (provider_connection_id, usage_date);
CREATE INDEX idx_bcr_sku ON public.billing_cost_records (sku_id);
GRANT SELECT ON public.billing_cost_records TO authenticated;
GRANT ALL ON public.billing_cost_records TO service_role;
ALTER TABLE public.billing_cost_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bcr_read_members" ON public.billing_cost_records FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE TRIGGER trg_bcr_updated BEFORE UPDATE ON public.billing_cost_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.gemini_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider_connection_id UUID REFERENCES public.provider_connections(id) ON DELETE SET NULL,
  cloud_project_id UUID REFERENCES public.cloud_projects(id) ON DELETE SET NULL,
  request_id TEXT,
  model TEXT NOT NULL,
  operation TEXT,
  prompt_tokens BIGINT,
  output_tokens BIGINT,
  thinking_tokens BIGINT,
  cached_tokens BIGINT,
  total_tokens BIGINT,
  duration_ms INTEGER,
  estimated_cost NUMERIC,
  currency TEXT NOT NULL DEFAULT 'USD',
  pricing_status TEXT NOT NULL DEFAULT 'pending',
  http_status INTEGER,
  success BOOLEAN,
  environment TEXT,
  tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, request_id)
);
CREATE INDEX idx_gue_org_occurred ON public.gemini_usage_events (organization_id, occurred_at DESC);
CREATE INDEX idx_gue_model ON public.gemini_usage_events (model);
GRANT SELECT ON public.gemini_usage_events TO authenticated;
GRANT ALL ON public.gemini_usage_events TO service_role;
ALTER TABLE public.gemini_usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gue_read_members" ON public.gemini_usage_events FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));

CREATE TABLE public.pricing_skus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_connection_id UUID REFERENCES public.provider_connections(id) ON DELETE CASCADE,
  service_id TEXT,
  service_name TEXT,
  sku_id TEXT NOT NULL,
  sku_name TEXT,
  model_name TEXT,
  usage_type TEXT,
  unit TEXT,
  unit_price NUMERIC,
  currency TEXT NOT NULL DEFAULT 'USD',
  effective_from TIMESTAMPTZ,
  effective_to TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'cloud_billing_catalog',
  status TEXT NOT NULL DEFAULT 'active',
  raw_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ps_sku ON public.pricing_skus (sku_id);
GRANT SELECT ON public.pricing_skus TO authenticated;
GRANT ALL ON public.pricing_skus TO service_role;
ALTER TABLE public.pricing_skus ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ps_read_all_auth" ON public.pricing_skus FOR SELECT TO authenticated USING (true);
CREATE TRIGGER trg_ps_updated BEFORE UPDATE ON public.pricing_skus
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.cost_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cloud_project_id UUID REFERENCES public.cloud_projects(id) ON DELETE SET NULL,
  reconciliation_date DATE NOT NULL,
  model TEXT,
  sku_id TEXT,
  estimated_cost NUMERIC,
  confirmed_cost NUMERIC,
  difference_amount NUMERIC,
  difference_percentage NUMERIC,
  status TEXT NOT NULL DEFAULT 'pending',
  explanation TEXT,
  reconciled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cr_org_date ON public.cost_reconciliations (organization_id, reconciliation_date DESC);
GRANT SELECT ON public.cost_reconciliations TO authenticated;
GRANT ALL ON public.cost_reconciliations TO service_role;
ALTER TABLE public.cost_reconciliations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cr_read_members" ON public.cost_reconciliations FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE TRIGGER trg_cr_updated BEFORE UPDATE ON public.cost_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.integration_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  permissions TEXT[] NOT NULL DEFAULT ARRAY['usage:write']::text[],
  environment TEXT NOT NULL DEFAULT 'production',
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_api_keys TO authenticated;
GRANT ALL ON public.integration_api_keys TO service_role;
ALTER TABLE public.integration_api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "iak_read_members" ON public.integration_api_keys FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY "iak_write_admin" ON public.integration_api_keys FOR ALL TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['owner','administrator']::org_role[]))
  WITH CHECK (public.has_org_role(organization_id, ARRAY['owner','administrator']::org_role[]));
CREATE TRIGGER trg_iak_updated BEFORE UPDATE ON public.integration_api_keys
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.provider_service_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_service_id TEXT,
  external_service_name TEXT,
  external_sku_id TEXT,
  external_sku_name TEXT,
  internal_category TEXT NOT NULL DEFAULT 'unclassified',
  model_name TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  source TEXT NOT NULL DEFAULT 'auto',
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider, external_service_id, external_sku_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_service_mappings TO authenticated;
GRANT ALL ON public.provider_service_mappings TO service_role;
ALTER TABLE public.provider_service_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "psm_read_members" ON public.provider_service_mappings FOR SELECT TO authenticated
  USING (organization_id IS NULL OR public.is_org_member(organization_id));
CREATE POLICY "psm_write_admin" ON public.provider_service_mappings FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND public.has_org_role(organization_id, ARRAY['owner','administrator']::org_role[]))
  WITH CHECK (organization_id IS NOT NULL AND public.has_org_role(organization_id, ARRAY['owner','administrator']::org_role[]));
CREATE TRIGGER trg_psm_updated BEFORE UPDATE ON public.provider_service_mappings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider_connection_id UUID REFERENCES public.provider_connections(id) ON DELETE CASCADE,
  sync_type TEXT NOT NULL,
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'pending',
  period_start DATE,
  period_end DATE,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  records_read INTEGER NOT NULL DEFAULT 0,
  records_inserted INTEGER NOT NULL DEFAULT 0,
  records_updated INTEGER NOT NULL DEFAULT 0,
  records_skipped INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  initiated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sj_conn_started ON public.sync_jobs (provider_connection_id, started_at DESC);
GRANT SELECT ON public.sync_jobs TO authenticated;
GRANT ALL ON public.sync_jobs TO service_role;
ALTER TABLE public.sync_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sj_read_members" ON public.sync_jobs FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
