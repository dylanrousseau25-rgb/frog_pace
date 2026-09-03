create table if not exists public.race_strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  plan_id uuid references public.training_plans(id) on delete set null,
  assessment_id uuid references public.goal_feasibility_assessments(id) on delete set null,
  version integer not null,
  strategy_version text not null default 'race-day-v1',
  status text not null default 'active' check (status in ('active','superseded')),
  target_duration_s integer not null,
  target_pace_s_per_km numeric not null,
  segments jsonb not null default '[]'::jsonb,
  fueling jsonb not null default '[]'::jsonb,
  checklist jsonb not null default '[]'::jsonb,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, goal_id, version)
);

create unique index if not exists race_strategies_active_goal_idx on public.race_strategies(user_id, goal_id) where status = 'active';
create index if not exists race_strategies_goal_idx on public.race_strategies(goal_id);
create index if not exists race_strategies_plan_idx on public.race_strategies(plan_id);
create index if not exists race_strategies_assessment_idx on public.race_strategies(assessment_id);

alter table public.race_strategies enable row level security;
drop policy if exists race_strategies_select_own on public.race_strategies;
create policy race_strategies_select_own on public.race_strategies for select using (user_id = (select auth.uid()));

create table if not exists public.coach_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Conversation avec Frog',
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists coach_threads_user_updated_idx on public.coach_threads(user_id, updated_at desc);
alter table public.coach_threads enable row level security;
drop policy if exists coach_threads_select_own on public.coach_threads;
drop policy if exists coach_threads_insert_own on public.coach_threads;
drop policy if exists coach_threads_update_own on public.coach_threads;
drop policy if exists coach_threads_delete_own on public.coach_threads;
create policy coach_threads_select_own on public.coach_threads for select using (user_id = (select auth.uid()));
create policy coach_threads_insert_own on public.coach_threads for insert with check (user_id = (select auth.uid()));
create policy coach_threads_update_own on public.coach_threads for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy coach_threads_delete_own on public.coach_threads for delete using (user_id = (select auth.uid()));

create table if not exists public.coach_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.coach_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null check (char_length(content) between 1 and 12000),
  context_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists coach_messages_thread_created_idx on public.coach_messages(thread_id, created_at);
create index if not exists coach_messages_user_idx on public.coach_messages(user_id);
alter table public.coach_messages enable row level security;
drop policy if exists coach_messages_select_own on public.coach_messages;
drop policy if exists coach_messages_insert_user_own on public.coach_messages;
create policy coach_messages_select_own on public.coach_messages for select using (user_id = (select auth.uid()));
create policy coach_messages_insert_user_own on public.coach_messages for insert
  with check (user_id = (select auth.uid()) and role = 'user' and exists (
    select 1 from public.coach_threads t where t.id = thread_id and t.user_id = (select auth.uid())
  ));

