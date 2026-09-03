create table if not exists public.weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.training_plans(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  decision text not null check (decision in ('maintain','reduce','recovery')),
  readiness_score integer not null check (readiness_score between 0 and 100),
  confidence numeric not null check (confidence between 0 and 1),
  signals jsonb not null default '{}'::jsonb,
  summary text not null,
  recommendation text not null,
  model_version text not null default 'weekly-adaptation-v1',
  status text not null default 'no_change' check (status in ('no_change','proposed','applied')),
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(plan_id, week_start)
);

create table if not exists public.plan_adaptations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  review_id uuid not null references public.weekly_reviews(id) on delete cascade,
  planned_workout_id uuid not null references public.planned_workouts(id) on delete cascade,
  action text not null check (action in ('reduce','recovery')),
  reduction_pct numeric,
  reason text not null,
  before_state jsonb not null,
  after_state jsonb not null,
  status text not null default 'proposed' check (status in ('proposed','applied','skipped')),
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  unique(review_id, planned_workout_id)
);

create index if not exists weekly_reviews_user_week_idx on public.weekly_reviews(user_id, week_start desc);
create index if not exists weekly_reviews_plan_idx on public.weekly_reviews(plan_id, week_start desc);
create index if not exists plan_adaptations_review_idx on public.plan_adaptations(review_id, status);
create index if not exists plan_adaptations_workout_idx on public.plan_adaptations(planned_workout_id);

alter table public.weekly_reviews enable row level security;
alter table public.plan_adaptations enable row level security;

revoke all on public.weekly_reviews from anon, authenticated;
revoke all on public.plan_adaptations from anon, authenticated;
grant select on public.weekly_reviews to authenticated;
grant select on public.plan_adaptations to authenticated;

create policy weekly_reviews_select_own on public.weekly_reviews
for select to authenticated using (user_id = (select auth.uid()));

create policy plan_adaptations_select_own on public.plan_adaptations
for select to authenticated using (user_id = (select auth.uid()));

