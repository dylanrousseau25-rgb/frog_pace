create or replace function public.validate_goal_integrity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_parent_ok boolean;
  v_assessment_ok boolean;
begin
  if new.goal_type = 'primary' then
    new.parent_goal_id := null;
  else
    if new.parent_goal_id is null then
      raise exception 'Un objectif intermédiaire doit être lié à un objectif principal';
    end if;

    select exists(
      select 1
      from public.goals g
      where g.id = new.parent_goal_id
        and g.user_id = new.user_id
        and g.goal_type = 'primary'
        and g.status = 'active'
    ) into v_parent_ok;

    if not v_parent_ok then
      raise exception 'Objectif principal parent invalide';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if old.sport is distinct from new.sport
      or old.event_name is distinct from new.event_name
      or old.event_date is distinct from new.event_date
      or old.distance_m is distinct from new.distance_m
      or old.target_duration_s is distinct from new.target_duration_s
      or old.parent_goal_id is distinct from new.parent_goal_id then
      new.accepted_assessment_id := null;
      new.accepted_at := null;
    elsif new.accepted_assessment_id is distinct from old.accepted_assessment_id then
      if new.accepted_assessment_id is null then
        new.accepted_at := null;
      else
        select exists(
          select 1
          from public.goal_feasibility_assessments a
          where a.id = new.accepted_assessment_id
            and a.goal_id = new.id
            and a.user_id = new.user_id
            and a.verdict in ('feasible','challenging')
        ) into v_assessment_ok;

        if not v_assessment_ok then
          raise exception 'Évaluation de référence invalide';
        end if;
        new.accepted_at := now();
      end if;
    end if;
  elsif new.accepted_assessment_id is not null then
    select exists(
      select 1
      from public.goal_feasibility_assessments a
      where a.id = new.accepted_assessment_id
        and a.goal_id = new.id
        and a.user_id = new.user_id
        and a.verdict in ('feasible','challenging')
    ) into v_assessment_ok;

    if not v_assessment_ok then
      raise exception 'Évaluation de référence invalide';
    end if;
    new.accepted_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists goals_invalidate_acceptance on public.goals;
drop trigger if exists goals_validate_integrity on public.goals;
create trigger goals_validate_integrity
before insert or update on public.goals
for each row execute function public.validate_goal_integrity();
