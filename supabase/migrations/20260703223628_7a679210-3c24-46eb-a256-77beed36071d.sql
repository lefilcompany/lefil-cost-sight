
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

ALTER TABLE public.provider_connections
  ADD COLUMN IF NOT EXISTS api_key_secret_id uuid;

-- Set (create/update) API key in Vault — admin only
CREATE OR REPLACE FUNCTION public.set_connection_api_key(_connection_id uuid, _api_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  _existing uuid;
  _new_id uuid;
  _secret_name text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF _api_key IS NULL OR length(btrim(_api_key)) = 0 THEN
    RAISE EXCEPTION 'api_key_required';
  END IF;

  SELECT api_key_secret_id INTO _existing
  FROM public.provider_connections WHERE id = _connection_id;

  _secret_name := 'provider_connection_' || _connection_id::text;

  IF _existing IS NOT NULL THEN
    PERFORM vault.update_secret(_existing, _api_key, _secret_name);
  ELSE
    _new_id := vault.create_secret(_api_key, _secret_name,
      'API key for provider connection ' || _connection_id::text);
    UPDATE public.provider_connections
      SET api_key_secret_id = _new_id WHERE id = _connection_id;
  END IF;
END;
$$;

-- Clear API key — admin only
CREATE OR REPLACE FUNCTION public.clear_connection_api_key(_connection_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  _existing uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT api_key_secret_id INTO _existing
  FROM public.provider_connections WHERE id = _connection_id;
  IF _existing IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = _existing;
    UPDATE public.provider_connections
      SET api_key_secret_id = NULL WHERE id = _connection_id;
  END IF;
END;
$$;

-- Read decrypted API key — admin only (used by sync jobs)
CREATE OR REPLACE FUNCTION public.get_connection_api_key(_connection_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  _existing uuid;
  _value text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT api_key_secret_id INTO _existing
  FROM public.provider_connections WHERE id = _connection_id;
  IF _existing IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO _value
  FROM vault.decrypted_secrets WHERE id = _existing;
  RETURN _value;
END;
$$;

REVOKE ALL ON FUNCTION public.set_connection_api_key(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.clear_connection_api_key(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_connection_api_key(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_connection_api_key(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_connection_api_key(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_connection_api_key(uuid) TO authenticated;