create or replace function private.lot8_quality_reduce_steps(p_steps jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_result jsonb := '[]'::jsonb;
  v_step jsonb;
  v_kind text;
  v_reps integer;
begin
  if jsonb_typeof(p_steps) <> 'array' then return coalesce(p_steps, '[]'::jsonb); end if;
  for v_step in select value from jsonb_array_elements(p_steps)
  loop
    v_kind := coalesce(v_step->>'kind','');
    if v_kind = 'repeat' then
      v_reps := greatest(2, coalesce((v_step->>'repetitions')::integer, 1) - 1);
      v_step := jsonb_set(v_step, '{repetitions}', to_jsonb(v_reps), true);
    end if;
    v_result := v_result || jsonb_build_array(v_step);
  end loop;
  return v_result;
end;
$$;

create or replace function private.lot8_steps_duration(p_steps jsonb)
returns integer
language plpgsql
immutable
as $$
declare
  v_total integer := 0;
  v_step jsonb;
  v_kind text;
  v_reps integer;
  v_work integer;
  v_recovery integer;
begin
  if jsonb_typeof(p_steps) <> 'array' then return 0; end if;
  for v_step in select value from jsonb_array_elements(p_steps)
  loop
    v_kind := coalesce(v_step->>'kind','');
    if v_kind = 'repeat' then
      v_reps := greatest(1, coalesce((v_step->>'repetitions')::integer,1));
      v_work := greatest(0, coalesce((v_step->>'work_duration_s')::integer,0));
      v_recovery := greatest(0, coalesce((v_step->>'recovery_duration_s')::integer,0));
      v_total := v_total + v_reps * (v_work + v_recovery);
    else
      v_total := v_total + greatest(0, coalesce((v_step->>'duration_s')::integer,0));
    end if;
  end loop;
  return v_total;
end;
$$;

create or replace function private.generate_weekly_review()
returns jsonb
language plpgsql
security definer
set search_path = public, private, auth, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_plan public.training_plans%rowtype;
  v_existing public.weekly_reviews%rowtype;
  v_review_id uuid;
  v_week_start date := date_trunc('week', current_date)::date;
  v_week_end date := (date_trunc('week', current_date)::date + 6);
  v_lookback date := current_date - 6;
  v_recovery numeric;
  v_load_ratio numeric;
  v_hrv_eval text;
  v_planned_due integer := 0;
  v_confirmed integer := 0;
  v_feedback_count integer := 0;
  v_avg_rpe numeric;
  v_discomfort integer := 0;
  v_harder integer := 0;
  v_deviated integer := 0;
  v_avg_adherence numeric;
  v_risk integer := 0;
  v_decision text := 'maintain';
  v_readiness integer := 100;
  v_confidence numeric := 0.45;
  v_completion numeric;
  v_summary text;
  v_recommendation text;
  v_signals jsonb;
  v_memory jsonb := '[]'::jsonb;
  v_workout record;
  v_after jsonb;
  v_before jsonb;
  v_steps jsonb;
  v_duration integer;
  v_created integer := 0;
begin
  if v_user is null then raise exception 'Session utilisateur requise'; end if;

  select * into v_plan from public.training_plans
  where user_id = v_user and status = 'active'
  order by created_at desc limit 1;
  if v_plan.id is null then raise exception 'Aucun plan actif'; end if;

  select * into v_existing from public.weekly_reviews
  where plan_id = v_plan.id and week_start = v_week_start;

  if v_existing.id is not null and v_existing.status = 'applied' then
    return jsonb_build_object('reviewId', v_existing.id, 'decision', v_existing.decision, 'status', v_existing.status, 'locked', true);
  end if;

  select recovery, load_ratio, nullif(hrv->>'evaluation','') into v_recovery, v_load_ratio, v_hrv_eval
  from public.fitness_snapshots where user_id = v_user order by captured_at desc limit 1;

  select count(*) into v_planned_due from public.planned_workouts
  where user_id = v_user and plan_id = v_plan.id and scheduled_date between v_lookback and current_date
    and workout_type not in ('race','secondary_goal_event');

  select count(*) into v_confirmed
  from public.workout_matches m join public.planned_workouts w on w.id = m.planned_workout_id
  where m.user_id = v_user and m.status = 'confirmed' and w.plan_id = v_plan.id
    and w.scheduled_date between v_lookback and current_date;

  select count(*), avg(perceived_effort), count(*) filter (where pain_or_discomfort)
    into v_feedback_count, v_avg_rpe, v_discomfort
  from public.workout_feedback where user_id = v_user and submitted_at::date between v_lookback and current_date;

  select count(*) filter (where outcome = 'harder_than_expected'),
         count(*) filter (where outcome = 'deviated'), avg(adherence_score)
    into v_harder, v_deviated, v_avg_adherence
  from public.workout_analyses where user_id = v_user and created_at::date between v_lookback and current_date;

  select coalesce(jsonb_agg(jsonb_build_object('category',category,'content',content,'confidence',confidence) order by updated_at desc),'[]'::jsonb)
    into v_memory
  from (
    select category, content, confidence, updated_at from public.coach_memories
    where user_id = v_user and status = 'active' and sensitive = false
      and category in ('training_response','constraint','schedule','habit','equipment')
    order by updated_at desc limit 8
  ) m;

  if v_planned_due > 0 then v_completion := v_confirmed::numeric / v_planned_due; end if;

  if v_recovery is not null then
    v_confidence := v_confidence + 0.10;
    if v_recovery < 40 then v_risk := v_risk + 3;
    elsif v_recovery < 60 then v_risk := v_risk + 2;
    elsif v_recovery < 75 then v_risk := v_risk + 1; end if;
  end if;

  if v_load_ratio is not null then
    v_confidence := v_confidence + 0.05;
    if v_load_ratio > 1.60 then v_risk := v_risk + 3;
    elsif v_load_ratio > 1.35 then v_risk := v_risk + 2;
    elsif v_load_ratio > 1.15 then v_risk := v_risk + 1; end if;
  end if;

  if v_feedback_count > 0 then
    v_confidence := v_confidence + least(0.25, v_feedback_count * 0.06);
    if v_avg_rpe >= 8 then v_risk := v_risk + 2;
    elsif v_avg_rpe >= 7 then v_risk := v_risk + 1; end if;
  end if;

  if v_harder >= 2 then v_risk := v_risk + 2;
  elsif v_harder = 1 then v_risk := v_risk + 1; end if;
  if v_deviated >= 2 then v_risk := v_risk + 1; end if;
  if v_discomfort > 0 then v_risk := v_risk + 2; end if;
  if v_planned_due >= 2 and coalesce(v_completion,0) < 0.5 then v_risk := v_risk + 1; end if;
  if lower(coalesce(v_hrv_eval,'')) like '%below%' or lower(coalesce(v_hrv_eval,'')) like '%low%' then v_risk := v_risk + 1; end if;

  if v_risk >= 5 then v_decision := 'recovery';
  elsif v_risk >= 3 then v_decision := 'reduce';
  else v_decision := 'maintain'; end if;

  v_readiness := greatest(20, least(100, 100 - v_risk * 12));
  v_confidence := least(0.95, v_confidence);

  if v_decision = 'maintain' then
    v_summary := 'Les signaux disponibles ne justifient pas de modifier la charge prévue cette semaine.';
    v_recommendation := 'Maintenir le plan actuel et continuer à collecter les retours après chaque séance.';
  elsif v_decision = 'reduce' then
    v_summary := 'Plusieurs signaux suggèrent une charge à modérer sans interrompre la progression.';
    v_recommendation := 'Alléger au maximum deux séances futures, sans changer leurs dates.';
  else
    v_summary := 'Les signaux récents justifient une priorité temporaire à la récupération.';
    v_recommendation := 'Simplifier la prochaine séance exigeante et réduire la prochaine sortie longue, sans déplacer les séances.';
  end if;

  v_signals := jsonb_build_object(
    'windowStart', v_lookback, 'windowEnd', current_date, 'recovery', v_recovery,
    'loadRatio', v_load_ratio, 'hrvEvaluation', v_hrv_eval, 'plannedDue', v_planned_due,
    'confirmedCompleted', v_confirmed, 'completionRatio', v_completion, 'feedbackCount', v_feedback_count,
    'avgRpe', v_avg_rpe, 'discomfortSignals', v_discomfort, 'harderThanExpected', v_harder,
    'deviated', v_deviated, 'avgAdherence', v_avg_adherence, 'riskPoints', v_risk,
    'safeMemoryContext', v_memory
  );

  insert into public.weekly_reviews(user_id,plan_id,week_start,week_end,decision,readiness_score,confidence,signals,summary,recommendation,status,updated_at)
  values(v_user,v_plan.id,v_week_start,v_week_end,v_decision,v_readiness,v_confidence,v_signals,v_summary,v_recommendation,case when v_decision='maintain' then 'no_change' else 'proposed' end,now())
  on conflict(plan_id,week_start) do update set decision=excluded.decision,readiness_score=excluded.readiness_score,
    confidence=excluded.confidence,signals=excluded.signals,summary=excluded.summary,recommendation=excluded.recommendation,
    status=excluded.status,applied_at=null,updated_at=now()
  returning id into v_review_id;

  delete from public.plan_adaptations where review_id = v_review_id and status = 'proposed';

  if v_decision in ('reduce','recovery') then
    for v_workout in
      select * from public.planned_workouts
      where user_id = v_user and plan_id = v_plan.id and status = 'planned'
        and scheduled_date > current_date and scheduled_date <= current_date + 10
        and workout_type not in ('race','secondary_goal_event')
        and (workout_type in ('quality','sharpening','long') or (v_decision='recovery' and workout_type='strength'))
      order by scheduled_date
    loop
      exit when v_created >= 2;
      v_before := jsonb_build_object('sport',v_workout.sport,'workout_type',v_workout.workout_type,'title',v_workout.title,
        'description',v_workout.description,'duration_s',v_workout.duration_s,'distance_m',v_workout.distance_m,
        'intensity',v_workout.intensity,'structured_steps',v_workout.structured_steps,'device_export_ready',v_workout.device_export_ready);

      if v_decision = 'recovery' and v_workout.workout_type in ('quality','sharpening') then
        v_steps := jsonb_build_array(
          jsonb_build_object('kind','warmup','duration_s',600,'intensity','easy'),
          jsonb_build_object('kind','steady','duration_s',1200,'intensity','easy'),
          jsonb_build_object('kind','cooldown','duration_s',300,'intensity','easy'));
        v_after := jsonb_build_object('sport','running','workout_type','easy','title','Footing récupération adapté',
          'description','Séance simplifiée par Frog après le bilan hebdomadaire.','duration_s',2100,'distance_m',null,
          'intensity','easy','structured_steps',v_steps,'device_export_ready',true);
        insert into public.plan_adaptations(user_id,review_id,planned_workout_id,action,reduction_pct,reason,before_state,after_state)
        values(v_user,v_review_id,v_workout.id,'recovery',null,'Remplacer temporairement une séance exigeante par un footing facile.',v_before,v_after)
        on conflict(review_id,planned_workout_id) do update set after_state=excluded.after_state,reason=excluded.reason,status='proposed';
        v_created := v_created + 1;
      elsif v_workout.workout_type in ('quality','sharpening') then
        v_steps := private.lot8_quality_reduce_steps(v_workout.structured_steps);
        v_duration := private.lot8_steps_duration(v_steps);
        v_after := jsonb_build_object('sport',v_workout.sport,'workout_type',v_workout.workout_type,'title',v_workout.title,
          'description',v_workout.description,'duration_s',v_duration,'distance_m',v_workout.distance_m,'intensity',v_workout.intensity,
          'structured_steps',v_steps,'device_export_ready',v_workout.device_export_ready);
        insert into public.plan_adaptations(user_id,review_id,planned_workout_id,action,reduction_pct,reason,before_state,after_state)
        values(v_user,v_review_id,v_workout.id,'reduce',15,'Retirer une répétition du bloc principal pour modérer la charge.',v_before,v_after)
        on conflict(review_id,planned_workout_id) do update set after_state=excluded.after_state,reason=excluded.reason,status='proposed';
        v_created := v_created + 1;
      elsif v_workout.workout_type = 'long' then
        v_after := jsonb_build_object('sport',v_workout.sport,'workout_type',v_workout.workout_type,'title',v_workout.title,
          'description',v_workout.description,'duration_s',v_workout.duration_s,
          'distance_m',round(coalesce(v_workout.distance_m,0) * case when v_decision='recovery' then 0.80 else 0.90 end),
          'intensity',v_workout.intensity,'structured_steps',v_workout.structured_steps,'device_export_ready',v_workout.device_export_ready);
        insert into public.plan_adaptations(user_id,review_id,planned_workout_id,action,reduction_pct,reason,before_state,after_state)
        values(v_user,v_review_id,v_workout.id,case when v_decision='recovery' then 'recovery' else 'reduce' end,
          case when v_decision='recovery' then 20 else 10 end,'Réduire la distance de la prochaine sortie longue tout en conservant son jour.',v_before,v_after)
        on conflict(review_id,planned_workout_id) do update set after_state=excluded.after_state,reason=excluded.reason,status='proposed';
        v_created := v_created + 1;
      elsif v_decision='recovery' and v_workout.workout_type='strength' then
        v_steps := jsonb_build_array(jsonb_build_object('kind','mobility','duration_s',1200,'instructions','Mobilité douce et respiration, sans recherche de fatigue.'));
        v_after := jsonb_build_object('sport','mobility','workout_type','mobility','title','Mobilité récupération adaptée',
          'description','Renforcement remplacé temporairement par une séance de mobilité légère.','duration_s',1200,'distance_m',null,
          'intensity','recovery','structured_steps',v_steps,'device_export_ready',false);
        insert into public.plan_adaptations(user_id,review_id,planned_workout_id,action,reduction_pct,reason,before_state,after_state)
        values(v_user,v_review_id,v_workout.id,'recovery',null,'Remplacer le renforcement par de la mobilité légère.',v_before,v_after)
        on conflict(review_id,planned_workout_id) do update set after_state=excluded.after_state,reason=excluded.reason,status='proposed';
        v_created := v_created + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object('reviewId',v_review_id,'decision',v_decision,'status',case when v_decision='maintain' then 'no_change' else 'proposed' end,
    'readinessScore',v_readiness,'confidence',v_confidence,'adaptations',v_created);
end;
$$;

create or replace function public.generate_weekly_review()
returns jsonb language sql security invoker set search_path = public, private, auth, pg_temp
as $$ select private.generate_weekly_review(); $$;

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
      update public.plan_adaptations set status='applied',applied_at=now() where id=v_adapt.id;
      v_count := v_count + 1;
    else
      update public.plan_adaptations set status='skipped' where id=v_adapt.id;
    end if;
  end loop;

  update public.weekly_reviews set status='applied',applied_at=now(),updated_at=now() where id=v_review.id;
  return jsonb_build_object('reviewId',v_review.id,'applied',v_count,'alreadyApplied',false);
end;
$$;

create or replace function public.apply_weekly_adaptation(p_review_id uuid)
returns jsonb language sql security invoker set search_path = public, private, auth, pg_temp
as $$ select private.apply_weekly_adaptation(p_review_id); $$;

revoke all on function private.generate_weekly_review() from public;
revoke all on function private.apply_weekly_adaptation(uuid) from public;
revoke all on function public.generate_weekly_review() from public;
revoke all on function public.apply_weekly_adaptation(uuid) from public;
grant execute on function private.generate_weekly_review() to authenticated;
grant execute on function private.apply_weekly_adaptation(uuid) to authenticated;
grant execute on function public.generate_weekly_review() to authenticated;
grant execute on function public.apply_weekly_adaptation(uuid) to authenticated;
