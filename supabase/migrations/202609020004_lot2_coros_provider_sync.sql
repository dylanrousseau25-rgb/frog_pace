alter table public.provider_connections
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.provider_syncs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  sync_type text not null default 'manual',
  status text not null check (status in ('running','success','partial','error')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  imported_activities integer not null default 0,
  details jsonb not null default '{}'::jsonb,
  error_message text
);

create index if not exists provider_syncs_user_started_idx
  on public.provider_syncs(user_id, started_at desc);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  provider_activity_id text not null,
  sport text,
  sport_type integer,
  started_at timestamptz,
  ended_at timestamptz,
  distance_m numeric,
  duration_s integer,
  avg_hr integer,
  max_hr integer,
  pace_seconds_per_km numeric,
  avg_speed_kmh numeric,
  elevation_gain_m numeric,
  training_load numeric,
  training_effect jsonb not null default '{}'::jsonb,
  training_focus text,
  raw_provider_data jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, provider_activity_id)
);

create index if not exists activities_user_started_idx
  on public.activities(user_id, started_at desc);
create index if not exists activities_user_provider_idx
  on public.activities(user_id, provider);

create trigger activities_updated_at
before update on public.activities
for each row execute function public.set_updated_at();

create table if not exists public.fitness_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  captured_at timestamptz not null default now(),
  recovery numeric,
  sleep jsonb not null default '{}'::jsonb,
  hrv jsonb not null default '{}'::jsonb,
  resting_hr numeric,
  short_load numeric,
  long_load numeric,
  load_ratio numeric,
  vo2max numeric,
  threshold_pace text,
  threshold_hr numeric,
  race_predictions jsonb not null default '{}'::jsonb,
  raw_provider_data jsonb not null default '{}'::jsonb
);

create index if not exists fitness_snapshots_user_captured_idx
  on public.fitness_snapshots(user_id, captured_at desc);

create table if not exists public.provider_oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  state text not null unique,
  client_id text not null,
  code_verifier text not null,
  redirect_uri text not null,
  scopes text[] not null default '{}',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists provider_oauth_states_user_provider_idx
  on public.provider_oauth_states(user_id, provider);

create table if not exists private.app_secrets (
  key text primary key,
  value text not null,
  created_at timestamptz not null default now()
);

insert into private.app_secrets(key, value)
values ('provider_credentials_key', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

alter table private.provider_credentials
  add column if not exists client_id_encrypted text,
  add column if not exists scope text,
  add column if not exists token_type text;

create or replace function public.service_store_provider_credentials(
  p_connection_id uuid,
  p_client_id text,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_scope text default null,
  p_token_type text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  secret_key text;
begin
  select value into secret_key
  from private.app_secrets
  where key = 'provider_credentials_key';

  if secret_key is null then
    raise exception 'provider credential key missing';
  end if;

  insert into private.provider_credentials(
    provider_connection_id,
    access_token_encrypted,
    refresh_token_encrypted,
    client_id_encrypted,
    expires_at,
    scope,
    token_type,
    updated_at
  ) values (
    p_connection_id,
    case when p_access_token is null then null else encode(extensions.pgp_sym_encrypt(p_access_token, secret_key), 'base64') end,
    case when p_refresh_token is null then null else encode(extensions.pgp_sym_encrypt(p_refresh_token, secret_key), 'base64') end,
    case when p_client_id is null then null else encode(extensions.pgp_sym_encrypt(p_client_id, secret_key), 'base64') end,
    p_expires_at,
    p_scope,
    p_token_type,
    now()
  )
  on conflict (provider_connection_id) do update set
    access_token_encrypted = excluded.access_token_encrypted,
    refresh_token_encrypted = coalesce(excluded.refresh_token_encrypted, private.provider_credentials.refresh_token_encrypted),
    client_id_encrypted = coalesce(excluded.client_id_encrypted, private.provider_credentials.client_id_encrypted),
    expires_at = excluded.expires_at,
    scope = coalesce(excluded.scope, private.provider_credentials.scope),
    token_type = coalesce(excluded.token_type, private.provider_credentials.token_type),
    updated_at = now();
end;
$$;

create or replace function public.service_get_provider_credentials(p_connection_id uuid)
returns table(
  client_id text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  token_type text
)
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  secret_key text;
begin
  select value into secret_key
  from private.app_secrets
  where key = 'provider_credentials_key';

  return query
  select
    case when pc.client_id_encrypted is null then null else extensions.pgp_sym_decrypt(decode(pc.client_id_encrypted, 'base64'), secret_key) end,
    case when pc.access_token_encrypted is null then null else extensions.pgp_sym_decrypt(decode(pc.access_token_encrypted, 'base64'), secret_key) end,
    case when pc.refresh_token_encrypted is null then null else extensions.pgp_sym_decrypt(decode(pc.refresh_token_encrypted, 'base64'), secret_key) end,
    pc.expires_at,
    pc.scope,
    pc.token_type
  from private.provider_credentials pc
  where pc.provider_connection_id = p_connection_id;
end;
$$;

create or replace function public.service_delete_provider_credentials(p_connection_id uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  delete from private.provider_credentials
  where provider_connection_id = p_connection_id;
$$;

revoke all on private.app_secrets from public, anon, authenticated;
revoke all on private.provider_credentials from public, anon, authenticated;

revoke all on function public.service_store_provider_credentials(uuid,text,text,text,timestamptz,text,text) from public, anon, authenticated;
revoke all on function public.service_get_provider_credentials(uuid) from public, anon, authenticated;
revoke all on function public.service_delete_provider_credentials(uuid) from public, anon, authenticated;
grant execute on function public.service_store_provider_credentials(uuid,text,text,text,timestamptz,text,text) to service_role;
grant execute on function public.service_get_provider_credentials(uuid) to service_role;
grant execute on function public.service_delete_provider_credentials(uuid) to service_role;

alter table public.provider_syncs enable row level security;
alter table public.activities enable row level security;
alter table public.fitness_snapshots enable row level security;
alter table public.provider_oauth_states enable row level security;

drop policy if exists provider_connections_insert_own on public.provider_connections;
drop policy if exists provider_connections_update_own on public.provider_connections;
drop policy if exists provider_connections_delete_own on public.provider_connections;
revoke insert, update, delete on public.provider_connections from authenticated;
grant select on public.provider_connections to authenticated;

create policy provider_syncs_select_own
on public.provider_syncs for select
to authenticated
using ((select auth.uid()) = user_id);

create policy activities_select_own
on public.activities for select
to authenticated
using ((select auth.uid()) = user_id);

create policy fitness_snapshots_select_own
on public.fitness_snapshots for select
to authenticated
using ((select auth.uid()) = user_id);

grant select on public.provider_syncs to authenticated;
grant select on public.activities to authenticated;
grant select on public.fitness_snapshots to authenticated;

revoke all on public.provider_oauth_states from anon, authenticated;
grant select, insert, update, delete on public.provider_oauth_states to service_role;
grant select, insert, update, delete on public.provider_syncs to service_role;
grant select, insert, update, delete on public.activities to service_role;
grant select, insert, update, delete on public.fitness_snapshots to service_role;
grant select, insert, update, delete on public.provider_connections to service_role;
