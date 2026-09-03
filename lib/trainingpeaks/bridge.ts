import { createSupabaseServerClient } from "@/lib/supabase/server";

type TrainingPeaksAction = "status" | "start" | "finish" | "disconnect" | "prepare" | "export" | "export_plan";

export async function callTrainingPeaksBridge(action: TrainingPeaksAction, payload: Record<string, unknown> = {}) {
  const supabase = await createSupabaseServerClient();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  if (sessionError || !accessToken) {
    throw new Error("Session Frog Pace expirée. Reconnecte-toi.");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) throw new Error("Configuration Supabase manquante");

  const response = await fetch(`${supabaseUrl}/functions/v1/trainingpeaks-bridge`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
      "content-type": "application/json"
    },
    body: JSON.stringify({ action, ...payload }),
    cache: "no-store"
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.error) {
    throw new Error(body?.error || `TrainingPeaks: erreur ${response.status}`);
  }
  return body;
}
