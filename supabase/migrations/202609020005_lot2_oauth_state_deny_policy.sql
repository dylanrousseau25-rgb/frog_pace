drop policy if exists provider_oauth_states_no_client_access on public.provider_oauth_states;

create policy provider_oauth_states_no_client_access
on public.provider_oauth_states
as restrictive
for all
to authenticated
using (false)
with check (false);
