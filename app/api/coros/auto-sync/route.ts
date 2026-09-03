import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callCorosBridge } from "@/lib/coros/bridge";

const STALE_AFTER_MS = 15 * 60 * 1000;

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data: connection } = await supabase
    .from("provider_connections")
    .select("status,last_sync_at")
    .eq("user_id", auth.user.id)
    .eq("provider", "coros")
    .maybeSingle();

  if (!connection || connection.status !== "connected") {
    return NextResponse.json({ skipped: true, reason: "coros_not_connected" });
  }

  const lastSync = connection.last_sync_at ? new Date(connection.last_sync_at).getTime() : 0;
  if (lastSync && Date.now() - lastSync < STALE_AFTER_MS) {
    return NextResponse.json({ skipped: true, reason: "fresh" });
  }

  const { count: beforeCount } = await supabase
    .from("activities")
    .select("id", { count: "exact", head: true })
    .eq("user_id", auth.user.id)
    .eq("provider", "coros");

  try {
    const result = await callCorosBridge("sync", { syncType: "automatic" });

    const { count: afterCount } = await supabase
      .from("activities")
      .select("id", { count: "exact", head: true })
      .eq("user_id", auth.user.id)
      .eq("provider", "coros");

    const newActivities = Math.max(0, Number(afterCount || 0) - Number(beforeCount || 0));
    let detailEnrichment: unknown = null;
    let workoutMatching: unknown = null;
    let weeklyReview: unknown = null;

    if (newActivities > 0) {
      try {
        const { data, error } = await supabase.functions.invoke("coros-activity-details", {
          body: { batchSize: Math.min(12, Math.max(4, newActivities)) },
        });
        detailEnrichment = error ? { error: error.message } : data;
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

    return NextResponse.json({
      ...result,
      automatic: true,
      newActivities,
      detailEnrichment,
      workoutMatching,
      weeklyReview,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Synchronisation COROS automatique impossible",
    }, { status: 400 });
  }
}
