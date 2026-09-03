import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callTrainingPeaksBridge } from "@/lib/trainingpeaks/bridge";

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL("/login", request.url));

  try {
    const origin = new URL(request.url).origin;
    const redirectUri = `${origin}/api/trainingpeaks/callback`;
    const result = await callTrainingPeaksBridge("start", { redirectUri });
    if (!result?.authorizationUrl) {
      const url = new URL("/profile/connections", request.url);
      url.searchParams.set("trainingpeaks", "blocked");
      url.searchParams.set("message", result?.blockerMessage || "Accès partenaire TrainingPeaks requis.");
      return NextResponse.redirect(url);
    }
    return NextResponse.redirect(result.authorizationUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connexion TrainingPeaks impossible";
    const url = new URL("/profile/connections", request.url);
    url.searchParams.set("trainingpeaks", "error");
    url.searchParams.set("message", message.slice(0, 300));
    return NextResponse.redirect(url);
  }
}
