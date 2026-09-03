revoke execute on function public.assess_goal_feasibility(uuid) from anon;
revoke execute on function public.accept_goal_assessment(uuid, uuid) from anon;

alter function public.accept_goal_assessment(uuid, uuid) security invoker;

grant execute on function public.assess_goal_feasibility(uuid) to authenticated;
grant execute on function public.accept_goal_assessment(uuid, uuid) to authenticated;
