
-- Multi-tenant scoping: add owner_user_id to primary and derived data tables,
-- backfill all existing rows to samuel, add default-owner triggers and per-user RLS.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN NULL; END IF;
END $$;

-- 1) Add owner_user_id columns
ALTER TABLE public.clients              ADD COLUMN IF NOT EXISTS owner_user_id uuid;
ALTER TABLE public.platforms            ADD COLUMN IF NOT EXISTS owner_user_id uuid;
ALTER TABLE public.providers            ADD COLUMN IF NOT EXISTS owner_user_id uuid;
ALTER TABLE public.cost_entries         ADD COLUMN IF NOT EXISTS owner_user_id uuid;
ALTER TABLE public.dashboard_notes      ADD COLUMN IF NOT EXISTS owner_user_id uuid;
ALTER TABLE public.cost_alerts          ADD COLUMN IF NOT EXISTS owner_user_id uuid;
ALTER TABLE public.provider_connections ADD COLUMN IF NOT EXISTS owner_user_id uuid;
ALTER TABLE public.provider_invoices          ADD COLUMN IF NOT EXISTS owner_user_id uuid;
ALTER TABLE public.provider_billing_snapshots ADD COLUMN IF NOT EXISTS owner_user_id uuid;
ALTER TABLE public.provider_usage_daily       ADD COLUMN IF NOT EXISTS owner_user_id uuid;
ALTER TABLE public.provider_usage_syncs       ADD COLUMN IF NOT EXISTS owner_user_id uuid;
ALTER TABLE public.sync_logs                  ADD COLUMN IF NOT EXISTS owner_user_id uuid;
ALTER TABLE public.alert_events               ADD COLUMN IF NOT EXISTS owner_user_id uuid;

-- 2) Backfill all existing data to samuel
UPDATE public.clients              SET owner_user_id = '9c389964-be6a-4348-9d7a-af4793aac148' WHERE owner_user_id IS NULL;
UPDATE public.platforms            SET owner_user_id = '9c389964-be6a-4348-9d7a-af4793aac148' WHERE owner_user_id IS NULL;
UPDATE public.providers            SET owner_user_id = '9c389964-be6a-4348-9d7a-af4793aac148' WHERE owner_user_id IS NULL;
UPDATE public.cost_entries         SET owner_user_id = '9c389964-be6a-4348-9d7a-af4793aac148' WHERE owner_user_id IS NULL;
UPDATE public.dashboard_notes      SET owner_user_id = '9c389964-be6a-4348-9d7a-af4793aac148' WHERE owner_user_id IS NULL;
UPDATE public.cost_alerts          SET owner_user_id = '9c389964-be6a-4348-9d7a-af4793aac148' WHERE owner_user_id IS NULL;
UPDATE public.provider_connections SET owner_user_id = '9c389964-be6a-4348-9d7a-af4793aac148' WHERE owner_user_id IS NULL;
UPDATE public.provider_invoices          SET owner_user_id = '9c389964-be6a-4348-9d7a-af4793aac148' WHERE owner_user_id IS NULL;
UPDATE public.provider_billing_snapshots SET owner_user_id = '9c389964-be6a-4348-9d7a-af4793aac148' WHERE owner_user_id IS NULL;
UPDATE public.provider_usage_daily       SET owner_user_id = '9c389964-be6a-4348-9d7a-af4793aac148' WHERE owner_user_id IS NULL;
UPDATE public.provider_usage_syncs       SET owner_user_id = '9c389964-be6a-4348-9d7a-af4793aac148' WHERE owner_user_id IS NULL;
UPDATE public.sync_logs                  SET owner_user_id = '9c389964-be6a-4348-9d7a-af4793aac148' WHERE owner_user_id IS NULL;
UPDATE public.alert_events               SET owner_user_id = '9c389964-be6a-4348-9d7a-af4793aac148' WHERE owner_user_id IS NULL;

