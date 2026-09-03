import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callCorosBridge } from "@/lib/coros/bridge";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  try {
    const result = await callCorosBridge("sync", { syncType: "manual" });

    let detailEnrichment: unknown = null;
    try {
      const { data, error } = await supabase.functions.invoke("coros-activity-details", {
        body: { batchSize: 8 }
      });
      detailEnrichment = error ? { error: error.message } : data;
    } catch (detailError) {
      detailEnrichment = {
        error: detailError instanceof Error ? detailError.message : "Enrichissement des activités impossible"
      };
    }

    let workoutMatching: unknown = null;
    try {
      const { data, error } = await supabase.rpc("refresh_workout_matches");
      workoutMatching = error ? { error: error.message } : data;
    } catch (matchError) {
      workoutMatching = {
        error: matchError instanceof Error ? matchError.message : "Rapprochement activité/plan impossible"
      };
    }

    return NextResponse.json({ ...result, detailEnrichment, workoutMatching });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Synchronisation COROS impossible"
    }, { status: 400 });
  }
}
