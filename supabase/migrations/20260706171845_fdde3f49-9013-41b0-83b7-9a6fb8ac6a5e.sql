
-- Platform presets (templates)
CREATE TABLE public.platform_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  category TEXT,
  environment TEXT CHECK (environment IN ('production','internal')),
  default_provider_id UUID REFERENCES public.providers(id) ON DELETE SET NULL,
  icon TEXT,
  color TEXT,
  default_alert_monthly_brl NUMERIC,
  default_alert_variance_pct NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.platform_presets TO authenticated;
GRANT ALL ON public.platform_presets TO service_role;
ALTER TABLE public.platform_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read presets" ON public.platform_presets FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin manage presets" ON public.platform_presets FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_platform_presets_updated BEFORE UPDATE ON public.platform_presets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Cost alert rules
CREATE TABLE public.cost_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('global','client','platform','provider')),
  scope_id UUID,
  metric TEXT NOT NULL CHECK (metric IN ('monthly_cost','daily_cost','variance_pct','no_sync_days')),
  comparison TEXT NOT NULL DEFAULT '>' CHECK (comparison IN ('>','>=','<','<=')),
  threshold NUMERIC NOT NULL,
  channel TEXT NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app','email')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_evaluated_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.cost_alerts TO authenticated;
GRANT ALL ON public.cost_alerts TO service_role;
ALTER TABLE public.cost_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read alerts" ON public.cost_alerts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin manage alerts" ON public.cost_alerts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_cost_alerts_updated BEFORE UPDATE ON public.cost_alerts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_cost_alerts_enabled ON public.cost_alerts (enabled);

-- Alert events (triggered alerts)
CREATE TABLE public.alert_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID REFERENCES public.cost_alerts(id) ON DELETE CASCADE,
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  title TEXT NOT NULL,
  message TEXT,
  metric_value NUMERIC,
  threshold NUMERIC,
  scope TEXT,
  scope_id UUID,
  scope_label TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.alert_events TO authenticated;
GRANT ALL ON public.alert_events TO service_role;
ALTER TABLE public.alert_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read alert events" ON public.alert_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated ack/resolve alert events" ON public.alert_events FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY "Admin manage alert events" ON public.alert_events FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_alert_events_updated BEFORE UPDATE ON public.alert_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_alert_events_status ON public.alert_events (status, created_at DESC);
CREATE INDEX idx_alert_events_alert ON public.alert_events (alert_id);

-- Realtime for alert events (dashboard bell reacts immediately)
ALTER TABLE public.alert_events REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.alert_events;

-- Seed a few useful presets (idempotent via unique slug)
INSERT INTO public.platform_presets (name, slug, description, category, environment, icon, color, default_alert_monthly_brl, default_alert_variance_pct) VALUES
  ('OpenAI (produção)', 'openai-prod', 'Uso de LLMs em produção — cobrança por token.', 'AI', 'production', 'Sparkles', '#10a37f', 1000, 20),
  ('Anthropic (produção)', 'anthropic-prod', 'Claude em produção.', 'AI', 'production', 'Sparkles', '#c96442', 1000, 20),
  ('OpenAI (interno)', 'openai-internal', 'Ferramentas internas de IA.', 'AI', 'internal', 'Sparkles', '#10a37f', 300, 30),
  ('Infra Cloud', 'cloud-infra', 'Infraestrutura em nuvem (compute/storage).', 'Infra', 'production', 'Cloud', '#3b82f6', 2000, 15),
  ('Ferramenta interna', 'internal-tool', 'SaaS de uso interno (BI, colaboração).', 'Tooling', 'internal', 'Wrench', '#64748b', 200, 40)
ON CONFLICT (slug) DO NOTHING;

-- Seed default global alerts (idempotent by name)
INSERT INTO public.cost_alerts (name, scope, metric, comparison, threshold, channel, enabled)
SELECT 'Variação mensal acima de 20%', 'global', 'variance_pct', '>', 20, 'in_app', true
WHERE NOT EXISTS (SELECT 1 FROM public.cost_alerts WHERE name = 'Variação mensal acima de 20%');
INSERT INTO public.cost_alerts (name, scope, metric, comparison, threshold, channel, enabled)
SELECT 'Plataforma sem sincronização há 7 dias', 'global', 'no_sync_days', '>=', 7, 'in_app', true
WHERE NOT EXISTS (SELECT 1 FROM public.cost_alerts WHERE name = 'Plataforma sem sincronização há 7 dias');