-- 3) Default-owner trigger functions
CREATE OR REPLACE FUNCTION public.set_owner_user_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.owner_user_id IS NULL THEN NEW.owner_user_id := auth.uid(); END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.set_owner_from_connection()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.owner_user_id IS NULL AND NEW.connection_id IS NOT NULL THEN
    SELECT owner_user_id INTO NEW.owner_user_id FROM public.provider_connections WHERE id = NEW.connection_id;
  END IF;
  IF NEW.owner_user_id IS NULL THEN NEW.owner_user_id := auth.uid(); END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.set_owner_from_alert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.owner_user_id IS NULL AND NEW.alert_id IS NOT NULL THEN
    SELECT owner_user_id INTO NEW.owner_user_id FROM public.cost_alerts WHERE id = NEW.alert_id;
  END IF;
  IF NEW.owner_user_id IS NULL THEN NEW.owner_user_id := auth.uid(); END IF;
  RETURN NEW;
END $$;

-- 4) Attach triggers
DROP TRIGGER IF EXISTS trg_set_owner ON public.clients;
CREATE TRIGGER trg_set_owner BEFORE INSERT ON public.clients FOR EACH ROW EXECUTE FUNCTION public.set_owner_user_id();
DROP TRIGGER IF EXISTS trg_set_owner ON public.platforms;
CREATE TRIGGER trg_set_owner BEFORE INSERT ON public.platforms FOR EACH ROW EXECUTE FUNCTION public.set_owner_user_id();
DROP TRIGGER IF EXISTS trg_set_owner ON public.providers;
CREATE TRIGGER trg_set_owner BEFORE INSERT ON public.providers FOR EACH ROW EXECUTE FUNCTION public.set_owner_user_id();
DROP TRIGGER IF EXISTS trg_set_owner ON public.cost_entries;
CREATE TRIGGER trg_set_owner BEFORE INSERT ON public.cost_entries FOR EACH ROW EXECUTE FUNCTION public.set_owner_user_id();
DROP TRIGGER IF EXISTS trg_set_owner ON public.dashboard_notes;
CREATE TRIGGER trg_set_owner BEFORE INSERT ON public.dashboard_notes FOR EACH ROW EXECUTE FUNCTION public.set_owner_user_id();
DROP TRIGGER IF EXISTS trg_set_owner ON public.cost_alerts;
CREATE TRIGGER trg_set_owner BEFORE INSERT ON public.cost_alerts FOR EACH ROW EXECUTE FUNCTION public.set_owner_user_id();
DROP TRIGGER IF EXISTS trg_set_owner ON public.provider_connections;
CREATE TRIGGER trg_set_owner BEFORE INSERT ON public.provider_connections FOR EACH ROW EXECUTE FUNCTION public.set_owner_user_id();

DROP TRIGGER IF EXISTS trg_set_owner ON public.provider_invoices;
CREATE TRIGGER trg_set_owner BEFORE INSERT ON public.provider_invoices FOR EACH ROW EXECUTE FUNCTION public.set_owner_from_connection();
DROP TRIGGER IF EXISTS trg_set_owner ON public.provider_billing_snapshots;
CREATE TRIGGER trg_set_owner BEFORE INSERT ON public.provider_billing_snapshots FOR EACH ROW EXECUTE FUNCTION public.set_owner_from_connection();
DROP TRIGGER IF EXISTS trg_set_owner ON public.provider_usage_daily;
CREATE TRIGGER trg_set_owner BEFORE INSERT ON public.provider_usage_daily FOR EACH ROW EXECUTE FUNCTION public.set_owner_from_connection();
DROP TRIGGER IF EXISTS trg_set_owner ON public.sync_logs;
CREATE TRIGGER trg_set_owner BEFORE INSERT ON public.sync_logs FOR EACH ROW EXECUTE FUNCTION public.set_owner_from_connection();
DROP TRIGGER IF EXISTS trg_set_owner ON public.provider_usage_syncs;
CREATE TRIGGER trg_set_owner BEFORE INSERT ON public.provider_usage_syncs FOR EACH ROW EXECUTE FUNCTION public.set_owner_user_id();
DROP TRIGGER IF EXISTS trg_set_owner ON public.alert_events;
CREATE TRIGGER trg_set_owner BEFORE INSERT ON public.alert_events FOR EACH ROW EXECUTE FUNCTION public.set_owner_from_alert();

