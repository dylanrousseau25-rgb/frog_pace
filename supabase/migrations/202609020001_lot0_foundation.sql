create extension if not exists pgcrypto;
create schema if not exists private;

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text not null default 'Europe/Paris',
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.athlete_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  primary_sports text[] not null default '{}',
  experience_level text,
  weekly_sessions_target integer check (weekly_sessions_target between 1 and 14),
  long_session_day smallint check (long_session_day between 1 and 7),
  availability jsonb not null default '{}'::jsonb,
  injuries_and_vigilance jsonb not null default '[]'::jsonb,
  equipment jsonb not null default '{}'::jsonb,
  training_preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('coros','garmin','apple','suunto','polar','fitbit')),
  status text not null default 'disconnected' check (status in ('disconnected','connecting','connected','expired','error')),
  external_user_id text,
  scopes text[] not null default '{}',
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table private.provider_credentials (
  provider_connection_id uuid primary key references public.provider_connections(id) on delete cascade,
  access_token_encrypted text,
  refresh_token_encrypted text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  operation text not null,
  entity_type text,
  entity_id uuid,
  result text not null default 'ok',
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_user_created_idx on public.audit_events(user_id, created_at desc);
create index provider_connections_user_idx on public.provider_connections(user_id);

create trigger user_profiles_updated_at before update on public.user_profiles for each row execute function public.set_updated_at();
create trigger athlete_profiles_updated_at before update on public.athlete_profiles for each row execute function public.set_updated_at();
create trigger provider_connections_updated_at before update on public.provider_connections for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'name'))
  on conflict (user_id) do nothing;
  insert into public.athlete_profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;

create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.user_profiles enable row level security;
alter table public.athlete_profiles enable row level security;
alter table public.provider_connections enable row level security;
alter table public.audit_events enable row level security;

create policy user_profiles_select_own on public.user_profiles for select to authenticated using (auth.uid() = user_id);
create policy user_profiles_update_own on public.user_profiles for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy athlete_profiles_select_own on public.athlete_profiles for select to authenticated using (auth.uid() = user_id);
create policy athlete_profiles_insert_own on public.athlete_profiles for insert to authenticated with check (auth.uid() = user_id);
create policy athlete_profiles_update_own on public.athlete_profiles for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy provider_connections_select_own on public.provider_connections for select to authenticated using (auth.uid() = user_id);
create policy provider_connections_insert_own on public.provider_connections for insert to authenticated with check (auth.uid() = user_id);
create policy provider_connections_update_own on public.provider_connections for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy provider_connections_delete_own on public.provider_connections for delete to authenticated using (auth.uid() = user_id);
create policy audit_events_select_own on public.audit_events for select to authenticated using (auth.uid() = user_id);

grant select, update on public.user_profiles to authenticated;
grant select, insert, update on public.athlete_profiles to authenticated;
grant select, insert, update, delete on public.provider_connections to authenticated;
grant select on public.audit_events to authenticated;
revoke all on schema private from anon, authenticated;
revoke all on all tables in schema private from anon, authenticated;
