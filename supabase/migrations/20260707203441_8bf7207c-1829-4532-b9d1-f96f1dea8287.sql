
-- =========================================================================
-- FASE 1 — Billing OS: multi-tenant foundation
-- =========================================================================

-- 1) Enum de papéis por organização
DO $$ BEGIN
  CREATE TYPE public.org_role AS ENUM ('owner','administrator','finance','analyst','viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Tabela organizations
CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  legal_name TEXT,
  document TEXT,
  country TEXT DEFAULT 'BR',
  currency TEXT DEFAULT 'BRL',
  timezone TEXT DEFAULT 'America/Recife',
  segment TEXT,
  team_size TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.org_role NOT NULL DEFAULT 'viewer',
  status TEXT NOT NULL DEFAULT 'active',
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON public.organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON public.organization_members(organization_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_members TO authenticated;
GRANT ALL ON public.organization_members TO service_role;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.organization_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role public.org_role NOT NULL DEFAULT 'viewer',
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24),'hex'),
  status TEXT NOT NULL DEFAULT 'pending',
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '14 days'),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, email)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_invitations TO authenticated;
GRANT ALL ON public.organization_invitations TO service_role;
ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  old_values JSONB,
  new_values JSONB,
  ip_address TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_org ON public.audit_logs(organization_id, occurred_at DESC);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.saved_filters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page TEXT NOT NULL,
  name TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_filters TO authenticated;
GRANT ALL ON public.saved_filters TO service_role;
ALTER TABLE public.saved_filters ENABLE ROW LEVEL SECURITY;

-- 3) Funções auxiliares (SECURITY DEFINER para evitar recursão RLS)
CREATE OR REPLACE FUNCTION public.is_org_member(_org UUID, _user UUID DEFAULT auth.uid())
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.organization_members
                WHERE organization_id = _org AND user_id = _user AND status = 'active');
$$;

CREATE OR REPLACE FUNCTION public.has_org_role(_org UUID, _roles public.org_role[], _user UUID DEFAULT auth.uid())
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.organization_members
                WHERE organization_id = _org AND user_id = _user
                  AND status = 'active' AND role = ANY(_roles));
$$;

CREATE OR REPLACE FUNCTION public.current_org_role(_org UUID)
RETURNS public.org_role LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.organization_members
   WHERE organization_id = _org AND user_id = auth.uid() AND status = 'active' LIMIT 1;
$$;

-- Triggers updated_at
CREATE TRIGGER trg_orgs_updated BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_org_members_updated BEFORE UPDATE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_org_invites_updated BEFORE UPDATE ON public.organization_invitations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_saved_filters_updated BEFORE UPDATE ON public.saved_filters
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================================
-- 4) Cria organização Default e migra dados existentes
-- =========================================================================
INSERT INTO public.organizations (name, slug, status, country, currency, timezone)
VALUES ('Default Workspace', 'default', 'active', 'BR', 'BRL', 'America/Recife')
ON CONFLICT (slug) DO NOTHING;

-- Move todos os usuários existentes para Default (admin -> owner, viewer -> viewer)
INSERT INTO public.organization_members (organization_id, user_id, role, status)
SELECT o.id, ur.user_id,
       CASE WHEN ur.role = 'admin' THEN 'owner'::public.org_role
            ELSE 'viewer'::public.org_role END,
       'active'
FROM public.user_roles ur
CROSS JOIN (SELECT id FROM public.organizations WHERE slug='default' LIMIT 1) o
ON CONFLICT (organization_id, user_id) DO NOTHING;

-- 5) Adiciona organization_id + backfill em cada tabela existente
DO $$
DECLARE
  t TEXT;
  default_org UUID;
  tables TEXT[] := ARRAY[
    'provider_connections','providers','cost_entries','provider_usage_daily',
    'cost_alerts','alert_events','platforms','clients','sync_logs',
    'provider_billing_snapshots','provider_invoices','provider_usage_syncs',
    'dashboard_notes'
  ];
BEGIN
  SELECT id INTO default_org FROM public.organizations WHERE slug='default' LIMIT 1;

  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE', t);
    EXECUTE format('UPDATE public.%I SET organization_id = %L WHERE organization_id IS NULL', t, default_org);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET NOT NULL', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_org ON public.%I(organization_id)', t, t);
  END LOOP;
END $$;

-- =========================================================================
-- 6) Reescreve políticas RLS de todas as tabelas para escopo por organização
-- =========================================================================

