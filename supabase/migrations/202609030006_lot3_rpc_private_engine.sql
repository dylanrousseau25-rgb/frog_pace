alter function public.assess_goal_feasibility(uuid) set schema private;

revoke all on function private.assess_goal_feasibility(uuid) from public, anon;
grant usage on schema private to authenticated, service_role;
grant execute on function private.assess_goal_feasibility(uuid) to authenticated, service_role;

create or replace function public.assess_goal_feasibility(p_goal_id uuid)
returns uuid
language sql
security invoker
set search_path = public, private, pg_temp
as $$
  select private.assess_goal_feasibility(p_goal_id);
$$;

revoke all on function public.assess_goal_feasibility(uuid) from public, anon;
grant execute on function public.assess_goal_feasibility(uuid) to authenticated, service_role;
