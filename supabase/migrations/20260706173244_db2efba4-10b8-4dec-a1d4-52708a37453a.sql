
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.run_evaluate_alerts_job(_url text, _apikey text)
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
    jsonb_build_object('job','evaluate-alerts','request_id', _req_id, 'url', _url)
  );

  RETURN _req_id;
END;
$$;
