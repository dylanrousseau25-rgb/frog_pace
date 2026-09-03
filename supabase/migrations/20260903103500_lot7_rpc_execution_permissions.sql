grant execute on function private.refresh_workout_matches() to authenticated;
grant execute on function private.confirm_workout_match(uuid,uuid) to authenticated;
grant execute on function private.remove_workout_match(uuid) to authenticated;
grant execute on function private.analyze_workout_feedback(uuid) to authenticated;
