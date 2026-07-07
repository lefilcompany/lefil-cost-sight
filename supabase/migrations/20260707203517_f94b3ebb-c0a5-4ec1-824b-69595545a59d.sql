
-- Função universal: preenche organization_id se estiver nulo
CREATE OR REPLACE FUNCTION public.fill_organization_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org UUID;
BEGIN
  IF NEW.organization_id IS NOT NULL THEN RETURN NEW; END IF;

  -- Tenta pelas FKs mais comuns
  IF to_jsonb(NEW) ? 'connection_id' AND (to_jsonb(NEW)->>'connection_id') IS NOT NULL THEN
    SELECT organization_id INTO v_org FROM public.provider_connections
      WHERE id = (to_jsonb(NEW)->>'connection_id')::uuid;
  END IF;

  IF v_org IS NULL AND to_jsonb(NEW) ? 'alert_id' AND (to_jsonb(NEW)->>'alert_id') IS NOT NULL THEN
    SELECT organization_id INTO v_org FROM public.cost_alerts
      WHERE id = (to_jsonb(NEW)->>'alert_id')::uuid;
  END IF;

  IF v_org IS NULL AND to_jsonb(NEW) ? 'provider_id' AND (to_jsonb(NEW)->>'provider_id') IS NOT NULL THEN
    SELECT organization_id INTO v_org FROM public.providers
      WHERE id = (to_jsonb(NEW)->>'provider_id')::uuid;
  END IF;

  IF v_org IS NULL AND to_jsonb(NEW) ? 'platform_id' AND (to_jsonb(NEW)->>'platform_id') IS NOT NULL THEN
    SELECT organization_id INTO v_org FROM public.platforms
      WHERE id = (to_jsonb(NEW)->>'platform_id')::uuid;
  END IF;

  -- Fallback: primeira organização do usuário atual OU Default
  IF v_org IS NULL AND auth.uid() IS NOT NULL THEN
    SELECT organization_id INTO v_org FROM public.organization_members
      WHERE user_id = auth.uid() AND status='active' ORDER BY joined_at LIMIT 1;
  END IF;

  IF v_org IS NULL THEN
    SELECT id INTO v_org FROM public.organizations WHERE slug='default' LIMIT 1;
  END IF;

  NEW.organization_id := v_org;
  RETURN NEW;
END $$;

-- Aplica trigger BEFORE INSERT em todas as 13 tabelas
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
    EXECUTE format('DROP TRIGGER IF EXISTS trg_fill_org ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_fill_org BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fill_organization_id()', t);
  END LOOP;
END $$;
