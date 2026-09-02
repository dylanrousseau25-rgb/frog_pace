import { createSupabaseServerClient } from "@/lib/supabase/server";

type CorosAction = "start" | "finish" | "sync" | "disconnect";

export async function callCorosBridge(action: CorosAction, payload: Record<string, unknown> = {}) {
  const supabase = await createSupabaseServerClient();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  if (sessionError || !accessToken) {
    throw new Error("Session Frog Pace expirée. Reconnecte-toi.");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) throw new Error("Configuration Supabase manquante");

  const response = await fetch(`${supabaseUrl}/functions/v1/coros-bridge-v2`, {
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
    throw new Error(body?.error || `COROS: erreur ${response.status}`);
  }
  return body;
}