-- 5) Replace RLS policies with per-owner scoping
-- clients
DROP POLICY IF EXISTS "clients read auth" ON public.clients;
DROP POLICY IF EXISTS "clients write admin" ON public.clients;
CREATE POLICY "clients read own"  ON public.clients FOR SELECT USING (owner_user_id = auth.uid());
CREATE POLICY "clients write own" ON public.clients FOR ALL
  USING (owner_user_id = auth.uid() AND has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') AND (owner_user_id IS NULL OR owner_user_id = auth.uid()));

-- platforms
DROP POLICY IF EXISTS "platforms read auth" ON public.platforms;
DROP POLICY IF EXISTS "platforms write admin" ON public.platforms;
CREATE POLICY "platforms read own"  ON public.platforms FOR SELECT USING (owner_user_id = auth.uid());
CREATE POLICY "platforms write own" ON public.platforms FOR ALL
  USING (owner_user_id = auth.uid() AND has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') AND (owner_user_id IS NULL OR owner_user_id = auth.uid()));

-- providers
DROP POLICY IF EXISTS "providers read auth" ON public.providers;
DROP POLICY IF EXISTS "providers write admin" ON public.providers;
CREATE POLICY "providers read own"  ON public.providers FOR SELECT USING (owner_user_id = auth.uid());
CREATE POLICY "providers write own" ON public.providers FOR ALL
  USING (owner_user_id = auth.uid() AND has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') AND (owner_user_id IS NULL OR owner_user_id = auth.uid()));

-- cost_entries
DROP POLICY IF EXISTS "costs read auth" ON public.cost_entries;
DROP POLICY IF EXISTS "costs write admin" ON public.cost_entries;
CREATE POLICY "costs read own"  ON public.cost_entries FOR SELECT USING (owner_user_id = auth.uid());
CREATE POLICY "costs write own" ON public.cost_entries FOR ALL
  USING (owner_user_id = auth.uid() AND has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') AND (owner_user_id IS NULL OR owner_user_id = auth.uid()));

-- dashboard_notes
DROP POLICY IF EXISTS "Authenticated can read notes" ON public.dashboard_notes;
DROP POLICY IF EXISTS "Admins can insert notes" ON public.dashboard_notes;
DROP POLICY IF EXISTS "Admins can update notes" ON public.dashboard_notes;
DROP POLICY IF EXISTS "Admins can delete notes" ON public.dashboard_notes;
CREATE POLICY "notes read own"   ON public.dashboard_notes FOR SELECT USING (owner_user_id = auth.uid());
CREATE POLICY "notes insert own" ON public.dashboard_notes FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin') AND (owner_user_id IS NULL OR owner_user_id = auth.uid()));
CREATE POLICY "notes update own" ON public.dashboard_notes FOR UPDATE USING (owner_user_id = auth.uid() AND has_role(auth.uid(), 'admin'));
CREATE POLICY "notes delete own" ON public.dashboard_notes FOR DELETE USING (owner_user_id = auth.uid() AND has_role(auth.uid(), 'admin'));

-- cost_alerts
DROP POLICY IF EXISTS "Authenticated read alerts" ON public.cost_alerts;
DROP POLICY IF EXISTS "Admin manage alerts" ON public.cost_alerts;
CREATE POLICY "alerts read own"  ON public.cost_alerts FOR SELECT USING (owner_user_id = auth.uid());
CREATE POLICY "alerts write own" ON public.cost_alerts FOR ALL
  USING (owner_user_id = auth.uid() AND has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') AND (owner_user_id IS NULL OR owner_user_id = auth.uid()));

-- alert_events
DROP POLICY IF EXISTS "Authenticated read alert events" ON public.alert_events;
DROP POLICY IF EXISTS "Authenticated ack/resolve alert events" ON public.alert_events;
DROP POLICY IF EXISTS "Admin manage alert events" ON public.alert_events;
CREATE POLICY "alert_events read own"   ON public.alert_events FOR SELECT USING (owner_user_id = auth.uid());
CREATE POLICY "alert_events update own" ON public.alert_events FOR UPDATE USING (owner_user_id = auth.uid());
CREATE POLICY "alert_events admin all"  ON public.alert_events FOR ALL
  USING (owner_user_id = auth.uid() AND has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') AND (owner_user_id IS NULL OR owner_user_id = auth.uid()));

-- provider_connections
DROP POLICY IF EXISTS "conn read auth" ON public.provider_connections;
DROP POLICY IF EXISTS "conn write admin" ON public.provider_connections;
CREATE POLICY "conn read own"  ON public.provider_connections FOR SELECT USING (owner_user_id = auth.uid());
CREATE POLICY "conn write own" ON public.provider_connections FOR ALL
  USING (owner_user_id = auth.uid() AND has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') AND (owner_user_id IS NULL OR owner_user_id = auth.uid()));

-- provider_invoices
DROP POLICY IF EXISTS "invoices read auth" ON public.provider_invoices;
DROP POLICY IF EXISTS "invoices write admin" ON public.provider_invoices;
CREATE POLICY "invoices read own"  ON public.provider_invoices FOR SELECT USING (owner_user_id = auth.uid());
CREATE POLICY "invoices write own" ON public.provider_invoices FOR ALL
  USING (owner_user_id = auth.uid() AND has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') AND (owner_user_id IS NULL OR owner_user_id = auth.uid()));

-- provider_billing_snapshots
DROP POLICY IF EXISTS "billing snap read auth" ON public.provider_billing_snapshots;
DROP POLICY IF EXISTS "billing snap write admin" ON public.provider_billing_snapshots;
CREATE POLICY "billing snap read own"  ON public.provider_billing_snapshots FOR SELECT USING (owner_user_id = auth.uid());
CREATE POLICY "billing snap write own" ON public.provider_billing_snapshots FOR ALL
  USING (owner_user_id = auth.uid() AND has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') AND (owner_user_id IS NULL OR owner_user_id = auth.uid()));

-- provider_usage_daily
DROP POLICY IF EXISTS "usage daily read auth" ON public.provider_usage_daily;
DROP POLICY IF EXISTS "usage daily write admin" ON public.provider_usage_daily;
CREATE POLICY "usage daily read own"  ON public.provider_usage_daily FOR SELECT USING (owner_user_id = auth.uid());
CREATE POLICY "usage daily write own" ON public.provider_usage_daily FOR ALL
  USING (owner_user_id = auth.uid() AND has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') AND (owner_user_id IS NULL OR owner_user_id = auth.uid()));

-- provider_usage_syncs
DROP POLICY IF EXISTS "syncs read auth" ON public.provider_usage_syncs;
DROP POLICY IF EXISTS "syncs write admin" ON public.provider_usage_syncs;
CREATE POLICY "syncs read own"  ON public.provider_usage_syncs FOR SELECT USING (owner_user_id = auth.uid());
CREATE POLICY "syncs write own" ON public.provider_usage_syncs FOR ALL
  USING (owner_user_id = auth.uid() AND has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') AND (owner_user_id IS NULL OR owner_user_id = auth.uid()));

-- sync_logs
DROP POLICY IF EXISTS "logs read auth" ON public.sync_logs;
DROP POLICY IF EXISTS "logs write admin" ON public.sync_logs;
CREATE POLICY "logs read own"  ON public.sync_logs FOR SELECT USING (owner_user_id = auth.uid());
CREATE POLICY "logs write own" ON public.sync_logs FOR ALL
  USING (owner_user_id = auth.uid() AND has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin') AND (owner_user_id IS NULL OR owner_user_id = auth.uid()));
