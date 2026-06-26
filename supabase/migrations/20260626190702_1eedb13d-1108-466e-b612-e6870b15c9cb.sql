
-- Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'viewer');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_authenticated()
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$ SELECT auth.uid() IS NOT NULL $$;

CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- Auto-assign first user as admin, others as viewer
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  user_count INT;
BEGIN
  SELECT COUNT(*) INTO user_count FROM public.user_roles;
  IF user_count = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'viewer');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Updated_at helper
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- Platforms
CREATE TABLE public.platforms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  color TEXT NOT NULL DEFAULT '#3b82f6',
  icon TEXT NOT NULL DEFAULT 'Box',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platforms TO authenticated;
GRANT ALL ON public.platforms TO service_role;
ALTER TABLE public.platforms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "platforms read auth" ON public.platforms FOR SELECT TO authenticated USING (true);
CREATE POLICY "platforms write admin" ON public.platforms FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER platforms_updated BEFORE UPDATE ON public.platforms FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Providers
CREATE TABLE public.providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  category TEXT,
  website TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.providers TO authenticated;
GRANT ALL ON public.providers TO service_role;
ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "providers read auth" ON public.providers FOR SELECT TO authenticated USING (true);
CREATE POLICY "providers write admin" ON public.providers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER providers_updated BEFORE UPDATE ON public.providers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Clients
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  company TEXT,
  cnpj TEXT,
  responsible TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clients read auth" ON public.clients FOR SELECT TO authenticated USING (true);
CREATE POLICY "clients write admin" ON public.clients FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER clients_updated BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Provider connections
CREATE TABLE public.provider_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  platform_id UUID REFERENCES public.platforms(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  secret_ref TEXT,
  config JSONB DEFAULT '{}'::jsonb,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_connections TO authenticated;
GRANT ALL ON public.provider_connections TO service_role;
ALTER TABLE public.provider_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conn read auth" ON public.provider_connections FOR SELECT TO authenticated USING (true);
CREATE POLICY "conn write admin" ON public.provider_connections FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER conn_updated BEFORE UPDATE ON public.provider_connections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Provider usage syncs
CREATE TABLE public.provider_usage_syncs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  platform_id UUID REFERENCES public.platforms(id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  usage_quantity NUMERIC,
  usage_unit TEXT,
  cost_usd NUMERIC NOT NULL DEFAULT 0,
  exchange_rate NUMERIC,
  cost_brl NUMERIC,
  raw_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_usage_syncs TO authenticated;
GRANT ALL ON public.provider_usage_syncs TO service_role;
ALTER TABLE public.provider_usage_syncs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "syncs read auth" ON public.provider_usage_syncs FOR SELECT TO authenticated USING (true);
CREATE POLICY "syncs write admin" ON public.provider_usage_syncs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Cost entries
CREATE TABLE public.cost_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID REFERENCES public.providers(id) ON DELETE SET NULL,
  platform_id UUID REFERENCES public.platforms(id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  description TEXT,
  usage_quantity NUMERIC,
  usage_unit TEXT,
  cost_usd NUMERIC NOT NULL DEFAULT 0,
  exchange_rate NUMERIC,
  cost_brl NUMERIC,
  origin TEXT NOT NULL DEFAULT 'manual',
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_entries TO authenticated;
GRANT ALL ON public.cost_entries TO service_role;
ALTER TABLE public.cost_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "costs read auth" ON public.cost_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "costs write admin" ON public.cost_entries FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER costs_updated BEFORE UPDATE ON public.cost_entries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX cost_entries_date_idx ON public.cost_entries(entry_date DESC);
CREATE INDEX cost_entries_provider_idx ON public.cost_entries(provider_id);
CREATE INDEX cost_entries_platform_idx ON public.cost_entries(platform_id);

-- Sync logs
CREATE TABLE public.sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID REFERENCES public.providers(id) ON DELETE SET NULL,
  connection_id UUID REFERENCES public.provider_connections(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  duration_ms INTEGER,
  records_imported INTEGER DEFAULT 0,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_logs TO authenticated;
GRANT ALL ON public.sync_logs TO service_role;
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "logs read auth" ON public.sync_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "logs write admin" ON public.sync_logs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- System settings
CREATE TABLE public.system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_settings TO authenticated;
GRANT ALL ON public.system_settings TO service_role;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings read auth" ON public.system_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "settings write admin" ON public.system_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
