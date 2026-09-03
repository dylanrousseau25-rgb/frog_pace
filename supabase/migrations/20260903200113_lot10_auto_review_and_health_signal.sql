alter table public.workout_feedback
  add column if not exists health_status text not null default 'normal';

alter table public.workout_feedback
  drop constraint if exists workout_feedback_health_status_check;

alter table public.workout_feedback
  add constraint workout_feedback_health_status_check
  check (health_status in ('normal','fatigued','ill'));

comment on column public.workout_feedback.health_status is
  'Athlete-declared general state, distinct from musculoskeletal pain/discomfort.';

do $migration$
declare
  v_def text;
  v_before text;
begin
  select pg_get_functiondef('private.analyze_workout_feedback(uuid)'::regprocedure) into v_def;
  v_before := v_def;

  v_def := replace(v_def,
$needle$
  if v_feedback.pain_or_discomfort then
    v_recommendations := v_recommendations || jsonb_build_array('Un inconfort a été signalé : ce signal sera pris en compte dans le prochain bilan avant toute adaptation.');
  end if;
$needle$,
$replacement$
  if v_feedback.pain_or_discomfort then
    v_recommendations := v_recommendations || jsonb_build_array('Un inconfort a été signalé : ce signal sera pris en compte dans le prochain bilan avant toute adaptation.');
  end if;
  if v_feedback.health_status = 'ill' then
    v_recommendations := v_recommendations || jsonb_build_array('Tu as indiqué être malade : Frog transmet ce signal au bilan d’adaptation sans le confondre avec une douleur musculosquelettique.');
  elsif v_feedback.health_status = 'fatigued' then
    v_recommendations := v_recommendations || jsonb_build_array('Tu as indiqué une fatigue générale inhabituelle : Frog la suivra dans le prochain bilan.');
  end if;
$replacement$);

  v_def := replace(v_def,
$needle$'rpe',v_feedback.perceived_effort,'feeling',v_feedback.feeling,'pain_or_discomfort',v_feedback.pain_or_discomfort$needle$,
$replacement$'rpe',v_feedback.perceived_effort,'feeling',v_feedback.feeling,'pain_or_discomfort',v_feedback.pain_or_discomfort,'health_status',v_feedback.health_status$replacement$);

  if v_def = v_before then
    raise exception 'Could not patch private.analyze_workout_feedback';
  end if;
  execute v_def;
end
$migration$;

do $migration$
declare
  v_def text;
  v_original text;
begin
  select pg_get_functiondef('private.generate_weekly_review()'::regprocedure) into v_def;
  v_original := v_def;

  v_def := replace(v_def,
$needle$  v_discomfort integer := 0;$needle$,
$replacement$  v_discomfort integer := 0;
  v_health_fatigued integer := 0;
  v_health_ill integer := 0;$replacement$);

  v_def := replace(v_def,
$needle$
  select count(*), avg(perceived_effort), count(*) filter (where pain_or_discomfort)
    into v_feedback_count, v_avg_rpe, v_discomfort
  from public.workout_feedback
  where user_id = v_user and submitted_at::date between v_lookback and current_date;
$needle$,
$replacement$
  select count(*), avg(perceived_effort), count(*) filter (where pain_or_discomfort),
         count(*) filter (where health_status = 'fatigued'),
         count(*) filter (where health_status = 'ill')
    into v_feedback_count, v_avg_rpe, v_discomfort, v_health_fatigued, v_health_ill
  from public.workout_feedback
  where user_id = v_user and submitted_at::date between v_lookback and current_date;
$replacement$);

  v_def := replace(v_def,
$needle$  if v_discomfort > 0 then v_risk := v_risk + 2; end if;$needle$,
$replacement$  if v_discomfort > 0 then v_risk := v_risk + 2; end if;
  if v_health_ill > 0 then
    v_risk := v_risk + 3;
    v_confidence := least(0.95, v_confidence + 0.05);
  elsif v_health_fatigued > 0 then
    v_risk := v_risk + 1;
    v_confidence := least(0.95, v_confidence + 0.03);
  end if;$replacement$);

  v_def := replace(v_def,
$needle$    'discomfortSignals', v_discomfort,
    'harderThanExpected', v_harder,$needle$,
$replacement$    'discomfortSignals', v_discomfort,
    'generalFatigueSignals', v_health_fatigued,
    'illnessSignals', v_health_ill,
    'harderThanExpected', v_harder,$replacement$);

  if v_def = v_original then
    raise exception 'Could not patch private.generate_weekly_review';
  end if;
  execute v_def;
end
$migration$;

create or replace function private.auto_refresh_weekly_review_after_analysis()
returns trigger
language plpgsql
security definer
set search_path = public, private, auth, pg_temp
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if exists (
    select 1 from public.training_plans
    where user_id = auth.uid() and status = 'active'
  ) then
    begin
      perform private.generate_weekly_review();
    exception when others then
      null;
    end;
  end if;
  return new;
end;
$$;

revoke all on function private.auto_refresh_weekly_review_after_analysis() from public, anon, authenticated;
grant execute on function private.auto_refresh_weekly_review_after_analysis() to service_role;

drop trigger if exists workout_analyses_auto_weekly_review on public.workout_analyses;
create trigger workout_analyses_auto_weekly_review
after insert or update of adherence_score, outcome, metrics, recommendations
on public.workout_analyses
for each row execute function private.auto_refresh_weekly_review_after_analysis();
