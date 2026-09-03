alter table public.provider_connections drop constraint if exists provider_connections_provider_check;
alter table public.provider_connections add constraint provider_connections_provider_check check (provider = any (array['coros','trainingpeaks','garmin','apple','suunto','polar','fitbit']::text[]));

alter table public.workout_exports drop constraint if exists workout_exports_provider_check;
alter table public.workout_exports add constraint workout_exports_provider_check check (provider = any (array['coros','trainingpeaks']::text[]));

create or replace function public.service_get_app_secret(p_key text)
returns text
language sql
security definer
set search_path = public, private, pg_temp
as $$
  select value from private.app_secrets where key = p_key limit 1;
$$;
revoke all on function public.service_get_app_secret(text) from public, anon, authenticated;
grant execute on function public.service_get_app_secret(text) to service_role;

insert into public.workout_exports (
  user_id, planned_workout_id, provider, status, payload, provider_tool,
  blocker_code, blocker_message, attempt_count
)
select
  pw.user_id,
  pw.id,
  'trainingpeaks',
  'blocked',
  '{}'::jsonb,
  '/v2/workouts/plan',
  'TRAININGPEAKS_PARTNER_ACCESS_REQUIRED',
  'Frog Pace est prêt pour TrainingPeaks, mais les identifiants API partenaire doivent encore être approuvés et configurés.',
  0
from public.planned_workouts pw
join public.training_plans tp on tp.id = pw.plan_id
where tp.status = 'active'
  and pw.status = 'planned'
  and pw.device_export_ready = true
  and pw.scheduled_date >= current_date
on conflict (planned_workout_id, provider) do nothing;

create index if not exists workout_exports_provider_status_idx
  on public.workout_exports(provider, status, user_id);
