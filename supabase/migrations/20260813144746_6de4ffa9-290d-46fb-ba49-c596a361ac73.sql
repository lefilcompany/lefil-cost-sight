CREATE OR REPLACE FUNCTION public.run_process_notifications_job(_url text, _apikey text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  request_id bigint;
BEGIN
  SELECT net.http_post(
    url := _url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', _apikey),
    body := '{}'::jsonb
  ) INTO request_id;
  RETURN request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.run_process_notifications_job(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_process_notifications_job(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.run_process_notifications_job(text, text) FROM authenticated;

SELECT cron.unschedule('process-alert-notifications')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-alert-notifications');

SELECT cron.schedule(
  'process-alert-notifications',
  '*/5 * * * *',
  $$SELECT public.run_process_notifications_job(
      'https://project--73fc15d7-2263-476e-8932-a53f1e4bda66.lovable.app/api/public/cron/process-notifications',
      public.cron_secret()
  )$$
);