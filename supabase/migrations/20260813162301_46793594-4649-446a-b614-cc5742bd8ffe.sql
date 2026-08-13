ALTER TABLE public.integration_api_keys
  ADD COLUMN IF NOT EXISTS auto_rotate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rotate_before_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS rotation_interval_days integer,
  ADD COLUMN IF NOT EXISTS last_rotated_at timestamptz,
  ADD COLUMN IF NOT EXISTS rotation_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_rotation_at timestamptz,
  ADD COLUMN IF NOT EXISTS pending_secret_id uuid,
  ADD COLUMN IF NOT EXISTS pending_secret_at timestamptz;

CREATE OR REPLACE FUNCTION public.store_api_key_rotation_secret(_key_id uuid, _secret text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  _existing uuid;
  _new_id uuid;
  _name text;
BEGIN
  SELECT pending_secret_id INTO _existing FROM public.integration_api_keys WHERE id = _key_id;
  _name := 'integration_api_key_' || _key_id::text;
  IF _existing IS NOT NULL THEN
    PERFORM vault.update_secret(_existing, _secret, _name);
    UPDATE public.integration_api_keys SET pending_secret_at = now() WHERE id = _key_id;
  ELSE
    _new_id := vault.create_secret(_secret, _name, 'Chave gerada por rotação automática ' || _key_id::text);
    UPDATE public.integration_api_keys
      SET pending_secret_id = _new_id, pending_secret_at = now()
      WHERE id = _key_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.store_api_key_rotation_secret(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_api_key_rotation_secret(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.reveal_api_key_rotation_secret(_key_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  _sid uuid;
  _val text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT pending_secret_id INTO _sid FROM public.integration_api_keys WHERE id = _key_id;
  IF _sid IS NULL THEN RETURN NULL; END IF;

  SELECT decrypted_secret INTO _val FROM vault.decrypted_secrets WHERE id = _sid;

  DELETE FROM vault.secrets WHERE id = _sid;
  UPDATE public.integration_api_keys
    SET pending_secret_id = NULL, pending_secret_at = NULL
    WHERE id = _key_id;

  RETURN _val;
END;
$$;

REVOKE ALL ON FUNCTION public.reveal_api_key_rotation_secret(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reveal_api_key_rotation_secret(uuid) TO authenticated, service_role;