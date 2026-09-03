alter table public.goals
  add column if not exists accepted_assessment_id uuid references public.goal_feasibility_assessments(id) on delete set null,
  add column if not exists accepted_at timestamptz;

create or replace function public.invalidate_goal_acceptance()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.sport is distinct from new.sport
    or old.event_name is distinct from new.event_name
    or old.event_date is distinct from new.event_date
    or old.distance_m is distinct from new.distance_m
    or old.target_duration_s is distinct from new.target_duration_s
    or old.parent_goal_id is distinct from new.parent_goal_id then
    new.accepted_assessment_id := null;
    new.accepted_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists goals_invalidate_acceptance on public.goals;
create trigger goals_invalidate_acceptance
before update on public.goals
for each row execute function public.invalidate_goal_acceptance();

create or replace function public.accept_goal_assessment(p_goal_id uuid, p_assessment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_verdict text;
begin
  if v_uid is null then raise exception 'Non authentifié'; end if;

  select a.verdict into v_verdict
  from public.goal_feasibility_assessments a
  join public.goals g on g.id = a.goal_id
  where a.id = p_assessment_id
    and a.goal_id = p_goal_id
    and a.user_id = v_uid
    and g.user_id = v_uid
    and g.status = 'active';

  if not found then raise exception 'Évaluation introuvable'; end if;
  if v_verdict not in ('feasible','challenging') then
    raise exception 'Cette évaluation ne peut pas être validée';
  end if;

  update public.goals
  set accepted_assessment_id = p_assessment_id,
      accepted_at = now()
  where id = p_goal_id and user_id = v_uid;
end;
$$;

revoke all on function public.accept_goal_assessment(uuid, uuid) from public;
grant execute on function public.accept_goal_assessment(uuid, uuid) to authenticated;
