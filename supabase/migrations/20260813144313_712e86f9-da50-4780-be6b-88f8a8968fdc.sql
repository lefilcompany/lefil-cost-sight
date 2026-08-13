CREATE TABLE public.alert_notification_deliveries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  alert_event_id uuid REFERENCES public.alert_events(id) ON DELETE CASCADE,
  alert_id uuid REFERENCES public.cost_alerts(id) ON DELETE SET NULL,
  rule_name text,
  channel text NOT NULL CHECK (channel IN ('slack','email')),
  target text,
  severity text,
  title text,
  body text,
  period_label text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_attempt_at timestamp with time zone NOT NULL DEFAULT now(),
  last_error text,
  sent_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.alert_notification_deliveries TO authenticated;
GRANT ALL ON public.alert_notification_deliveries TO service_role;

ALTER TABLE public.alert_notification_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view alert notification deliveries"
ON public.alert_notification_deliveries
FOR SELECT
TO authenticated
USING (organization_id IS NULL OR public.is_org_member(organization_id, auth.uid()));

CREATE INDEX idx_alert_notif_deliveries_pending
ON public.alert_notification_deliveries (status, next_attempt_at)
WHERE status = 'pending';

CREATE INDEX idx_alert_notif_deliveries_event
ON public.alert_notification_deliveries (alert_event_id, created_at DESC);

CREATE INDEX idx_alert_notif_deliveries_alert
ON public.alert_notification_deliveries (alert_id, created_at DESC);

CREATE TRIGGER set_alert_notification_deliveries_updated_at
BEFORE UPDATE ON public.alert_notification_deliveries
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();