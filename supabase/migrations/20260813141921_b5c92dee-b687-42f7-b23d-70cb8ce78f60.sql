CREATE INDEX IF NOT EXISTS idx_usage_daily_org_date_id
  ON public.provider_usage_daily (organization_id, usage_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_usage_daily_org_provider_date
  ON public.provider_usage_daily (organization_id, provider_id, usage_date DESC);

CREATE INDEX IF NOT EXISTS idx_usage_daily_org_model_date
  ON public.provider_usage_daily (organization_id, model, usage_date DESC);

ANALYZE public.provider_usage_daily;