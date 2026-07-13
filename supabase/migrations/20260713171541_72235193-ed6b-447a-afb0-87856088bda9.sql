-- 1) OAuth clients registered dynamically at the Monitor News auth server (one per redirect URI)
CREATE TABLE public.monitor_news_oauth_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  redirect_uri text NOT NULL UNIQUE,
  client_id text NOT NULL,
  client_secret_ciphertext text,
  token_endpoint_auth_method text NOT NULL DEFAULT 'none',
  registration_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.monitor_news_oauth_clients TO service_role;
ALTER TABLE public.monitor_news_oauth_clients ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_mn_clients_updated BEFORE UPDATE ON public.monitor_news_oauth_clients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) Per-user OAuth connection to Monitor News
CREATE TABLE public.monitor_news_connections (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  access_token_ciphertext text NOT NULL,
  refresh_token_ciphertext text,
  token_type text NOT NULL DEFAULT 'Bearer',
  scope text,
  expires_at timestamptz,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.monitor_news_connections TO service_role;
-- Also allow authenticated users to READ their own connection status (no tokens exposed via API — status only via server fn)
GRANT SELECT ON public.monitor_news_connections TO authenticated;
ALTER TABLE public.monitor_news_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own MN connection" ON public.monitor_news_connections
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER trg_mn_conn_updated BEFORE UPDATE ON public.monitor_news_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) Short-lived PKCE state store
CREATE TABLE public.monitor_news_oauth_states (
  state text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_verifier text NOT NULL,
  redirect_uri text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.monitor_news_oauth_states TO service_role;
ALTER TABLE public.monitor_news_oauth_states ENABLE ROW LEVEL SECURITY;

-- 4) External source columns on clients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS external_source text,
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS clients_external_unique
  ON public.clients (organization_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;