create or replace function private.get_progress_dashboard()
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare
  v_user uuid := auth.uid();
  v_plan uuid;
  v_goal uuid;
  v_result jsonb;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select id, goal_id into v_plan, v_goal from public.training_plans where user_id = v_user and status = 'active' order by created_at desc limit 1;

  with a365 as (
    select * from public.activities where user_id = v_user and started_at >= now() - interval '365 days'
  ), cur28 as (
    select * from a365 where started_at >= now() - interval '28 days'
  ), prev28 as (
    select * from a365 where started_at >= now() - interval '56 days' and started_at < now() - interval '28 days'
  ), cur90 as (
    select * from a365 where started_at >= now() - interval '90 days'
  ), weekly as (
    select date_trunc('week', started_at)::date as week_start,
      count(*)::int as activities,
      coalesce(sum(distance_m) filter (where sport_type between 100 and 199),0)::numeric as running_distance_m,
      coalesce(sum(duration_s),0)::bigint as duration_s,
      coalesce(sum(training_load),0)::numeric as training_load
    from a365 where started_at >= date_trunc('week', now()) - interval '11 weeks'
    group by 1 order by 1
  ), latest_fit as (
    select * from public.fitness_snapshots where user_id = v_user order by captured_at desc limit 1
  ), plan_stats as (
    select count(*) filter (where scheduled_date <= current_date)::int as planned_due,
      count(*) filter (where scheduled_date <= current_date and status = 'completed')::int as completed_due,
      count(*) filter (where scheduled_date > current_date)::int as remaining
    from public.planned_workouts where plan_id = v_plan
  ), analysis_stats as (
    select count(*)::int as analyses, round(avg(wa.adherence_score)::numeric,1) as avg_adherence
    from public.workout_analyses wa join public.workout_matches wm on wm.id = wa.match_id join public.planned_workouts pw on pw.id = wm.planned_workout_id
    where wa.user_id = v_user and (v_plan is null or pw.plan_id = v_plan)
  ), feedback_stats as (
    select count(*)::int as feedback_count, round(avg(perceived_effort)::numeric,1) as avg_rpe from public.workout_feedback where user_id = v_user
  ), adaptation_stats as (
    select count(*) filter (where status='applied')::int as applied from public.plan_adaptations where user_id = v_user
  )
  select jsonb_build_object(
    'generatedAt', now(), 'goalId', v_goal, 'planId', v_plan,
    'current28', jsonb_build_object('activities',(select count(*) from cur28),'runningDistanceM',coalesce((select sum(distance_m) from cur28 where sport_type between 100 and 199),0),'durationS',coalesce((select sum(duration_s) from cur28),0),'elevationM',coalesce((select sum(elevation_gain_m) from cur28),0),'trainingLoad',coalesce((select sum(training_load) from cur28),0)),
    'previous28', jsonb_build_object('activities',(select count(*) from prev28),'runningDistanceM',coalesce((select sum(distance_m) from prev28 where sport_type between 100 and 199),0),'durationS',coalesce((select sum(duration_s) from prev28),0),'trainingLoad',coalesce((select sum(training_load) from prev28),0)),
    'last90', jsonb_build_object('activities',(select count(*) from cur90),'runningDistanceM',coalesce((select sum(distance_m) from cur90 where sport_type between 100 and 199),0),'longestRunM',coalesce((select max(distance_m) from cur90 where sport_type between 100 and 199),0)),
    'year', jsonb_build_object('activities',(select count(*) from a365),'runningDistanceM',coalesce((select sum(distance_m) from a365 where sport_type between 100 and 199),0),'longestRunM',coalesce((select max(distance_m) from a365 where sport_type between 100 and 199),0),'activeWeeks',(select count(distinct date_trunc('week', started_at)) from a365)),
    'weekly', coalesce((select jsonb_agg(jsonb_build_object('weekStart',week_start,'activities',activities,'runningDistanceM',running_distance_m,'durationS',duration_s,'trainingLoad',training_load) order by week_start) from weekly),'[]'::jsonb),
    'fitness', coalesce((select jsonb_build_object('capturedAt',captured_at,'recovery',recovery,'shortLoad',short_load,'longLoad',long_load,'loadRatio',load_ratio,'vo2max',vo2max,'thresholdPace',threshold_pace,'thresholdHr',threshold_hr,'hrv',hrv,'restingHr',resting_hr) from latest_fit),'{}'::jsonb),
    'plan', coalesce((select jsonb_build_object('plannedDue',planned_due,'completedDue',completed_due,'remaining',remaining) from plan_stats),'{}'::jsonb),
    'feedback', coalesce((select jsonb_build_object('count',feedback_count,'avgRpe',avg_rpe) from feedback_stats),'{}'::jsonb),
    'analyses', coalesce((select jsonb_build_object('count',analyses,'avgAdherence',avg_adherence) from analysis_stats),'{}'::jsonb),
    'adaptations', coalesce((select jsonb_build_object('applied',applied) from adaptation_stats),'{}'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.get_progress_dashboard() returns jsonb language sql security invoker set search_path = pg_catalog, public, private as $$ select private.get_progress_dashboard(); $$;

create or replace function private.generate_race_strategy()
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare
  v_user uuid := auth.uid();
  v_goal public.goals%rowtype;
  v_plan public.training_plans%rowtype;
  v_assessment public.goal_feasibility_assessments%rowtype;
  v_fit public.fitness_snapshots%rowtype;
  v_review public.weekly_reviews%rowtype;
  v_version int;
  v_distance_km numeric;
  v_q numeric;
  v_target_pace numeric;
  v_p1 numeric; v_p2 numeric; v_p3 numeric; v_p4 numeric;
  v_c1 numeric; v_c2 numeric; v_c3 numeric;
  v_segments jsonb; v_fueling jsonb; v_checklist jsonb; v_id uuid;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select * into v_goal from public.goals where user_id=v_user and goal_type='primary' and status='active' order by created_at desc limit 1;
  if not found then raise exception 'No active primary goal'; end if;
  if v_goal.target_duration_s is null or v_goal.distance_m is null or v_goal.distance_m <= 0 then raise exception 'Goal needs target duration and distance'; end if;
  select * into v_plan from public.training_plans where user_id=v_user and goal_id=v_goal.id and status='active' order by created_at desc limit 1;
  if v_goal.accepted_assessment_id is not null then select * into v_assessment from public.goal_feasibility_assessments where id=v_goal.accepted_assessment_id and user_id=v_user; end if;
  select * into v_fit from public.fitness_snapshots where user_id=v_user order by captured_at desc limit 1;
  select * into v_review from public.weekly_reviews where user_id=v_user order by created_at desc limit 1;

  v_distance_km := v_goal.distance_m / 1000.0;
  v_q := v_distance_km / 4.0;
  v_target_pace := v_goal.target_duration_s / v_distance_km;
  v_p1 := v_target_pace + 4; v_p2 := v_target_pace + 1; v_p3 := v_target_pace;
  v_c1 := v_q*v_p1; v_c2 := v_c1+v_q*v_p2; v_c3 := v_c2+v_q*v_p3;
  v_p4 := greatest(v_target_pace-12,(v_goal.target_duration_s-v_c3)/v_q);
  v_segments := jsonb_build_array(
    jsonb_build_object('fromKm',0,'toKm',round(v_q,1),'paceSecondsPerKm',round(v_p1),'cumulativeTargetS',round(v_c1),'instruction','Départ contrôlé. Laisser passer les accélérations et trouver le rythme.'),
    jsonb_build_object('fromKm',round(v_q,1),'toKm',round(v_q*2,1),'paceSecondsPerKm',round(v_p2),'cumulativeTargetS',round(v_c2),'instruction','Stabiliser l’allure et courir relâché, sans chercher à gagner du temps.'),
    jsonb_build_object('fromKm',round(v_q*2,1),'toKm',round(v_q*3,1),'paceSecondsPerKm',round(v_p3),'cumulativeTargetS',round(v_c3),'instruction','Tenir l’allure cible. Vérifier la respiration et la qualité de foulée.'),
    jsonb_build_object('fromKm',round(v_q*3,1),'toKm',round(v_distance_km,1),'paceSecondsPerKm',round(v_p4),'cumulativeTargetS',v_goal.target_duration_s,'instruction','Accélération progressive seulement si les sensations restent maîtrisées.')
  );
  v_fueling := case when v_goal.target_duration_s >= 5400 then jsonb_build_array(
    jsonb_build_object('when','Avant le départ','instruction','Petit-déjeuner et hydratation déjà testés à l’entraînement. Ne rien expérimenter le jour J.'),
    jsonb_build_object('when','Vers 40–45 min','instruction','Premier apport uniquement avec un produit déjà toléré à l’entraînement, accompagné de quelques gorgées d’eau.'),
    jsonb_build_object('when','Vers 80–85 min','instruction','Deuxième apport si cela correspond à ta routine testée. Boire selon les ravitaillements et les conditions.'))
    else jsonb_build_array(jsonb_build_object('when','Avant le départ','instruction','Utiliser uniquement une routine déjà testée à l’entraînement.'),jsonb_build_object('when','Pendant','instruction','Hydratation selon les conditions et les ravitaillements, sans nouveauté le jour J.')) end;
  v_checklist := jsonb_build_array(
    jsonb_build_object('phase','J-1','items',jsonb_build_array('Préparer tenue, dossard et matériel','Ne pas chercher à compenser une séance manquée','Repas et hydratation habituels')),
    jsonb_build_object('phase','Avant départ','items',jsonb_build_array('Routine habituelle','Échauffement court et progressif','Se placer sans partir au rythme des autres')),
    jsonb_build_object('phase','Pendant','items',jsonb_build_array('Contrôler les premiers kilomètres','Suivre les segments plutôt que l’allure instantanée','N’accélérer franchement qu’en fin de course si les sensations le permettent')),
    jsonb_build_object('phase','Plan B','items',jsonb_build_array('Si l’effort est anormalement élevé tôt, ralentir immédiatement','Prioriser une course régulière plutôt qu’un chrono forcé','En cas de douleur inhabituelle ou malaise, arrêter l’effort et demander de l’aide'))
  );
  update public.race_strategies set status='superseded',updated_at=now() where user_id=v_user and goal_id=v_goal.id and status='active';
  select coalesce(max(version),0)+1 into v_version from public.race_strategies where user_id=v_user and goal_id=v_goal.id;
  insert into public.race_strategies(user_id,goal_id,plan_id,assessment_id,version,target_duration_s,target_pace_s_per_km,segments,fueling,checklist,context)
  values(v_user,v_goal.id,v_plan.id,v_goal.accepted_assessment_id,v_version,v_goal.target_duration_s,v_target_pace,v_segments,v_fueling,v_checklist,jsonb_strip_nulls(jsonb_build_object('eventName',v_goal.event_name,'eventDate',v_goal.event_date,'distanceM',v_goal.distance_m,'feasibilityVerdict',v_assessment.verdict,'feasibilityScore',v_assessment.score,'recovery',v_fit.recovery,'loadRatio',v_fit.load_ratio,'thresholdPace',v_fit.threshold_pace,'weeklyDecision',v_review.decision,'readinessScore',v_review.readiness_score,'generatedFromPlanVersion',v_plan.version))) returning id into v_id;
  return (select to_jsonb(r) from public.race_strategies r where r.id=v_id);
end;
$$;
create or replace function public.generate_race_strategy() returns jsonb language sql security invoker set search_path = pg_catalog, public, private as $$ select private.generate_race_strategy(); $$;

create or replace function private.get_coach_context()
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare v_user uuid := auth.uid(); v_context jsonb;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select jsonb_build_object(
    'generatedAt',now(),
    'goal',(select to_jsonb(g)-'user_id' from public.goals g where g.user_id=v_user and g.goal_type='primary' and g.status='active' order by g.created_at desc limit 1),
    'assessment',(select to_jsonb(a)-'user_id' from public.goal_feasibility_assessments a join public.goals g on g.accepted_assessment_id=a.id where g.user_id=v_user and g.goal_type='primary' and g.status='active' limit 1),
    'plan',(select to_jsonb(p)-'user_id'-'generation_context' from public.training_plans p where p.user_id=v_user and p.status='active' order by p.created_at desc limit 1),
    'todayWorkout',(select to_jsonb(pw)-'user_id'-'structured_steps' from public.planned_workouts pw join public.training_plans p on p.id=pw.plan_id where pw.user_id=v_user and p.status='active' and pw.scheduled_date=current_date order by pw.sort_order limit 1),
    'nextWorkout',(select to_jsonb(pw)-'user_id'-'structured_steps' from public.planned_workouts pw join public.training_plans p on p.id=pw.plan_id where pw.user_id=v_user and p.status='active' and pw.scheduled_date>=current_date and pw.status='planned' order by pw.scheduled_date,pw.sort_order limit 1),
    'fitness',(select to_jsonb(f)-'user_id'-'raw_provider_data' from public.fitness_snapshots f where f.user_id=v_user order by f.captured_at desc limit 1),
    'weeklyReview',(select to_jsonb(w)-'user_id' from public.weekly_reviews w where w.user_id=v_user order by w.created_at desc limit 1),
    'recentActivities',coalesce((select jsonb_agg(x order by (x->>'started_at') desc) from (select to_jsonb(a)-'user_id'-'raw_provider_data'-'detail_provider_data' as x from public.activities a where a.user_id=v_user order by a.started_at desc limit 5) s),'[]'::jsonb),
    'recentAnalyses',coalesce((select jsonb_agg(to_jsonb(wa)-'user_id' order by wa.created_at desc) from public.workout_analyses wa where wa.user_id=v_user order by wa.created_at desc limit 5),'[]'::jsonb),
    'memories',coalesce((select jsonb_agg(jsonb_build_object('category',m.category,'content',m.content,'source',m.source,'confidence',m.confidence)) from public.coach_memories m where m.user_id=v_user and m.status='active' and not m.sensitive),'[]'::jsonb),
    'raceStrategy',(select to_jsonb(r)-'user_id' from public.race_strategies r where r.user_id=v_user and r.status='active' order by r.created_at desc limit 1),
    'progress',private.get_progress_dashboard()
  ) into v_context;
  return v_context;
end;
$$;
create or replace function public.get_coach_context() returns jsonb language sql security invoker set search_path = pg_catalog, public, private as $$ select private.get_coach_context(); $$;

create or replace function private.append_coach_assistant_message(p_thread_id uuid,p_content text,p_context jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, private
as $$
declare v_user uuid := auth.uid(); v_id uuid;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if not exists(select 1 from public.coach_threads where id=p_thread_id and user_id=v_user) then raise exception 'Thread not found'; end if;
  if p_content is null or char_length(trim(p_content))=0 or char_length(p_content)>12000 then raise exception 'Invalid content'; end if;
  insert into public.coach_messages(thread_id,user_id,role,content,context_snapshot) values(p_thread_id,v_user,'assistant',p_content,coalesce(p_context,'{}'::jsonb)) returning id into v_id;
  update public.coach_threads set updated_at=now() where id=p_thread_id and user_id=v_user;
  return v_id;
end;
$$;
create or replace function public.append_coach_assistant_message(p_thread_id uuid,p_content text,p_context jsonb default '{}'::jsonb) returns uuid language sql security invoker set search_path = pg_catalog, public, private as $$ select private.append_coach_assistant_message(p_thread_id,p_content,p_context); $$;

grant usage on schema private to authenticated;
grant execute on function private.get_progress_dashboard() to authenticated;
grant execute on function private.generate_race_strategy() to authenticated;
grant execute on function private.get_coach_context() to authenticated;
grant execute on function private.append_coach_assistant_message(uuid,text,jsonb) to authenticated;
grant execute on function public.get_progress_dashboard() to authenticated;
grant execute on function public.generate_race_strategy() to authenticated;
grant execute on function public.get_coach_context() to authenticated;
grant execute on function public.append_coach_assistant_message(uuid,text,jsonb) to authenticated;
