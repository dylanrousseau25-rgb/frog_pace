create table if not exists public.workout_exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  planned_workout_id uuid not null references public.planned_workouts(id) on delete cascade,
  provider text not null default 'coros' check (provider in ('coros')),
  status text not null default 'ready' check (status in ('ready','blocked','pending','exported','failed')),
  payload jsonb not null default '{}'::jsonb,
  provider_tool text,
  provider_reference text,
  provider_response jsonb not null default '{}'::jsonb,
  blocker_code text,
  blocker_message text,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  exported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(planned_workout_id, provider)
);

create index if not exists workout_exports_user_status_idx
  on public.workout_exports(user_id, status, created_at desc);
create index if not exists workout_exports_workout_idx
  on public.workout_exports(planned_workout_id);

alter table public.workout_exports enable row level security;

drop policy if exists workout_exports_select_own on public.workout_exports;
create policy workout_exports_select_own
  on public.workout_exports
  for select
  to authenticated
  using (auth.uid() = user_id);

revoke insert, update, delete on public.workout_exports from anon, authenticated;
grant select on public.workout_exports to authenticated;
grant all on public.workout_exports to service_role;