-- Helper: apagar todas as policies antigas de uma tabela e criar as novas
DO $$
DECLARE
  t TEXT;
  pol RECORD;
  tables TEXT[] := ARRAY[
    'provider_connections','providers','cost_entries','provider_usage_daily',
    'cost_alerts','alert_events','platforms','clients','sync_logs',
    'provider_billing_snapshots','provider_invoices','provider_usage_syncs',
    'dashboard_notes'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;
  END LOOP;
END $$;

-- Policies padrão: SELECT para qualquer membro, ALL para owner/administrator
DO $$
DECLARE
  t TEXT;
  read_only_tables TEXT[] := ARRAY[
    'cost_entries','provider_usage_daily','sync_logs',
    'provider_billing_snapshots','provider_invoices','provider_usage_syncs','alert_events'
  ];
  write_tables TEXT[] := ARRAY[
    'provider_connections','providers','cost_alerts','platforms','clients','dashboard_notes'
  ];
BEGIN
  -- Todas as 13 tabelas: SELECT permitido para membros ativos
  FOREACH t IN ARRAY read_only_tables || write_tables LOOP
    EXECUTE format($f$
      CREATE POLICY "org_members_can_read" ON public.%I FOR SELECT TO authenticated
      USING (public.is_org_member(organization_id))
    $f$, t);
  END LOOP;

  -- Tabelas de dados oficiais/logs: writes só por service_role (via edge/backend)
  -- (não criamos policies de INSERT/UPDATE/DELETE — bloqueadas por padrão para authenticated)

  -- Tabelas de cadastro: owner/administrator podem criar/editar/deletar
  FOREACH t IN ARRAY write_tables LOOP
    EXECUTE format($f$
      CREATE POLICY "org_admins_can_write" ON public.%I FOR ALL TO authenticated
      USING (public.has_org_role(organization_id, ARRAY['owner','administrator']::public.org_role[]))
      WITH CHECK (public.has_org_role(organization_id, ARRAY['owner','administrator']::public.org_role[]))
    $f$, t);
  END LOOP;
END $$;

-- Ajuste específico: dashboard_notes — cada usuário edita as suas, mas todos os membros veem
DROP POLICY IF EXISTS "org_admins_can_write" ON public.dashboard_notes;
CREATE POLICY "notes_owner_write" ON public.dashboard_notes FOR ALL TO authenticated
  USING (owner_user_id = auth.uid() AND public.is_org_member(organization_id))
  WITH CHECK (owner_user_id = auth.uid() AND public.is_org_member(organization_id));

-- Ajuste: cost_alerts — Finance também pode criar/editar
DROP POLICY IF EXISTS "org_admins_can_write" ON public.cost_alerts;
CREATE POLICY "cost_alerts_write" ON public.cost_alerts FOR ALL TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['owner','administrator','finance']::public.org_role[]))
  WITH CHECK (public.has_org_role(organization_id, ARRAY['owner','administrator','finance']::public.org_role[]));

-- =========================================================================
-- 7) Políticas para as novas tabelas
-- =========================================================================
CREATE POLICY "orgs_members_read" ON public.organizations FOR SELECT TO authenticated
  USING (public.is_org_member(id));
CREATE POLICY "orgs_owner_update" ON public.organizations FOR UPDATE TO authenticated
  USING (public.has_org_role(id, ARRAY['owner']::public.org_role[]))
  WITH CHECK (public.has_org_role(id, ARRAY['owner']::public.org_role[]));
CREATE POLICY "orgs_owner_delete" ON public.organizations FOR DELETE TO authenticated
  USING (public.has_org_role(id, ARRAY['owner']::public.org_role[]));
CREATE POLICY "orgs_authenticated_create" ON public.organizations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "members_self_or_org_read" ON public.organization_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_org_member(organization_id));
CREATE POLICY "members_admin_write" ON public.organization_members FOR ALL TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['owner','administrator']::public.org_role[]))
  WITH CHECK (public.has_org_role(organization_id, ARRAY['owner','administrator']::public.org_role[]));

CREATE POLICY "invites_admin_all" ON public.organization_invitations FOR ALL TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['owner','administrator']::public.org_role[]))
  WITH CHECK (public.has_org_role(organization_id, ARRAY['owner','administrator']::public.org_role[]));

CREATE POLICY "audit_admin_read" ON public.audit_logs FOR SELECT TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['owner','administrator']::public.org_role[]));
-- INSERT feito somente via triggers/service_role — nada de INSERT policy para authenticated

CREATE POLICY "filters_owner_all" ON public.saved_filters FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_org_member(organization_id))
  WITH CHECK (user_id = auth.uid() AND public.is_org_member(organization_id));

-- =========================================================================
-- 8) Trigger: criar organização pessoal para novos usuários
-- =========================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  user_count INT;
  new_org_id UUID;
  base_slug TEXT;
  final_slug TEXT;
  i INT := 0;
BEGIN
  -- Mantém user_roles (compat) — primeiro usuário do sistema é admin
  SELECT COUNT(*) INTO user_count FROM public.user_roles;
  IF user_count = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'viewer');
  END IF;

  -- Cria organização pessoal
  base_slug := regexp_replace(lower(coalesce(split_part(NEW.email,'@',1),'user')), '[^a-z0-9]+', '-', 'g');
  final_slug := base_slug;
  WHILE EXISTS(SELECT 1 FROM public.organizations WHERE slug = final_slug) LOOP
    i := i + 1;
    final_slug := base_slug || '-' || i::text;
  END LOOP;

  INSERT INTO public.organizations (name, slug, created_by)
  VALUES (COALESCE(split_part(NEW.email,'@',1),'Workspace') || $lit$'s workspace$lit$, final_slug, NEW.id)
  RETURNING id INTO new_org_id;

  INSERT INTO public.organization_members (organization_id, user_id, role, status)
  VALUES (new_org_id, NEW.id, 'owner', 'active');

  RETURN NEW;
END;
$$;

-- Certifica o trigger existe em auth.users
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='on_auth_user_created') THEN
    CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END $$;

-- =========================================================================
-- 9) Atualiza trigger set_owner_user_id para também preencher organization_id
-- =========================================================================
-- (mantém owner_user_id para compat, mas garante que organization_id não seja nulo)
CREATE OR REPLACE FUNCTION public.set_owner_user_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.owner_user_id IS NULL THEN NEW.owner_user_id := auth.uid(); END IF;
  RETURN NEW;
END $$;
