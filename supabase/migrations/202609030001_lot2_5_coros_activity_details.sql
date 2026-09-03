alter table public.activities
  add column if not exists avg_cadence numeric,
  add column if not exists max_cadence numeric,
  add column if not exists detail_provider_data jsonb not null default '{}'::jsonb,
  add column if not exists detail_sync_attempted_at timestamptz,
  add column if not exists detail_fetched_at timestamptz,
  add column if not exists detail_sync_error text;

create index if not exists activities_coros_detail_pending_idx
  on public.activities(user_id, started_at desc)
  where provider = 'coros' and detail_sync_attempted_at is null;
