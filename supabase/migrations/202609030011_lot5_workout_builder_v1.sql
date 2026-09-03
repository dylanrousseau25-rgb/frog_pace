alter table public.planned_workouts
  add column if not exists workout_schema_version text not null default 'frog-workout-v1',
  add column if not exists device_export_ready boolean not null default false;

create or replace function private.enrich_training_plan_workouts(p_plan_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  r record;
  v_steps jsonb;
  v_duration integer;
  v_rounds integer;
  v_export_ready boolean;
begin
  if v_uid is null then raise exception 'Non authentifié'; end if;
  if not exists(select 1 from public.training_plans where id=p_plan_id and user_id=v_uid) then
    raise exception 'Plan introuvable';
  end if;

  for r in
    select * from public.planned_workouts where plan_id=p_plan_id and user_id=v_uid order by scheduled_date, sort_order
  loop
    v_steps := r.structured_steps;
    v_duration := r.duration_s;
    v_export_ready := false;

    if r.workout_type in ('quality','intervals','sharpening') then
      select coalesce(sum(
        case
          when elem->>'kind' in ('warmup','cooldown','steady') then coalesce((elem->>'duration_s')::int,0)
          when elem->>'kind'='repeat' then coalesce((elem->>'repetitions')::int,1) * (coalesce((elem->>'work_duration_s')::int,0) + coalesce((elem->>'recovery_duration_s')::int,0))
          else 0
        end
      ), r.duration_s)
      into v_duration
      from jsonb_array_elements(r.structured_steps) elem;
      v_export_ready := r.sport in ('running','trail','road_cycling','gravel');

    elsif r.workout_type='easy' and r.duration_s is not null then
      if r.duration_s >= 1800 then
        v_steps := jsonb_build_array(
          jsonb_build_object('kind','warmup','duration_s',300,'intensity','easy','label','Mise en route'),
          jsonb_build_object('kind','steady','duration_s',greatest(300,r.duration_s-600),'intensity','easy','label','Endurance facile'),
          jsonb_build_object('kind','cooldown','duration_s',300,'intensity','easy','label','Retour au calme')
        );
      end if;
      v_export_ready := r.sport in ('running','trail','road_cycling','gravel');

    elsif r.workout_type='cross_training' and r.duration_s is not null then
      v_steps := jsonb_build_array(
        jsonb_build_object('kind','warmup','duration_s',600,'intensity','easy','label','Échauffement souple'),
        jsonb_build_object('kind','steady','duration_s',greatest(600,r.duration_s-1200),'intensity','easy','label','Endurance aérobie'),
        jsonb_build_object('kind','cooldown','duration_s',600,'intensity','easy','label','Retour au calme')
      );
      v_export_ready := r.sport in ('road_cycling','gravel','running','trail');

    elsif r.workout_type='long' then
      v_export_ready := r.sport in ('running','trail','road_cycling','gravel');
      if r.distance_m is not null then
        v_steps := jsonb_build_array(
          jsonb_build_object('kind','steady','distance_m',r.distance_m,'intensity','easy','label','Sortie longue facile'),
          jsonb_build_object('kind','guidance','label','Repère d’allure','target_pace_seconds_per_km',(
            select nullif(elem->>'target_pace_seconds_per_km','')::numeric
            from jsonb_array_elements(r.structured_steps) elem
            where elem->>'kind'='guidance' limit 1
          ))
        );
      end if;

    elsif r.workout_type='strength' then
      v_rounds := case when coalesce(r.duration_s,1800) <= 1200 then 2 else 3 end;
      v_steps := jsonb_build_array(
        jsonb_build_object('kind','activation','duration_s',180,'label','Activation','instructions','Marche dynamique, rotations de hanches et chevilles.'),
        jsonb_build_object('kind','circuit','rounds',v_rounds,'label','Circuit principal','rest_between_exercises_s',30,'rest_between_rounds_s',60,'exercises',jsonb_build_array(
          jsonb_build_object('exercise','chair_squat','name','Squat vers une chaise','reps',10,'media_key','chair-squat','cue','Hanches en arrière, genoux dans l’axe, remonte sans élan.'),
          jsonb_build_object('exercise','reverse_lunge','name','Fente arrière alternée','reps_each_side',8,'media_key','reverse-lunge','cue','Petit pas arrière, buste haut, pousse dans le pied avant.'),
          jsonb_build_object('exercise','calf_raise','name','Montées sur pointes','reps',15,'media_key','calf-raise','cue','Monte lentement, marque une seconde en haut, redescends contrôlé.'),
          jsonb_build_object('exercise','dead_bug','name','Dead bug','reps_each_side',8,'media_key','dead-bug','cue','Bas du dos stable, souffle en allongeant bras et jambe opposée.'),
          jsonb_build_object('exercise','side_plank','name','Gainage latéral','duration_s_each_side',25,'media_key','side-plank','cue','Corps aligné, bassin haut, respiration régulière.')
        )),
        jsonb_build_object('kind','mobility','duration_s',180,'label','Mobilité finale','instructions','Chevilles, mollets et hanches sans forcer l’amplitude.')
      );
      v_export_ready := false;

    elsif r.workout_type='mobility' then
      v_steps := jsonb_build_array(
        jsonb_build_object('kind','exercise','exercise','ankle_rocks','name','Mobilité cheville','duration_s_each_side',45,'media_key','ankle-rocks','cue','Genou avance au-dessus du pied sans décoller le talon.'),
        jsonb_build_object('kind','exercise','exercise','calf_mobility','name','Mollet dynamique','duration_s_each_side',45,'media_key','calf-mobility','cue','Alterne flexion et relâchement, sans douleur.'),
        jsonb_build_object('kind','exercise','exercise','hip_flexor','name','Ouverture de hanche','duration_s_each_side',45,'media_key','hip-flexor','cue','Bassin légèrement rétroversé, amplitude douce.'),
        jsonb_build_object('kind','exercise','exercise','thoracic_rotation','name','Rotation thoracique','reps_each_side',8,'media_key','thoracic-rotation','cue','Tourne le haut du dos, bassin stable.'),
        jsonb_build_object('kind','exercise','exercise','breathing','name','Respiration relâchée','duration_s',120,'media_key','breathing','cue','Inspire calmement, expire plus longuement que tu n’inspires.')
      );
      v_export_ready := false;

    elsif r.workout_type='race' then
      v_export_ready := false;
    end if;

    update public.planned_workouts
    set structured_steps=v_steps,
        duration_s=v_duration,
        workout_schema_version='frog-workout-v1',
        device_export_ready=v_export_ready,
        updated_at=now()
    where id=r.id;
  end loop;

  return p_plan_id;
end;
$$;

revoke all on function private.enrich_training_plan_workouts(uuid) from public, anon;
grant execute on function private.enrich_training_plan_workouts(uuid) to authenticated, service_role;

create or replace function public.generate_training_plan(p_force boolean default false)
returns uuid
language sql
security invoker
set search_path = public, private, pg_temp
as $$
  select private.enrich_training_plan_workouts(
    private.finalize_training_plan(
      private.generate_training_plan(p_force)
    )
  );
$$;

revoke all on function public.generate_training_plan(boolean) from public, anon;
grant execute on function public.generate_training_plan(boolean) to authenticated, service_role;

-- Existing active plans are upgraded in-place by the production migration.
