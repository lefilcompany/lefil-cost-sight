ALTER TABLE public.integration_api_keys
  ADD COLUMN IF NOT EXISTS scope_provider_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS scope_platform_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

COMMENT ON COLUMN public.integration_api_keys.scope_provider_ids IS 'Fornecedores permitidos para esta chave. Vazio = todos.';
COMMENT ON COLUMN public.integration_api_keys.scope_platform_ids IS 'Plataformas permitidas para esta chave. Vazio = todas.';