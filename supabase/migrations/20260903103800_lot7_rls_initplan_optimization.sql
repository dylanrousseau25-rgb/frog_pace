drop policy if exists workout_matches_select_own on public.workout_matches;
create policy workout_matches_select_own on public.workout_matches for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists workout_feedback_select_own on public.workout_feedback;
create policy workout_feedback_select_own on public.workout_feedback for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists workout_feedback_insert_own on public.workout_feedback;
create policy workout_feedback_insert_own on public.workout_feedback for insert to authenticated with check (
  user_id = (select auth.uid())
  and exists(select 1 from public.workout_matches m where m.id=match_id and m.user_id=(select auth.uid()) and m.status='confirmed' and m.planned_workout_id=planned_workout_id and m.activity_id=activity_id)
);

drop policy if exists workout_feedback_update_own on public.workout_feedback;
create policy workout_feedback_update_own on public.workout_feedback for update to authenticated using (user_id = (select auth.uid())) with check (
  user_id = (select auth.uid())
  and exists(select 1 from public.workout_matches m where m.id=match_id and m.user_id=(select auth.uid()) and m.status='confirmed' and m.planned_workout_id=planned_workout_id and m.activity_id=activity_id)
);

drop policy if exists workout_feedback_delete_own on public.workout_feedback;
create policy workout_feedback_delete_own on public.workout_feedback for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists workout_analyses_select_own on public.workout_analyses;
create policy workout_analyses_select_own on public.workout_analyses for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists workout_exports_select_own on public.workout_exports;
create policy workout_exports_select_own on public.workout_exports for select to authenticated using (user_id = (select auth.uid()));
