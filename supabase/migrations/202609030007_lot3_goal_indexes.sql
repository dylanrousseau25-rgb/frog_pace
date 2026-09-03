create index if not exists goal_feasibility_user_idx
  on public.goal_feasibility_assessments(user_id);

create index if not exists goals_accepted_assessment_idx
  on public.goals(accepted_assessment_id)
  where accepted_assessment_id is not null;
