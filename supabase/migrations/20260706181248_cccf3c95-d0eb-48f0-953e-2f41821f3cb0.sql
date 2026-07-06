
-- Billing snapshots (plan / limits / period cost)
CREATE TABLE public.provider_billing_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.provider_connections(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  platform_id UUID REFERENCES public.platforms(id) ON DELETE SET NULL,
  plan_name TEXT,
  plan_tier TEXT,
  billing_cycle TEXT,
  cycle_start DATE,
  cycle_end DATE,
  included_quantity NUMERIC,
  included_unit TEXT,
  used_quantity NUMERIC,
  remaining_quantity NUMERIC,
  hard_limit_usd NUMERIC,
  soft_limit_usd NUMERIC,
  cost_period_usd NUMERIC,
  projected_cost_usd NUMERIC,
  currency TEXT NOT NULL DEFAULT 'USD',
  raw JSONB,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_billing_snapshots_conn ON public.provider_billing_snapshots(connection_id, captured_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_billing_snapshots TO authenticated;
GRANT ALL ON public.provider_billing_snapshots TO service_role;
ALTER TABLE public.provider_billing_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "billing snap read auth" ON public.provider_billing_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY "billing snap write admin" ON public.provider_billing_snapshots FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Daily usage per provider/model/endpoint
CREATE TABLE public.provider_usage_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.provider_connections(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  platform_id UUID REFERENCES public.platforms(id) ON DELETE SET NULL,
  usage_date DATE NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  endpoint TEXT NOT NULL DEFAULT '',
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  requests BIGINT NOT NULL DEFAULT 0,
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit TEXT,
  cost_usd NUMERIC NOT NULL DEFAULT 0,
  exchange_rate NUMERIC NOT NULL DEFAULT 5.0,
  cost_brl NUMERIC NOT NULL DEFAULT 0,
  raw JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, usage_date, model, endpoint)
);
CREATE INDEX idx_usage_daily_conn_date ON public.provider_usage_daily(connection_id, usage_date DESC);
CREATE INDEX idx_usage_daily_provider_date ON public.provider_usage_daily(provider_id, usage_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_usage_daily TO authenticated;
GRANT ALL ON public.provider_usage_daily TO service_role;
ALTER TABLE public.provider_usage_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "usage daily read auth" ON public.provider_usage_daily FOR SELECT TO authenticated USING (true);
CREATE POLICY "usage daily write admin" ON public.provider_usage_daily FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Invoices (API + manual upload)
CREATE TABLE public.provider_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID REFERENCES public.provider_connections(id) ON DELETE SET NULL,
  provider_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  platform_id UUID REFERENCES public.platforms(id) ON DELETE SET NULL,
  invoice_number TEXT,
  issued_at DATE,
  period_start DATE,
  period_end DATE,
  amount_usd NUMERIC NOT NULL DEFAULT 0,
  exchange_rate NUMERIC NOT NULL DEFAULT 5.0,
  amount_brl NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'paid',
  pdf_url TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  notes TEXT,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoices_provider_date ON public.provider_invoices(provider_id, issued_at DESC);
CREATE UNIQUE INDEX idx_invoices_api_unique ON public.provider_invoices(provider_id, invoice_number)
  WHERE invoice_number IS NOT NULL AND source = 'api';
CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON public.provider_invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_invoices TO authenticated;
GRANT ALL ON public.provider_invoices TO service_role;
ALTER TABLE public.provider_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoices read auth" ON public.provider_invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY "invoices write admin" ON public.provider_invoices FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
