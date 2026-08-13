-- Private table holding the shared secret used by scheduled jobs
CREATE TABLE IF NOT EXISTS public.cron_credentials (
  name text PRIMARY KEY,
  secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.cron_credentials FROM anon, authenticated;
GRANT ALL ON public.cron_credentials TO service_role;
ALTER TABLE public.cron_credentials ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only service_role (which bypasses RLS) may read it.

INSERT INTO public.cron_credentials (name, secret)
VALUES ('cron', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.cron_secret()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT secret FROM public.cron_credentials WHERE name = 'cron'
$$;

REVOKE ALL ON FUNCTION public.cron_secret() FROM PUBLIC, anon, authenticated;

-- Job helpers now send the cron secret header instead of the public anon key
CREATE OR REPLACE FUNCTION public.run_evaluate_alerts_job(_url text, _apikey text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _req_id bigint;
BEGIN
  SELECT net.http_post(
    url := _url,
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.cron_secret()),
    body := '{}'::jsonb
  ) INTO _req_id;

  INSERT INTO public.sync_logs (started_at, status, metadata)
  VALUES (now(),'started',jsonb_build_object('job','evaluate-alerts','request_id', _req_id, 'url', _url));

  RETURN _req_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.run_sync_billing_job(_url text, _apikey text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _req_id bigint;
BEGIN
  SELECT net.http_post(
    url := _url,
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.cron_secret()),
    body := '{}'::jsonb
  ) INTO _req_id;

  INSERT INTO public.sync_logs (started_at, status, metadata)
  VALUES (now(),'started',jsonb_build_object('job','sync-billing','request_id', _req_id, 'url', _url));

  RETURN _req_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.run_evaluate_alerts_job(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_sync_billing_job(text, text) FROM PUBLIC, anon, authenticated;

-- Reschedule jobs with the secret header
SELECT cron.schedule(
  'evaluate-alerts-daily', '0 8 * * *',
  $$SELECT public.run_evaluate_alerts_job('https://project--73fc15d7-2263-476e-8932-a53f1e4bda66.lovable.app/api/public/cron/evaluate-alerts');$$
);

SELECT cron.schedule(
  'sync-billing-daily', '30 3 * * *',
  $$SELECT public.run_sync_billing_job('https://project--73fc15d7-2263-476e-8932-a53f1e4bda66.lovable.app/api/public/cron/sync-billing');$$
);

SELECT cron.schedule(
  'cost-center-sync-all-hourly', '5 * * * *',
  $$SELECT net.http_post(
      url := 'https://project--73fc15d7-2263-476e-8932-a53f1e4bda66.lovable.app/api/public/cron/sync-all',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.cron_secret()),
      body := '{}'::jsonb
    );$$
);

SELECT cron.schedule(
  'sync-monitor-news-daily', '15 4 * * *',
  $$SELECT net.http_post(
      url := 'https://project--73fc15d7-2263-476e-8932-a53f1e4bda66.lovable.app/api/public/cron/sync-monitor-news',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.cron_secret()),
      body := '{}'::jsonb
    );$$
);

SELECT cron.schedule(
  'update-usd-brl-rate-hourly', '0 * * * *',
  $$SELECT net.http_post(
      url := 'https://project--73fc15d7-2263-476e-8932-a53f1e4bda66.lovable.app/api/public/hooks/update-usd-rate',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.cron_secret()),
      body := '{}'::jsonb
    );$$
);