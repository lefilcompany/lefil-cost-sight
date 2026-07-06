
DROP POLICY IF EXISTS "Authenticated ack/resolve alert events" ON public.alert_events;
CREATE POLICY "Authenticated ack/resolve alert events" ON public.alert_events
  FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
