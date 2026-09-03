create or replace function public.service_delete_user_audit_events(p_user_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count bigint;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  delete from public.audit_events where user_id = p_user_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.service_delete_user_audit_events(uuid) from public, anon, authenticated;
grant execute on function public.service_delete_user_audit_events(uuid) to service_role;
