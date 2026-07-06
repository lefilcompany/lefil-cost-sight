
CREATE OR REPLACE FUNCTION public.run_sync_billing_job(_url text, _apikey text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _req_id bigint;
BEGIN
  SELECT net.http_post(
    url := _url,
    headers := jsonb_build_object('Content-Type','application/json','apikey', _apikey),
    body := '{}'::jsonb
  ) INTO _req_id;

  INSERT INTO public.sync_logs (started_at, status, metadata)
  VALUES (
    now(),
    'started',
    jsonb_build_object('job','sync-billing','request_id', _req_id, 'url', _url)
  );

  RETURN _req_id;
END;
$$;

REVOKE ALL ON FUNCTION public.run_sync_billing_job(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_sync_billing_job(text, text) TO postgres, service_role;

-- Schedule daily at 03:30 UTC
SELECT cron.schedule(
  'sync-billing-daily',
  '30 3 * * *',
  $cron$
  SELECT public.run_sync_billing_job(
    'https://project--ragxyidkvznugjdiyegc.lovable.app/api/public/cron/sync-billing',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJhZ3h5aWRrdnpudWdqZGl5ZWdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0OTQ4NDQsImV4cCI6MjA5ODA3MDg0NH0.SCZuHBcmbrbIMEfoKGpTcEPk2QwHeIwKxB0WgbNyGew'
  );
  $cron$
);
