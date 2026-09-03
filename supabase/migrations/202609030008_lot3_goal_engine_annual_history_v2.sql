create or replace function private.assess_goal_feasibility(p_goal_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_goal public.goals%rowtype;
  v_sport_types integer[];
  v_days_to_goal integer;
  v_activities_12w integer := 0;
  v_activities_4w integer := 0;
  v_activities_365d integer := 0;
  v_active_weeks_365d integer := 0;
  v_goal_like_365d integer := 0;
  v_longest_m numeric := 0;
  v_longest_365d_m numeric := 0;
  v_distance_4w_m numeric := 0;
  v_distance_365d_m numeric := 0;
  v_max_weekly_distance_365d_m numeric := 0;
  v_frequency_week numeric := 0;
  v_frequency_week_365d numeric := 0;
  v_weekly_distance_m numeric := 0;
  v_distance_ratio numeric := 0;
  v_historical_distance_ratio numeric := 0;
  v_volume_ratio numeric := 0;
  v_score integer := 100;
  v_confidence integer := 35;
  v_verdict text;
  v_summary text;
  v_reasons jsonb := '[]'::jsonb;
  v_metrics jsonb;
  v_assessment_id uuid;
  v_threshold_text text;
  v_threshold_match text[];
  v_threshold_pace_s numeric;
  v_target_pace_s numeric;
  v_latest_snapshot timestamptz;
  v_parent_date date;
begin
  if v_uid is null then raise exception 'Non authentifié'; end if;

  select * into v_goal from public.goals where id = p_goal_id and user_id = v_uid;
  if not found then raise exception 'Objectif introuvable'; end if;

  v_sport_types := case v_goal.sport
    when 'running' then array[100,101,102,103,104]
    when 'trail' then array[102,104,105,100,103]
    when 'road_cycling' then array[200,201,202,203,204,205]
    when 'gravel' then array[203,200,201,204,205]
    else array[]::integer[]
  end;

  v_days_to_goal := v_goal.event_date - current_date;

  select
    count(*) filter (where started_at >= now() - interval '84 days'),
    count(*) filter (where started_at >= now() - interval '28 days'),
    count(*),
    count(distinct date_trunc('week', started_at)),
    count(*) filter (where distance_m >= v_goal.distance_m * 0.80),
    coalesce(max(distance_m) filter (where started_at >= now() - interval '84 days'), 0),
    coalesce(max(distance_m), 0),
    coalesce(sum(distance_m) filter (where started_at >= now() - interval '28 days'), 0),
    coalesce(sum(distance_m), 0)
  into
    v_activities_12w, v_activities_4w, v_activities_365d, v_active_weeks_365d,
    v_goal_like_365d, v_longest_m, v_longest_365d_m, v_distance_4w_m, v_distance_365d_m
  from public.activities
  where user_id = v_uid
    and provider = 'coros'
    and sport_type = any(v_sport_types)
    and started_at >= now() - interval '365 days';

  select coalesce(max(week_distance_m), 0)
  into v_max_weekly_distance_365d_m
  from (
    select date_trunc('week', started_at) as week_start, sum(coalesce(distance_m, 0)) as week_distance_m
    from public.activities
    where user_id = v_uid
      and provider = 'coros'
      and sport_type = any(v_sport_types)
      and started_at >= now() - interval '365 days'
    group by 1
  ) weekly;

  v_frequency_week := round((v_activities_12w::numeric / 12.0), 2);
  v_frequency_week_365d := round((v_activities_365d::numeric / 52.0), 2);
  v_weekly_distance_m := round(v_distance_4w_m / 4.0, 0);
  if v_goal.distance_m > 0 then
    v_distance_ratio := round(least(2.0, v_longest_m / v_goal.distance_m), 3);
    v_historical_distance_ratio := round(least(2.0, v_longest_365d_m / v_goal.distance_m), 3);
    v_volume_ratio := round(least(4.0, v_weekly_distance_m / v_goal.distance_m), 3);
  end if;

  select captured_at, threshold_pace into v_latest_snapshot, v_threshold_text
  from public.fitness_snapshots
  where user_id = v_uid and provider = 'coros'
  order by captured_at desc limit 1;

  if v_threshold_text is not null then
    v_threshold_match := regexp_match(v_threshold_text, '(\d+):(\d{2})');
    if v_threshold_match is not null then
      v_threshold_pace_s := v_threshold_match[1]::numeric * 60 + v_threshold_match[2]::numeric;
    end if;
  end if;

  if v_goal.target_duration_s is not null and v_goal.distance_m >= 1000 then
    v_target_pace_s := round(v_goal.target_duration_s / (v_goal.distance_m / 1000.0), 1);
  end if;

  if v_days_to_goal < 0 then
    v_score := 0;
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','warning','code','past_date','text','La date de l’objectif est déjà passée.'));
  elsif v_days_to_goal < 14 then
    v_score := v_score - 40;
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','warning','code','very_short_horizon','text','Moins de 2 semaines restent avant l’objectif.'));
  elsif v_days_to_goal < 28 then
    v_score := v_score - 25;
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','warning','code','short_horizon','text','Moins de 4 semaines restent avant l’objectif.'));
  elsif v_days_to_goal < 56 then
    v_score := v_score - 10;
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','info','code','moderate_horizon','text','Le délai est court mais laisse encore plusieurs semaines de préparation.'));
  else
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','positive','code','good_horizon','text','Le calendrier laisse une fenêtre de préparation exploitable.'));
  end if;

  if v_activities_12w = 0 then
    v_score := v_score - 40;
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','warning','code','no_recent_history','text','Aucune activité pertinente n’est disponible sur les 12 dernières semaines.'));
  elsif v_frequency_week < 1 then
    v_score := v_score - 25;
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','warning','code','low_frequency','text','La fréquence récente est inférieure à une séance pertinente par semaine.'));
  elsif v_frequency_week < 2 then
    v_score := v_score - 12;
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','info','code','moderate_frequency','text','La régularité récente est encore limitée pour préparer cet objectif.'));
  else
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','positive','code','regular_history','text','L’historique récent montre une pratique régulière.'));
  end if;

  if v_distance_ratio >= 0.80 then
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','positive','code','distance_ready','text','Une sortie récente couvre déjà une grande partie de la distance cible.'));
  elsif v_distance_ratio >= 0.60 then
    v_score := v_score - 5;
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','info','code','distance_close','text','La plus longue sortie récente se rapproche de la distance cible.'));
  elsif v_distance_ratio >= 0.40 then
    v_score := v_score - 15;
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','warning','code','distance_gap','text','Il reste un écart notable entre la plus longue sortie récente et la distance cible.'));
  else
    v_score := v_score - 30;
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','warning','code','large_distance_gap','text','La distance cible est très supérieure aux sorties récentes.'));
  end if;

  if v_volume_ratio >= 1.25 then
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','positive','code','volume_base','text','Le volume hebdomadaire récent fournit une base cohérente avec la distance cible.'));
  elsif v_volume_ratio >= 0.70 then
    v_score := v_score - 7;
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','info','code','volume_build','text','Le volume récent devra progresser progressivement.'));
  else
    v_score := v_score - 18;
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','warning','code','low_volume','text','Le volume récent est faible par rapport à la distance cible.'));
  end if;

  if v_activities_365d >= 10 then
    if v_active_weeks_365d >= 30 then
      v_score := v_score + 5;
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','positive','code','annual_consistency_strong','text','Sur un an, ton historique montre une pratique répartie sur de nombreuses semaines.'));
    elsif v_active_weeks_365d >= 16 then
      v_score := v_score + 3;
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','positive','code','annual_consistency','text','L’historique annuel apporte une base de régularité supplémentaire.'));
    elsif v_active_weeks_365d >= 8 then
      v_score := v_score + 1;
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','info','code','annual_history_present','text','Frog tient aussi compte des séances plus anciennes de l’année, avec un poids réduit.'));
    end if;

    if v_historical_distance_ratio >= 1.0 then
      v_score := v_score + 8;
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','positive','code','historical_distance_proven','text','Au cours des 12 derniers mois, tu as déjà couvert au moins la distance cible sur une séance pertinente.'));
    elsif v_historical_distance_ratio >= 0.80 then
      v_score := v_score + 5;
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','positive','code','historical_distance_close','text','Sur un an, une sortie a déjà approché fortement la distance cible.'));
    elsif v_historical_distance_ratio >= 0.60 then
      v_score := v_score + 2;
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','info','code','historical_distance_base','text','L’historique annuel montre déjà une base de distance utile pour cet objectif.'));
    end if;

    if v_goal_like_365d >= 3 then
      v_score := v_score + 3;
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','positive','code','repeated_long_distance_history','text','Plusieurs séances de l’année ont atteint au moins 80 % de la distance cible.'));
    elsif v_goal_like_365d >= 1 then
      v_score := v_score + 1;
    end if;
  end if;

  if v_goal.sport = 'running' and v_target_pace_s is not null and v_threshold_pace_s is not null then
    if v_goal.distance_m >= 15000 and v_target_pace_s < v_threshold_pace_s then
      v_score := v_score - 25;
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','warning','code','target_faster_than_threshold','text','Le rythme cible est plus rapide que l’allure seuil COROS actuelle sur une distance longue.'));
    elsif v_goal.distance_m >= 15000 and v_target_pace_s < v_threshold_pace_s * 1.05 then
      v_score := v_score - 10;
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','info','code','ambitious_target','text','Le chrono cible est ambitieux au regard de l’allure seuil actuelle.'));
    else
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','positive','code','target_pace_plausible','text','Le rythme cible reste cohérent avec l’allure seuil actuellement disponible.'));
    end if;
  elsif v_goal.sport = 'trail' and v_goal.target_duration_s is not null then
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','info','code','trail_time_context','text','Pour le trail, le chrono ne peut pas être jugé correctement sans profil de dénivelé et technicité du parcours.'));
  elsif v_goal.target_duration_s is not null and v_goal.sport in ('road_cycling','gravel') then
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','info','code','cycling_time_context','text','Le chrono vélo est conservé mais la V1 ne le pénalise pas sans puissance et profil de parcours comparables.'));
  end if;

  if v_goal.goal_type = 'secondary' and v_goal.parent_goal_id is not null then
    select event_date into v_parent_date from public.goals where id = v_goal.parent_goal_id and user_id = v_uid;
    if v_parent_date is not null and v_goal.event_date >= v_parent_date then
      v_score := v_score - 15;
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('tone','warning','code','secondary_after_primary','text','Cet objectif intermédiaire est placé le même jour ou après l’objectif principal.'));
    end if;
  end if;

  v_score := greatest(0, least(100, v_score));
  v_confidence := greatest(25, least(95, 35 + least(v_activities_12w, 20) * 3 + least(v_active_weeks_365d, 30) / 3));
  if v_latest_snapshot is null then v_confidence := greatest(25, v_confidence - 10); end if;

  if v_activities_12w < 3 then
    v_verdict := 'insufficient_data';
    v_summary := 'Frog dispose d’un historique annuel, mais manque encore de données récentes pour valider cet objectif avec confiance.';
  elsif v_score >= 75 then
    v_verdict := 'feasible';
    v_summary := 'L’objectif paraît compatible avec ta forme récente, le temps disponible et les capacités démontrées sur les 12 derniers mois.';
  elsif v_score >= 52 then
    v_verdict := 'challenging';
    v_summary := 'L’objectif est envisageable. Ton historique annuel apporte du contexte, mais plusieurs écarts récents devront encore être gérés.';
  else
    v_verdict := 'not_recommended';
    v_summary := 'Même en tenant compte de ton historique annuel, Frog ne recommande pas encore de construire un plan sur cet objectif dans les conditions actuelles.';
  end if;

  v_metrics := jsonb_build_object(
    'days_to_goal', v_days_to_goal,
    'activities_4w', v_activities_4w,
    'activities_12w', v_activities_12w,
    'activities_365d', v_activities_365d,
    'active_weeks_365d', v_active_weeks_365d,
    'frequency_per_week_12w', v_frequency_week,
    'frequency_per_week_365d', v_frequency_week_365d,
    'longest_recent_distance_m', round(v_longest_m, 0),
    'longest_365d_distance_m', round(v_longest_365d_m, 0),
    'weekly_distance_m_4w', v_weekly_distance_m,
    'distance_365d_m', round(v_distance_365d_m, 0),
    'max_weekly_distance_365d_m', round(v_max_weekly_distance_365d_m, 0),
    'goal_like_sessions_365d', v_goal_like_365d,
    'distance_readiness_ratio', v_distance_ratio,
    'historical_distance_readiness_ratio', v_historical_distance_ratio,
    'weekly_volume_to_goal_ratio', v_volume_ratio,
    'target_pace_seconds_per_km', v_target_pace_s,
    'threshold_pace_seconds_per_km', v_threshold_pace_s,
    'latest_fitness_snapshot_at', v_latest_snapshot
  );

  insert into public.goal_feasibility_assessments(
    goal_id, user_id, verdict, score, confidence, summary, reasons, metrics, model_version
  ) values (
    v_goal.id, v_uid, v_verdict, v_score, v_confidence, v_summary, v_reasons, v_metrics, 'goal-engine-v2-annual'
  ) returning id into v_assessment_id;

  return v_assessment_id;
end;
$$;
