
REVOKE ALL ON FUNCTION public.run_evaluate_alerts_job(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_evaluate_alerts_job(text, text) TO postgres, service_role;
