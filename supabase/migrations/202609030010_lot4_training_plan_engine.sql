create table if not exists public.training_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  assessment_id uuid not null references public.goal_feasibility_assessments(id) on delete restrict,
  version integer not null check (version > 0),
  engine_version text not null default 'plan-engine-v1',
  status text not null default 'active' check (status in ('active','superseded','cancelled')),
  starts_on date not null,
  ends_on date not null,
  sessions_per_week smallint not null check (sessions_per_week between 1 and 7),
  summary text not null,
  generation_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, goal_id, version)
);

create unique index if not exists training_plans_one_active_per_user
  on public.training_plans(user_id) where status = 'active';
create index if not exists training_plans_goal_idx on public.training_plans(goal_id, created_at desc);
create index if not exists training_plans_assessment_idx on public.training_plans(assessment_id);

create table if not exists public.training_plan_weeks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.training_plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  week_index integer not null check (week_index >= 0),
  starts_on date not null,
  ends_on date not null,
  phase text not null check (phase in ('build','taper','race')),
  target_sessions smallint not null default 0 check (target_sessions between 0 and 7),
  load_scale numeric not null default 1 check (load_scale > 0 and load_scale <= 1.5),
  notes text,
  created_at timestamptz not null default now(),
  unique(plan_id, week_index)
);
create index if not exists training_plan_weeks_user_idx on public.training_plan_weeks(user_id, starts_on);

create table if not exists public.planned_workouts (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.training_plans(id) on delete cascade,
  plan_week_id uuid not null references public.training_plan_weeks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  scheduled_date date not null,
  sort_order smallint not null default 0,
  sport text not null,
  workout_type text not null,
  title text not null,
  description text,
  duration_s integer check (duration_s is null or duration_s > 0),
  distance_m numeric check (distance_m is null or distance_m > 0),
  intensity text check (intensity is null or intensity in ('recovery','easy','moderate','quality','race')),
  structured_steps jsonb not null default '[]'::jsonb,
  status text not null default 'planned' check (status in ('planned','completed','skipped','cancelled')),
  source text not null default 'plan-engine-v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(plan_id, scheduled_date, sort_order)
);
create index if not exists planned_workouts_user_date_idx on public.planned_workouts(user_id, scheduled_date);
create index if not exists planned_workouts_plan_idx on public.planned_workouts(plan_id, scheduled_date);
create index if not exists planned_workouts_goal_idx on public.planned_workouts(goal_id, scheduled_date);

alter table public.training_plans enable row level security;
alter table public.training_plan_weeks enable row level security;
alter table public.planned_workouts enable row level security;

drop policy if exists training_plans_select_own on public.training_plans;
create policy training_plans_select_own on public.training_plans for select
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
drop policy if exists training_plans_delete_own on public.training_plans;
create policy training_plans_delete_own on public.training_plans for delete
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists training_plan_weeks_select_own on public.training_plan_weeks;
create policy training_plan_weeks_select_own on public.training_plan_weeks for select
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists planned_workouts_select_own on public.planned_workouts;
create policy planned_workouts_select_own on public.planned_workouts for select
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop trigger if exists training_plans_set_updated_at on public.training_plans;
create trigger training_plans_set_updated_at before update on public.training_plans
for each row execute function public.set_updated_at();
drop trigger if exists planned_workouts_set_updated_at on public.planned_workouts;
create trigger planned_workouts_set_updated_at before update on public.planned_workouts
for each row execute function public.set_updated_at();

