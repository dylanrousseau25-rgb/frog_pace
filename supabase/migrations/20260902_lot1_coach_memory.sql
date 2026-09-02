create table public.coach_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('preference','constraint','injury','training_response','habit','equipment','schedule','coach_learning')),
  content text not null check (char_length(trim(content)) between 1 and 500),
  source text not null default 'user_declared' check (source in ('user_declared','feedback','coach_inferred','activity_pattern')),
  confidence numeric(4,3) not null default 1.000 check (confidence >= 0 and confidence <= 1),
  status text not null default 'active' check (status in ('active','superseded','deleted')),
  sensitive boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_confirmed_at timestamptz
);

create index coach_memories_user_status_idx on public.coach_memories(user_id, status, created_at desc);

create trigger coach_memories_updated_at
before update on public.coach_memories
for each row execute function public.set_updated_at();

alter table public.coach_memories enable row level security;

create policy coach_memories_select_own
on public.coach_memories for select
to authenticated
using ((select auth.uid()) = user_id);

create policy coach_memories_insert_own
on public.coach_memories for insert
to authenticated
with check ((select auth.uid()) = user_id and source = 'user_declared');

create policy coach_memories_update_own
on public.coach_memories for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update on public.coach_memories to authenticated;
