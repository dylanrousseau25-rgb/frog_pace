create or replace function public.cancel_primary_goal(p_goal_id uuid)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_goal public.goals%rowtype;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_goal
  from public.goals
  where id = p_goal_id and user_id = v_user and goal_type = 'primary' and status = 'active';

  if not found then
    raise exception 'ACTIVE_PRIMARY_GOAL_NOT_FOUND';
  end if;

  update public.planned_workouts
  set status = 'cancelled', updated_at = now()
  where user_id = v_user
    and goal_id = p_goal_id
    and status = 'planned';

  update public.training_plans
  set status = 'cancelled', updated_at = now()
  where user_id = v_user
    and goal_id = p_goal_id
    and status = 'active';

  update public.goals
  set status = 'cancelled', updated_at = now()
  where user_id = v_user
    and parent_goal_id = p_goal_id
    and status = 'active';

  update public.goals
  set status = 'cancelled', updated_at = now()
  where id = p_goal_id and user_id = v_user;
end;
$$;

revoke all on function public.cancel_primary_goal(uuid) from public, anon;
grant execute on function public.cancel_primary_goal(uuid) to authenticated;
