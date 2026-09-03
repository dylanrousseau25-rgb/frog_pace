create table if not exists public.workout_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  planned_workout_id uuid not null references public.planned_workouts(id) on delete cascade,
  activity_id uuid not null references public.activities(id) on delete cascade,
  status text not null default 'suggested' check (status in ('suggested','confirmed','rejected')),
  match_method text not null default 'auto' check (match_method in ('auto','manual')),
  confidence numeric not null default 0 check (confidence >= 0 and confidence <= 1),
  score_breakdown jsonb not null default '{}'::jsonb,
  matched_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(planned_workout_id),
  unique(activity_id)
);

create index if not exists workout_matches_user_status_idx on public.workout_matches(user_id,status,matched_at desc);
create index if not exists workout_matches_activity_idx on public.workout_matches(activity_id);

create table if not exists public.workout_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id uuid not null references public.workout_matches(id) on delete cascade,
  planned_workout_id uuid not null references public.planned_workouts(id) on delete cascade,
  activity_id uuid not null references public.activities(id) on delete cascade,
  perceived_effort smallint not null check (perceived_effort between 1 and 10),
  feeling text not null check (feeling in ('very_easy','easy','as_expected','hard','very_hard')),
  completed_as_planned boolean not null,
  pain_or_discomfort boolean not null default false,
  notes text,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(match_id)
);

create index if not exists workout_feedback_user_idx on public.workout_feedback(user_id,submitted_at desc);
create index if not exists workout_feedback_activity_idx on public.workout_feedback(activity_id);
create index if not exists workout_feedback_planned_idx on public.workout_feedback(planned_workout_id);

create table if not exists public.workout_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id uuid not null references public.workout_matches(id) on delete cascade,
  feedback_id uuid references public.workout_feedback(id) on delete set null,
  adherence_score integer not null check (adherence_score between 0 and 100),
  outcome text not null check (outcome in ('on_track','easier_than_expected','harder_than_expected','deviated')),
  summary text not null,
  metrics jsonb not null default '{}'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  model_version text not null default 'post-session-v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(match_id)
);

create index if not exists workout_analyses_user_idx on public.workout_analyses(user_id,created_at desc);
create index if not exists workout_analyses_feedback_idx on public.workout_analyses(feedback_id);

alter table public.workout_matches enable row level security;
alter table public.workout_feedback enable row level security;
alter table public.workout_analyses enable row level security;

create policy workout_matches_select_own on public.workout_matches for select to authenticated using (user_id = auth.uid());
create policy workout_feedback_select_own on public.workout_feedback for select to authenticated using (user_id = auth.uid());
create policy workout_feedback_insert_own on public.workout_feedback for insert to authenticated with check (
  user_id = auth.uid()
  and exists(select 1 from public.workout_matches m where m.id=match_id and m.user_id=auth.uid() and m.status='confirmed' and m.planned_workout_id=planned_workout_id and m.activity_id=activity_id)
);
create policy workout_feedback_update_own on public.workout_feedback for update to authenticated using (user_id = auth.uid()) with check (
  user_id = auth.uid()
  and exists(select 1 from public.workout_matches m where m.id=match_id and m.user_id=auth.uid() and m.status='confirmed' and m.planned_workout_id=planned_workout_id and m.activity_id=activity_id)
);
create policy workout_feedback_delete_own on public.workout_feedback for delete to authenticated using (user_id = auth.uid());
create policy workout_analyses_select_own on public.workout_analyses for select to authenticated using (user_id = auth.uid());

grant select on public.workout_matches, public.workout_feedback, public.workout_analyses to authenticated;
grant insert, update, delete on public.workout_feedback to authenticated;

create or replace function private.sport_match_score(p_sport text, p_sport_type integer)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_sport='running' and p_sport_type in (100,101,103) then 35
    when p_sport='trail' and p_sport_type in (102,104,105) then 35
    when p_sport='road_cycling' and p_sport_type in (200,201,202,204,205,299) then 35
    when p_sport='gravel' and p_sport_type=203 then 35
    when p_sport='strength' and p_sport_type in (400,402,9901) then 35
    when p_sport='mobility' and p_sport_type in (904,905) then 35
    else 0
  end;
$$;

create or replace function private.refresh_workout_matches()
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_timezone text := 'Europe/Paris';
  v_activity record;
  v_candidate record;
  v_score integer;
  v_metric_score integer;
  v_date_score integer;
  v_deviation numeric;
  v_created integer := 0;
  v_confirmed integer := 0;
  v_suggested integer := 0;