create or replace function private.generate_training_plan(p_force boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_goal public.goals%rowtype;
  v_assessment public.goal_feasibility_assessments%rowtype;
  v_latest_assessment_id uuid;
  v_profile public.athlete_profiles%rowtype;
  v_existing_plan uuid;
  v_plan_id uuid;
  v_week_id uuid;
  v_version integer;
  v_sessions integer;
  v_long_day integer;
  v_days integer[];
  v_strength boolean := false;
  v_cross boolean := false;
  v_week_start date;
  v_week_end date;
  v_phase text;
  v_load_scale numeric;
  v_week_index integer := 0;
  v_idx integer;
  v_j integer;
  v_day integer;
  v_slot integer;
  v_date date;
  v_week_sessions integer;
  v_target_pace numeric;
  v_threshold_pace numeric;
  v_recent_long numeric;
  v_annual_long numeric;
  v_long_distance numeric;
  v_quality_duration integer;
  v_easy_duration integer;
  v_cross_duration integer;
  v_strength_duration integer;
  v_days_to_event integer;
  v_sport text;
  v_cross_sport text;
  v_title text;
  v_description text;
  v_workout_type text;
  v_intensity text;
  v_duration integer;
  v_distance numeric;
  v_steps jsonb;
begin
  if v_uid is null then raise exception 'Non authentifié'; end if;

  select * into v_goal
  from public.goals
  where user_id = v_uid and goal_type = 'primary' and status = 'active'
  limit 1;
  if not found then raise exception 'Aucun objectif principal actif'; end if;
  if v_goal.accepted_assessment_id is null then raise exception 'Valide d’abord l’analyse de faisabilité'; end if;

  select id into v_latest_assessment_id
  from public.goal_feasibility_assessments
  where goal_id = v_goal.id and user_id = v_uid
  order by created_at desc limit 1;
  if v_latest_assessment_id is distinct from v_goal.accepted_assessment_id then
    raise exception 'La dernière analyse de faisabilité doit être validée avant de générer le plan';
  end if;

  select * into v_assessment
  from public.goal_feasibility_assessments
  where id = v_goal.accepted_assessment_id and goal_id = v_goal.id and user_id = v_uid;
  if not found or v_assessment.verdict not in ('feasible','challenging') then
    raise exception 'L’évaluation validée ne permet pas de générer un plan';
  end if;

  if v_goal.event_date <= current_date then raise exception 'La date de l’objectif doit être dans le futur'; end if;

  select * into v_profile from public.athlete_profiles where user_id = v_uid;
  if not found then raise exception 'Profil athlète introuvable'; end if;

  select id into v_existing_plan
  from public.training_plans
  where user_id = v_uid and status = 'active'
  order by created_at desc limit 1;

  if v_existing_plan is not null and not p_force then
    if exists(select 1 from public.training_plans where id=v_existing_plan and assessment_id=v_assessment.id) then
      return v_existing_plan;
    end if;
  end if;

  if v_existing_plan is not null then
    update public.training_plans set status='superseded' where id=v_existing_plan and user_id=v_uid;
  end if;

  v_sessions := greatest(2, least(6, coalesce(v_profile.weekly_sessions_target, 4)));
  v_long_day := coalesce(v_profile.long_session_day, 7);
  select coalesce(array_agg(x::int order by x::int), array[2,4,6,7]) into v_days
  from jsonb_array_elements_text(coalesce(v_profile.availability->'days', '[]'::jsonb)) as t(x);
  if v_days is null or array_length(v_days,1) is null then v_days := array[2,4,6,7]; end if;
  if not (v_long_day = any(v_days)) then v_long_day := v_days[array_length(v_days,1)]; end if;

  v_strength := coalesce((v_profile.training_preferences->>'strength')::boolean, false);
  v_cross := coalesce((v_profile.training_preferences->>'crossTraining')::boolean, false);
  v_target_pace := nullif(v_assessment.metrics->>'target_pace_seconds_per_km','')::numeric;
  v_threshold_pace := nullif(v_assessment.metrics->>'threshold_pace_seconds_per_km','')::numeric;
  v_recent_long := coalesce(nullif(v_assessment.metrics->>'longest_recent_distance_m','')::numeric, v_goal.distance_m * 0.55);
  v_annual_long := coalesce(nullif(v_assessment.metrics->>'longest_365d_distance_m','')::numeric, v_recent_long);
  v_sport := v_goal.sport;
  v_cross_sport := case when v_sport in ('running','trail') then 'road_cycling' else v_sport end;

  select coalesce(max(version),0)+1 into v_version from public.training_plans where user_id=v_uid and goal_id=v_goal.id;

  insert into public.training_plans(user_id,goal_id,assessment_id,version,engine_version,status,starts_on,ends_on,sessions_per_week,summary,generation_context)
  values(
    v_uid,v_goal.id,v_assessment.id,v_version,'plan-engine-v1','active',current_date,v_goal.event_date,v_sessions,
    format('Préparation %s jusqu’au %s. Priorité à la régularité, une seule séance de qualité course par semaine et réduction progressive avant le jour J.', v_goal.event_name, to_char(v_goal.event_date,'DD/MM/YYYY')),
    jsonb_build_object(
      'goal_engine_version',v_assessment.model_version,
      'goal_score',v_assessment.score,
      'goal_confidence',v_assessment.confidence,
      'weekly_sessions_target',v_sessions,
      'availability_days',to_jsonb(v_days),
      'long_session_day',v_long_day,
      'strength_enabled',v_strength,
      'cross_training_enabled',v_cross,
      'recent_long_distance_m',round(v_recent_long),
      'annual_long_distance_m',round(v_annual_long),
      'target_pace_seconds_per_km',v_target_pace,
      'threshold_pace_seconds_per_km',v_threshold_pace
    )
  ) returning id into v_plan_id;

  for v_week_start in
    select gs::date from generate_series(date_trunc('week',current_date)::date, date_trunc('week',v_goal.event_date)::date, interval '7 days') gs
  loop
    v_week_end := least(v_week_start + 6, v_goal.event_date);
    v_days_to_event := v_goal.event_date - v_week_start;
    if v_goal.event_date between v_week_start and v_week_end then
      v_phase := 'race'; v_load_scale := 0.40;
    elsif v_days_to_event <= 14 then
      v_phase := 'taper'; v_load_scale := 0.70;
    else
      v_phase := 'build';
      v_load_scale := case when v_week_index > 0 and v_week_index % 4 = 3 then 0.85 else least(1.10, 0.92 + v_week_index * 0.05) end;
    end if;

    insert into public.training_plan_weeks(plan_id,user_id,week_index,starts_on,ends_on,phase,target_sessions,load_scale,notes)
    values(
      v_plan_id,v_uid,v_week_index,greatest(v_week_start,current_date),v_week_end,v_phase,0,v_load_scale,
      case v_phase
        when 'build' then 'Construire la régularité : qualité contrôlée, endurance facile, complément non-course et sortie longue.'
        when 'taper' then 'Réduire le volume tout en gardant quelques rappels d’allure. La fraîcheur devient prioritaire.'
        else 'Semaine de course : peu de volume, un rappel d’allure, puis jour J.'
      end
    ) returning id into v_week_id;

    v_week_sessions := 0;
    for v_idx in 1..array_length(v_days,1) loop
      exit when v_week_sessions >= v_sessions;
      v_day := v_days[v_idx];
      v_date := v_week_start + (v_day - 1);
      if v_date < current_date or v_date > v_goal.event_date then continue; end if;

      if v_date = v_goal.event_date then
        v_workout_type := 'race';
        v_title := v_goal.event_name;
        v_description := 'Jour J. Utilise la stratégie d’allure validée par Frog et pars de façon contrôlée.';
        v_intensity := 'race';
        v_duration := v_goal.target_duration_s;
        v_distance := v_goal.distance_m;
        v_steps := jsonb_build_array(jsonb_build_object('kind','race','distance_m',v_goal.distance_m,'target_duration_s',v_goal.target_duration_s,'target_pace_seconds_per_km',v_target_pace));
      elsif v_phase = 'race' then
        v_slot := 0;
        for v_j in 1..v_idx loop if v_days[v_j] <> v_long_day then v_slot := v_slot + 1; end if; end loop;
        if v_day = v_long_day then continue; end if;
        if v_slot = 1 then
          v_workout_type := 'easy'; v_title := 'Footing facile'; v_description := 'Course très facile, relâchée, sans chercher de volume.'; v_intensity := 'easy'; v_duration := 2100; v_distance := null;
          v_steps := jsonb_build_array(jsonb_build_object('kind','steady','duration_s',2100,'intensity','easy'));
        elsif v_slot = 2 then
          v_workout_type := 'mobility'; v_title := 'Mobilité légère'; v_description := 'Mobilité et activation douce. Aucune fatigue recherchée.'; v_intensity := 'recovery'; v_duration := 1200; v_distance := null;
          v_steps := jsonb_build_array(jsonb_build_object('kind','mobility','duration_s',1200,'intensity','recovery'));
        elsif v_slot = 3 then
          v_workout_type := 'sharpening'; v_title := 'Rappel allure objectif'; v_description := 'Séance courte : quelques minutes à allure objectif, avec beaucoup de récupération.'; v_intensity := 'quality'; v_duration := 1800; v_distance := null;
          v_steps := jsonb_build_array(
            jsonb_build_object('kind','warmup','duration_s',600,'intensity','easy'),
            jsonb_build_object('kind','repeat','repetitions',3,'work_duration_s',180,'recovery_duration_s',120,'target_pace_seconds_per_km',v_target_pace),
            jsonb_build_object('kind','cooldown','duration_s',300,'intensity','easy')
          );
        else
          continue;
        end if;
      elsif v_day = v_long_day then
        v_workout_type := 'long';
        v_title := case when v_sport='trail' then 'Sortie longue trail' when v_sport in ('road_cycling','gravel') then 'Sortie longue' else 'Sortie longue endurance' end;
        v_intensity := 'easy';
        if v_phase = 'taper' then
          v_long_distance := least(v_goal.distance_m*0.60, v_recent_long*0.85);
        else
          v_long_distance := least(v_goal.distance_m*0.85, greatest(v_goal.distance_m*0.60, least(v_recent_long,v_annual_long)*0.95) + v_week_index*1000);
        end if;
        if v_sport in ('road_cycling','gravel') then
          v_duration := case when v_phase='taper' then 5400 else least(10800, 7200 + v_week_index*600) end;
          v_distance := null;
          v_description := 'Endurance principalement facile. Conserve de la marge et une cadence confortable.';
          v_steps := jsonb_build_array(jsonb_build_object('kind','steady','duration_s',v_duration,'intensity','easy'));
        else
          v_distance := round(v_long_distance/100)*100;
          v_duration := null;
          v_description := case when v_phase='taper' then 'Sortie longue raccourcie. Reste facile du début à la fin.' else 'Sortie longue progressive mais majoritairement facile. Aucun besoin de finir épuisé.' end;
          v_steps := jsonb_build_array(jsonb_build_object('kind','steady','distance_m',v_distance,'intensity','easy'),jsonb_build_object('kind','guidance','target_pace_seconds_per_km',case when v_target_pace is null then null else round(v_target_pace*1.12) end));
        end if;
      else
        v_slot := 0;
        for v_j in 1..v_idx loop if v_days[v_j] <> v_long_day then v_slot := v_slot + 1; end if; end loop;

        if v_slot = 1 then
          v_quality_duration := case when v_phase='taper' then 2400 else least(3300,2700 + v_week_index*120) end;
          v_workout_type := case when v_sport in ('running','trail') then 'quality' else 'intervals' end;
          v_title := case when v_sport='running' then 'Qualité · allure contrôlée' when v_sport='trail' then 'Côtes / tempo trail' else 'Intervalles contrôlés' end;
          v_description := 'Une seule séance vraiment qualitative de la semaine. Garde toujours une répétition en réserve.';
          v_intensity := 'quality'; v_duration := v_quality_duration; v_distance := null;
          v_steps := jsonb_build_array(
            jsonb_build_object('kind','warmup','duration_s',900,'intensity','easy'),
            jsonb_build_object('kind','repeat','repetitions',case when v_phase='taper' then 3 else 4 end,'work_duration_s',300,'recovery_duration_s',120,'target_pace_seconds_per_km',coalesce(v_threshold_pace,v_target_pace)),
            jsonb_build_object('kind','cooldown','duration_s',600,'intensity','easy')
          );
        elsif v_slot = 2 and v_strength then
          v_strength_duration := case when v_phase='taper' then 1200 else 1800 end;
          v_workout_type := 'strength'; v_title := 'Renforcement + mobilité'; v_description := 'Renforcement général et gainage, sans aller à l’échec. Termine par quelques minutes de mobilité.'; v_intensity := 'moderate'; v_duration := v_strength_duration; v_distance := null;
          v_steps := jsonb_build_array(jsonb_build_object('kind','strength','duration_s',v_strength_duration,'intensity','moderate'));
        elsif (v_slot = 4 or (v_slot = 2 and not v_strength)) and v_cross then
          v_cross_duration := case when v_phase='taper' then 2400 else 3600 end;
          v_workout_type := 'cross_training'; v_title := 'Endurance croisée'; v_description := 'Vélo facile en endurance pour ajouter du travail aérobie sans ajouter une sortie course.'; v_intensity := 'easy'; v_duration := v_cross_duration; v_distance := null;
          v_steps := jsonb_build_array(jsonb_build_object('kind','steady','duration_s',v_cross_duration,'intensity','easy'));
          v_sport := v_cross_sport;
        else
          v_easy_duration := case when v_phase='taper' then 2100 else 2700 end;
          v_workout_type := 'easy'; v_title := case when v_goal.sport in ('road_cycling','gravel') then 'Endurance facile' else 'Footing facile' end;
          v_description := 'Endurance facile, respiration confortable. Cette séance doit laisser de la fraîcheur.'; v_intensity := 'easy'; v_duration := v_easy_duration; v_distance := null;
          v_steps := jsonb_build_array(jsonb_build_object('kind','steady','duration_s',v_easy_duration,'intensity','easy'));
        end if;
      end if;

      insert into public.planned_workouts(plan_id,plan_week_id,user_id,goal_id,scheduled_date,sort_order,sport,workout_type,title,description,duration_s,distance_m,intensity,structured_steps,status,source)
      values(v_plan_id,v_week_id,v_uid,v_goal.id,v_date,0,v_sport,v_workout_type,v_title,v_description,v_duration,v_distance,v_intensity,v_steps,'planned','plan-engine-v1');
      v_week_sessions := v_week_sessions + 1;
      v_sport := v_goal.sport;
    end loop;

    update public.training_plan_weeks set target_sessions=v_week_sessions where id=v_week_id;
    v_week_index := v_week_index + 1;
  end loop;

  return v_plan_id;
end;
$$;

revoke all on function private.generate_training_plan(boolean) from public, anon;
grant execute on function private.generate_training_plan(boolean) to authenticated, service_role;

create or replace function public.generate_training_plan(p_force boolean default false)
returns uuid
language sql
security invoker
set search_path = public, private, pg_temp
as $$ select private.generate_training_plan(p_force); $$;
revoke all on function public.generate_training_plan(boolean) from public, anon;
grant execute on function public.generate_training_plan(boolean) to authenticated, service_role;
