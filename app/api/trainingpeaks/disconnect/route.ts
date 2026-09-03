import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callTrainingPeaksBridge } from "@/lib/trainingpeaks/bridge";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  try {
    const result = await callTrainingPeaksBridge("disconnect");
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Déconnexion TrainingPeaks impossible" }, { status: 400 });
  }
}