begin
  if v_uid is null then raise exception 'Non authentifié'; end if;
  select coalesce(timezone,'Europe/Paris') into v_timezone from public.user_profiles where user_id=v_uid;

  for v_activity in
    select a.*
    from public.activities a
    where a.user_id=v_uid
      and a.started_at is not null
      and a.started_at >= current_date - interval '14 days'
      and not exists(select 1 from public.workout_matches m where m.activity_id=a.id and m.status in ('confirmed','suggested'))
    order by a.started_at
  loop
    select p.*,
           private.sport_match_score(p.sport,v_activity.sport_type) as sport_score,
           abs(p.scheduled_date - ((v_activity.started_at at time zone v_timezone)::date)) as date_diff
    into v_candidate
    from public.planned_workouts p
    where p.user_id=v_uid
      and p.status in ('planned','completed')
      and abs(p.scheduled_date - ((v_activity.started_at at time zone v_timezone)::date)) <= 1
      and private.sport_match_score(p.sport,v_activity.sport_type) > 0
      and not exists(select 1 from public.workout_matches m where m.planned_workout_id=p.id and m.status='confirmed')
    order by
      (case when p.scheduled_date=((v_activity.started_at at time zone v_timezone)::date) then 35 else 15 end)
      + private.sport_match_score(p.sport,v_activity.sport_type)
      + case
          when p.distance_m is not null and v_activity.distance_m is not null and p.distance_m>0 then
            case
              when abs(v_activity.distance_m-p.distance_m)/p.distance_m <= 0.05 then 30
              when abs(v_activity.distance_m-p.distance_m)/p.distance_m <= 0.15 then 24
              when abs(v_activity.distance_m-p.distance_m)/p.distance_m <= 0.30 then 15
              else 5 end
          when p.duration_s is not null and v_activity.duration_s is not null and p.duration_s>0 then
            case
              when abs(v_activity.duration_s-p.duration_s)::numeric/p.duration_s <= 0.08 then 30
              when abs(v_activity.duration_s-p.duration_s)::numeric/p.duration_s <= 0.20 then 24
              when abs(v_activity.duration_s-p.duration_s)::numeric/p.duration_s <= 0.35 then 15
              else 5 end
          else 10 end desc,
      p.scheduled_date
    limit 1;

    if not found then continue; end if;

    v_date_score := case when v_candidate.date_diff=0 then 35 else 15 end;
    v_metric_score := 10;
    v_deviation := null;
    if v_candidate.distance_m is not null and v_activity.distance_m is not null and v_candidate.distance_m>0 then
      v_deviation := abs(v_activity.distance_m-v_candidate.distance_m)/v_candidate.distance_m;
      v_metric_score := case when v_deviation<=0.05 then 30 when v_deviation<=0.15 then 24 when v_deviation<=0.30 then 15 else 5 end;
    elsif v_candidate.duration_s is not null and v_activity.duration_s is not null and v_candidate.duration_s>0 then
      v_deviation := abs(v_activity.duration_s-v_candidate.duration_s)::numeric/v_candidate.duration_s;
      v_metric_score := case when v_deviation<=0.08 then 30 when v_deviation<=0.20 then 24 when v_deviation<=0.35 then 15 else 5 end;
    end if;
    v_score := v_candidate.sport_score + v_date_score + v_metric_score;

    if v_score >= 55 then
      insert into public.workout_matches(user_id,planned_workout_id,activity_id,status,match_method,confidence,score_breakdown)
      values(
        v_uid,v_candidate.id,v_activity.id,
        case when v_score>=75 then 'confirmed' else 'suggested' end,
        'auto',least(1,v_score::numeric/100),
        jsonb_build_object('score',v_score,'sport',v_candidate.sport_score,'date',v_date_score,'metric',v_metric_score,'metric_deviation',v_deviation,'date_diff_days',v_candidate.date_diff)
      )
      on conflict do nothing;
      if found then
        v_created := v_created+1;
        if v_score>=75 then
          v_confirmed := v_confirmed+1;
          update public.planned_workouts set status='completed',updated_at=now() where id=v_candidate.id and user_id=v_uid;
        else
          v_suggested := v_suggested+1;
        end if;
      end if;
    end if;
  end loop;

  return jsonb_build_object('created',v_created,'confirmed',v_confirmed,'suggested',v_suggested);
