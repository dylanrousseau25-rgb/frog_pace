create or replace function private.apply_weekly_adaptation(p_review_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, auth, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_review public.weekly_reviews%rowtype;
  v_adapt record;
  v_count integer := 0;
begin
  if v_user is null then raise exception 'Session utilisateur requise'; end if;
  select * into v_review from public.weekly_reviews where id=p_review_id and user_id=v_user;
  if v_review.id is null then raise exception 'Bilan introuvable'; end if;
  if v_review.status='applied' then return jsonb_build_object('reviewId',v_review.id,'applied',0,'alreadyApplied',true); end if;
  if v_review.status='no_change' then return jsonb_build_object('reviewId',v_review.id,'applied',0,'noChange',true); end if;

  for v_adapt in select * from public.plan_adaptations where review_id=v_review.id and user_id=v_user and status='proposed' order by created_at
  loop
    update public.planned_workouts set
      sport = coalesce(v_adapt.after_state->>'sport', sport),
      workout_type = coalesce(v_adapt.after_state->>'workout_type', workout_type),
      title = coalesce(v_adapt.after_state->>'title', title),
      description = case when v_adapt.after_state ? 'description' then nullif(v_adapt.after_state->>'description','') else description end,
      duration_s = case when v_adapt.after_state ? 'duration_s' and jsonb_typeof(v_adapt.after_state->'duration_s') <> 'null' then (v_adapt.after_state->>'duration_s')::integer else null end,
      distance_m = case when v_adapt.after_state ? 'distance_m' and jsonb_typeof(v_adapt.after_state->'distance_m') <> 'null' then (v_adapt.after_state->>'distance_m')::numeric else null end,
      intensity = case when v_adapt.after_state ? 'intensity' then nullif(v_adapt.after_state->>'intensity','') else intensity end,
      structured_steps = coalesce(v_adapt.after_state->'structured_steps', structured_steps),
      device_export_ready = case when v_adapt.after_state ? 'device_export_ready' then (v_adapt.after_state->>'device_export_ready')::boolean else device_export_ready end,
      updated_at = now()
    where id=v_adapt.planned_workout_id and user_id=v_user and status='planned' and workout_type not in ('race','secondary_goal_event');

    if found then
      delete from public.workout_exports where user_id=v_user and planned_workout_id=v_adapt.planned_workout_id;
      update public.plan_adaptations set status='applied',applied_at=now() where id=v_adapt.id;
      v_count := v_count + 1;
    else
      update public.plan_adaptations set status='skipped' where id=v_adapt.id;
    end if;
  end loop;

  update public.weekly_reviews set status='applied',applied_at=now(),updated_at=now() where id=v_review.id;
  return jsonb_build_object('reviewId',v_review.id,'applied',v_count,'alreadyApplied',false,'exportsInvalidated',v_count);
end;
$$;
