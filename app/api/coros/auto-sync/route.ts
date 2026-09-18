import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callCorosBridge } from "@/lib/coros/bridge";
import { enrichCorosActivityDetails } from "@/lib/coros/activity-details";
import { row } from "@/lib/db";

const STALE_AFTER_MS = 15 * 60 * 1000;

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data: connection } = await supabase
    .from("provider_connections")
    .select("status,last_sync_at")
    .eq("provider", "coros")
    .maybeSingle();

  if (!connection || connection.status !== "connected") {
    return NextResponse.json({ skipped: true, reason: "coros_not_connected" });
  }

  const lastSync = connection.last_sync_at ? new Date(connection.last_sync_at).getTime() : 0;
  if (lastSync && Date.now() - lastSync < STALE_AFTER_MS) {
    return NextResponse.json({ skipped: true, reason: "fresh" });
  }

  const before = await row<{ total: number }>("select count(*) as total from activities where user_id=? and provider='coros'", [auth.user.id]);

  try {
    const result = await callCorosBridge("sync", { syncType: "automatic" });
    const after = await row<{ total: number }>("select count(*) as total from activities where user_id=? and provider='coros'", [auth.user.id]);
    const newActivities = Math.max(0, Number(after?.total || 0) - Number(before?.total || 0));

    let detailEnrichment: unknown = null;
    let workoutMatching: unknown = null;
    let weeklyReview: unknown = null;

    if (newActivities > 0) {
      try {
        detailEnrichment = await enrichCorosActivityDetails(auth.user.id, Math.min(12, Math.max(4, newActivities)), false);
      } catch (detailError) {
        detailEnrichment = { error: detailError instanceof Error ? detailError.message : "Enrichissement impossible" };
      }

      try {
        const { data, error } = await supabase.rpc("refresh_workout_matches");
        workoutMatching = error ? { error: error.message } : data;
      } catch (matchError) {
        workoutMatching = { error: matchError instanceof Error ? matchError.message : "Rapprochement impossible" };
      }

      try {
        const { data, error } = await supabase.rpc("generate_weekly_review");
        weeklyReview = error ? { error: error.message } : data;
      } catch (reviewError) {
        weeklyReview = { error: reviewError instanceof Error ? reviewError.message : "Bilan hebdomadaire impossible" };
      }
    }

    return NextResponse.json({ ...result, automatic: true, newActivities, detailEnrichment, workoutMatching, weeklyReview });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Synchronisation COROS automatique impossible" }, { status: 400 });
  }
}
