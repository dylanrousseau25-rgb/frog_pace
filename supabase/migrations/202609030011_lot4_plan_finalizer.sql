create or replace function private.finalize_training_plan(p_plan_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_plan public.training_plans%rowtype;
  v_goal public.goals%rowtype;
  v_week_id uuid;
  v_target_pace numeric;
begin
  if v_uid is null then raise exception 'Non authentifié'; end if;

  select * into v_plan from public.training_plans where id=p_plan_id and user_id=v_uid;
  if not found then raise exception 'Plan introuvable'; end if;
  select * into v_goal from public.goals where id=v_plan.goal_id and user_id=v_uid;
  if not found then raise exception 'Objectif introuvable'; end if;

  update public.planned_workouts
  set sport = case
    when workout_type='strength' then 'strength'
    when workout_type='mobility' then 'mobility'
    else sport
  end
  where plan_id=p_plan_id and user_id=v_uid and workout_type in ('strength','mobility');

  if not exists(
    select 1 from public.planned_workouts
    where plan_id=p_plan_id and user_id=v_uid and workout_type='race' and scheduled_date=v_goal.event_date
  ) then
    select id into v_week_id
    from public.training_plan_weeks
    where plan_id=p_plan_id and user_id=v_uid and v_goal.event_date between starts_on and ends_on
    order by week_index desc limit 1;

    if v_week_id is null then
      insert into public.training_plan_weeks(plan_id,user_id,week_index,starts_on,ends_on,phase,target_sessions,load_scale,notes)
      values(
        p_plan_id,v_uid,
        coalesce((select max(week_index)+1 from public.training_plan_weeks where plan_id=p_plan_id),0),
        v_goal.event_date,v_goal.event_date,'race',1,0.40,'Jour J.'
      ) returning id into v_week_id;
    end if;

    select nullif(a.metrics->>'target_pace_seconds_per_km','')::numeric into v_target_pace
    from public.goal_feasibility_assessments a where a.id=v_plan.assessment_id;

    insert into public.planned_workouts(
      plan_id,plan_week_id,user_id,goal_id,scheduled_date,sort_order,sport,workout_type,title,description,duration_s,distance_m,intensity,structured_steps,status,source
    ) values(
      p_plan_id,v_week_id,v_uid,v_goal.id,v_goal.event_date,0,v_goal.sport,'race',v_goal.event_name,
      'Jour J. Utilise la stratégie d’allure validée par Frog et pars de façon contrôlée.',
      v_goal.target_duration_s,v_goal.distance_m,'race',
      jsonb_build_array(jsonb_build_object('kind','race','distance_m',v_goal.distance_m,'target_duration_s',v_goal.target_duration_s,'target_pace_seconds_per_km',v_target_pace)),
      'planned','plan-engine-v1'
    );

    update public.training_plan_weeks
    set target_sessions=(select count(*) from public.planned_workouts where plan_week_id=v_week_id)
    where id=v_week_id;
  end if;

  return p_plan_id;
end;
$$;

revoke all on function private.finalize_training_plan(uuid) from public, anon;
grant execute on function private.finalize_training_plan(uuid) to authenticated, service_role;

create or replace function public.generate_training_plan(p_force boolean default false)
returns uuid
language sql
security invoker
set search_path = public, private, pg_temp
as $$
  select private.finalize_training_plan(private.generate_training_plan(p_force));
$$;
revoke all on function public.generate_training_plan(boolean) from public, anon;
grant execute on function public.generate_training_plan(boolean) to authenticated, service_role;
