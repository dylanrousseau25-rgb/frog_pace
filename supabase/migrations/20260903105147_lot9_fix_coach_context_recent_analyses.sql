create or replace function private.get_coach_context()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_user uuid := auth.uid();
  v_context jsonb;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select jsonb_build_object(
    'generatedAt',now(),
    'goal',(select to_jsonb(g) - 'user_id' from public.goals g where g.user_id=v_user and g.goal_type='primary' and g.status='active' order by g.created_at desc limit 1),
    'assessment',(select to_jsonb(a) - 'user_id' from public.goal_feasibility_assessments a join public.goals g on g.accepted_assessment_id=a.id where g.user_id=v_user and g.goal_type='primary' and g.status='active' limit 1),
    'plan',(select to_jsonb(p) - 'user_id' - 'generation_context' from public.training_plans p where p.user_id=v_user and p.status='active' order by p.created_at desc limit 1),
    'todayWorkout',(select to_jsonb(pw) - 'user_id' - 'structured_steps' from public.planned_workouts pw join public.training_plans p on p.id=pw.plan_id where pw.user_id=v_user and p.status='active' and pw.scheduled_date=current_date order by pw.sort_order limit 1),
    'nextWorkout',(select to_jsonb(pw) - 'user_id' - 'structured_steps' from public.planned_workouts pw join public.training_plans p on p.id=pw.plan_id where pw.user_id=v_user and p.status='active' and pw.scheduled_date>=current_date and pw.status='planned' order by pw.scheduled_date,pw.sort_order limit 1),
    'fitness',(select to_jsonb(f) - 'user_id' - 'raw_provider_data' from public.fitness_snapshots f where f.user_id=v_user order by f.captured_at desc limit 1),
    'weeklyReview',(select to_jsonb(w) - 'user_id' from public.weekly_reviews w where w.user_id=v_user order by w.created_at desc limit 1),
    'recentActivities',coalesce((select jsonb_agg(x order by (x->>'started_at') desc) from (select to_jsonb(a)-'user_id'-'raw_provider_data'-'detail_provider_data' as x from public.activities a where a.user_id=v_user order by a.started_at desc limit 5) s),'[]'::jsonb),
    'recentAnalyses',coalesce((select jsonb_agg(x order by (x->>'created_at') desc) from (select to_jsonb(wa)-'user_id' as x from public.workout_analyses wa where wa.user_id=v_user order by wa.created_at desc limit 5) s),'[]'::jsonb),
    'memories',coalesce((select jsonb_agg(jsonb_build_object('category',m.category,'content',m.content,'source',m.source,'confidence',m.confidence)) from public.coach_memories m where m.user_id=v_user and m.status='active' and not m.sensitive),'[]'::jsonb),
    'raceStrategy',(select to_jsonb(r)-'user_id' from public.race_strategies r where r.user_id=v_user and r.status='active' order by r.created_at desc limit 1),
    'progress',private.get_progress_dashboard()
  ) into v_context;
  return v_context;
end;
$$;
