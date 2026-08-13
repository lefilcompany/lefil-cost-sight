ALTER TABLE public.cost_alerts
  ADD COLUMN IF NOT EXISTS dedupe_window_minutes integer NOT NULL DEFAULT 1440,
  ADD COLUMN IF NOT EXISTS snoozed_until timestamp with time zone,
  ADD COLUMN IF NOT EXISTS muted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS snooze_reason text;

ALTER TABLE public.alert_events
  ADD COLUMN IF NOT EXISTS dedupe_key text,
  ADD COLUMN IF NOT EXISTS suppressed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_occurred_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS alert_events_dedupe_idx
  ON public.alert_events (alert_id, dedupe_key, created_at DESC);