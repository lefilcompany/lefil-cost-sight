ALTER TABLE public.monitor_news_connections
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS expired_at timestamp with time zone;

ALTER TABLE public.monitor_news_connections
  DROP CONSTRAINT IF EXISTS monitor_news_connections_status_check;

ALTER TABLE public.monitor_news_connections
  ADD CONSTRAINT monitor_news_connections_status_check
  CHECK (status IN ('active', 'expired'));