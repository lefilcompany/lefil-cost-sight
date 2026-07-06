
-- Dashboard notes for financial dashboard
CREATE TABLE public.dashboard_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT,
  pinned BOOLEAN NOT NULL DEFAULT false,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dashboard_notes TO authenticated;
GRANT ALL ON public.dashboard_notes TO service_role;

ALTER TABLE public.dashboard_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read notes"
  ON public.dashboard_notes FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins can insert notes"
  ON public.dashboard_notes FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update notes"
  ON public.dashboard_notes FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete notes"
  ON public.dashboard_notes FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER dashboard_notes_set_updated_at
  BEFORE UPDATE ON public.dashboard_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Enable realtime for live dashboard
ALTER TABLE public.cost_entries REPLICA IDENTITY FULL;
ALTER TABLE public.provider_usage_syncs REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.cost_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE public.provider_usage_syncs;
