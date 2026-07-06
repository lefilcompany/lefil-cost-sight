
create or replace function public.get_connection_api_key_internal(_connection_id uuid)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  _sid uuid;
  _val text;
  _role text;
begin
  _role := coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', '');
  if _role <> 'service_role' then
    raise exception 'forbidden';
  end if;
  select api_key_secret_id into _sid from public.provider_connections where id = _connection_id;
  if _sid is null then return null; end if;
  select decrypted_secret into _val from vault.decrypted_secrets where id = _sid;
  return _val;
end;
$$;

revoke all on function public.get_connection_api_key_internal(uuid) from public;
revoke all on function public.get_connection_api_key_internal(uuid) from anon;
revoke all on function public.get_connection_api_key_internal(uuid) from authenticated;
grant execute on function public.get_connection_api_key_internal(uuid) to service_role;