end;
$$;

create or replace function public.refresh_workout_matches()
returns jsonb
language sql
set search_path = public, private, pg_temp
as $$ select private.refresh_workout_matches(); $$;

create or replace function private.confirm_workout_match(p_planned_workout_id uuid, p_activity_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_old record;
begin
  if v_uid is null then raise exception 'Non authentifié'; end if;
  if not exists(select 1 from public.planned_workouts where id=p_planned_workout_id and user_id=v_uid) then raise exception 'Séance prévue introuvable'; end if;
  if not exists(select 1 from public.activities where id=p_activity_id and user_id=v_uid) then raise exception 'Activité introuvable'; end if;

  for v_old in select planned_workout_id from public.workout_matches where user_id=v_uid and (planned_workout_id=p_planned_workout_id or activity_id=p_activity_id) loop
    update public.planned_workouts set status='planned',updated_at=now() where id=v_old.planned_workout_id and user_id=v_uid and id<>p_planned_workout_id;
  end loop;
  delete from public.workout_matches where user_id=v_uid and (planned_workout_id=p_planned_workout_id or activity_id=p_activity_id);

  insert into public.workout_matches(user_id,planned_workout_id,activity_id,status,match_method,confidence,score_breakdown)
  values(v_uid,p_planned_workout_id,p_activity_id,'confirmed','manual',1,jsonb_build_object('manual',true))
  returning id into v_id;
  update public.planned_workouts set status='completed',updated_at=now() where id=p_planned_workout_id and user_id=v_uid;
  return v_id;
end;
$$;

create or replace function public.confirm_workout_match(p_planned_workout_id uuid, p_activity_id uuid)
returns uuid
language sql
set search_path = public, private, pg_temp
as $$ select private.confirm_workout_match(p_planned_workout_id,p_activity_id); $$;

create or replace function private.remove_workout_match(p_activity_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_planned uuid;
begin
  if v_uid is null then raise exception 'Non authentifié'; end if;
  select planned_workout_id into v_planned from public.workout_matches where activity_id=p_activity_id and user_id=v_uid;
  if v_planned is null then return false; end if;
  delete from public.workout_matches where activity_id=p_activity_id and user_id=v_uid;
  update public.planned_workouts set status='planned',updated_at=now() where id=v_planned and user_id=v_uid;
  return true;
end;
$$;

create or replace function public.remove_workout_match(p_activity_id uuid)
returns boolean
language sql
set search_path = public, private, pg_temp
as $$ select private.remove_workout_match(p_activity_id); $$;

create or replace function private.analyze_workout_feedback(p_match_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.workout_matches%rowtype;
  v_plan public.planned_workouts%rowtype;
  v_activity public.activities%rowtype;
  v_feedback public.workout_feedback%rowtype;
  v_distance_delta numeric;
  v_duration_delta numeric;
  v_adherence integer := 100;
  v_outcome text := 'on_track';
  v_summary text;
  v_recommendations jsonb := '[]'::jsonb;
  v_id uuid;
begin
  if v_uid is null then raise exception 'Non authentifié'; end if;
  select * into v_match from public.workout_matches where id=p_match_id and user_id=v_uid and status='confirmed';
  if not found then raise exception 'Rapprochement confirmé introuvable'; end if;
  select * into v_plan from public.planned_workouts where id=v_match.planned_workout_id and user_id=v_uid;
  select * into v_activity from public.activities where id=v_match.activity_id and user_id=v_uid;
  select * into v_feedback from public.workout_feedback where match_id=v_match.id and user_id=v_uid;
  if not found then raise exception 'Feedback requis avant analyse'; end if;

  if v_plan.distance_m is not null and v_plan.distance_m>0 and v_activity.distance_m is not null then
    v_distance_delta := (v_activity.distance_m-v_plan.distance_m)/v_plan.distance_m;
    v_adherence := v_adherence - least(45,round(abs(v_distance_delta)*100)::int);
  end if;
  if v_plan.duration_s is not null and v_plan.duration_s>0 and v_activity.duration_s is not null then
    v_duration_delta := (v_activity.duration_s-v_plan.duration_s)::numeric/v_plan.duration_s;
    v_adherence := v_adherence - least(35,round(abs(v_duration_delta)*80)::int);
  end if;
  if not v_feedback.completed_as_planned then v_adherence := v_adherence - 20; end if;
  v_adherence := greatest(0,least(100,v_adherence));

  if v_adherence < 60 or not v_feedback.completed_as_planned then
    v_outcome := 'deviated';
  elsif v_feedback.perceived_effort >= 9 or v_feedback.feeling='very_hard' then
    v_outcome := 'harder_than_expected';
  elsif v_feedback.perceived_effort <= 3 and v_feedback.feeling in ('very_easy','easy') and v_adherence>=80 then
    v_outcome := 'easier_than_expected';
  else
    v_outcome := 'on_track';
  end if;

  v_summary := case v_outcome
    when 'on_track' then format('Séance globalement conforme au plan (%s/100). Effort perçu : %s/10.',v_adherence,v_feedback.perceived_effort)
    when 'easier_than_expected' then format('Séance bien réalisée et plus facile que prévu (%s/100). Effort perçu : %s/10.',v_adherence,v_feedback.perceived_effort)
    when 'harder_than_expected' then format('Séance conforme mais ressentie plus difficile que prévu (%s/100). Effort perçu : %s/10.',v_adherence,v_feedback.perceived_effort)
    else format('La séance s’écarte du plan (%s/100). Frog conserve cet écart pour le prochain bilan.',v_adherence)
  end;

  if v_feedback.pain_or_discomfort then
    v_recommendations := v_recommendations || jsonb_build_array('Un inconfort a été signalé : ce signal sera pris en compte dans le prochain bilan avant toute adaptation.');
  end if;
  if v_outcome='harder_than_expected' then
    v_recommendations := v_recommendations || jsonb_build_array('Surveiller la récupération et la perception d’effort lors des prochaines séances.');
  elsif v_outcome='easier_than_expected' then
    v_recommendations := v_recommendations || jsonb_build_array('Bonne maîtrise de la séance ; ne pas augmenter automatiquement la charge sur une seule observation.');
  elsif v_outcome='deviated' then
    v_recommendations := v_recommendations || jsonb_build_array('Comprendre la cause de l’écart avant de modifier les séances futures.');
  else
    v_recommendations := v_recommendations || jsonb_build_array('Continuer le plan tel quel jusqu’au prochain point d’adaptation.');
  end if;

  insert into public.workout_analyses(user_id,match_id,feedback_id,adherence_score,outcome,summary,metrics,recommendations,model_version,updated_at)
  values(
    v_uid,v_match.id,v_feedback.id,v_adherence,v_outcome,v_summary,
    jsonb_build_object(
      'planned_duration_s',v_plan.duration_s,'actual_duration_s',v_activity.duration_s,'duration_delta_pct',case when v_duration_delta is null then null else round(v_duration_delta*100,1) end,
      'planned_distance_m',v_plan.distance_m,'actual_distance_m',v_activity.distance_m,'distance_delta_pct',case when v_distance_delta is null then null else round(v_distance_delta*100,1) end,
      'actual_pace_seconds_per_km',v_activity.pace_seconds_per_km,'avg_hr',v_activity.avg_hr,'training_load',v_activity.training_load,
      'rpe',v_feedback.perceived_effort,'feeling',v_feedback.feeling,'pain_or_discomfort',v_feedback.pain_or_discomfort
    ),
    v_recommendations,'post-session-v1',now()
  )
  on conflict(match_id) do update set
    feedback_id=excluded.feedback_id,
    adherence_score=excluded.adherence_score,
    outcome=excluded.outcome,
    summary=excluded.summary,
    metrics=excluded.metrics,
    recommendations=excluded.recommendations,
    model_version=excluded.model_version,
    updated_at=now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.analyze_workout_feedback(p_match_id uuid)
returns uuid
language sql
set search_path = public, private, pg_temp
as $$ select private.analyze_workout_feedback(p_match_id); $$;

grant execute on function public.refresh_workout_matches() to authenticated;
grant execute on function public.confirm_workout_match(uuid,uuid) to authenticated;
grant execute on function public.remove_workout_match(uuid) to authenticated;
grant execute on function public.analyze_workout_feedback(uuid) to authenticated;
revoke all on function private.refresh_workout_matches() from public,anon,authenticated;
revoke all on function private.confirm_workout_match(uuid,uuid) from public,anon,authenticated;
revoke all on function private.remove_workout_match(uuid) from public,anon,authenticated;
revoke all on function private.analyze_workout_feedback(uuid) from public,anon,authenticated;