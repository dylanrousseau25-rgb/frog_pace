create or replace function private.refresh_weekly_review_for_user(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, auth, pg_temp
as $$
begin
  if p_user is null then return '{}'::jsonb; end if;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  return private.generate_weekly_review();
exception when others then
  return jsonb_build_object('error', sqlerrm);
end;
$$;

revoke all on function private.refresh_weekly_review_for_user(uuid) from public, anon, authenticated;
grant execute on function private.refresh_weekly_review_for_user(uuid) to service_role;

create or replace function private.auto_refresh_weekly_review_after_analysis()
returns trigger
language plpgsql
security definer
set search_path = public, private, auth, pg_temp
as $$
begin
  perform private.refresh_weekly_review_for_user(new.user_id);
  return new;
end;
$$;

create or replace function private.auto_refresh_weekly_review_after_feedback()
returns trigger
language plpgsql
security definer
set search_path = public, private, auth, pg_temp
as $$
begin
  perform private.refresh_weekly_review_for_user(new.user_id);
  return new;
end;
$$;

revoke all on function private.auto_refresh_weekly_review_after_feedback() from public, anon, authenticated;
grant execute on function private.auto_refresh_weekly_review_after_feedback() to service_role;

drop trigger if exists workout_feedback_auto_weekly_review on public.workout_feedback;
create trigger workout_feedback_auto_weekly_review
after insert or update of perceived_effort, feeling, completed_as_planned, pain_or_discomfort, health_status
on public.workout_feedback
for each row execute function private.auto_refresh_weekly_review_after_feedback();
