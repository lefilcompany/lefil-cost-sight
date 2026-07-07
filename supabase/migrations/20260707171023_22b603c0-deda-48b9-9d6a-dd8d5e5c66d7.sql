CREATE OR REPLACE FUNCTION public.get_connection_api_key_internal(_connection_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
declare
  _sid uuid;
  _val text;
begin
  if current_user <> 'service_role' then
    raise exception 'forbidden';
  end if;
  select api_key_secret_id into _sid from public.provider_connections where id = _connection_id;
  if _sid is null then return null; end if;
  select decrypted_secret into _val from vault.decrypted_secrets where id = _sid;
  return _val;
end;
$function$;