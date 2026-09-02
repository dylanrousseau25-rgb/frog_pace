revoke insert, update, delete, truncate, references, trigger on public.activities from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.fitness_snapshots from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.provider_syncs from anon, authenticated;

grant select on public.activities to authenticated;
grant select on public.fitness_snapshots to authenticated;
grant select on public.provider_syncs to authenticated;
