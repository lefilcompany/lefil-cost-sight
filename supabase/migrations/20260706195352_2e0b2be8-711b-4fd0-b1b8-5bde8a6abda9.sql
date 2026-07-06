
-- Revert providers to global/shared visibility
DROP POLICY IF EXISTS "providers read own"  ON public.providers;
DROP POLICY IF EXISTS "providers write own" ON public.providers;
DROP TRIGGER IF EXISTS trg_set_owner ON public.providers;

CREATE POLICY "providers read all"   ON public.providers FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "providers write admin" ON public.providers FOR ALL
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));
