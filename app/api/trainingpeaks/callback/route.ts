import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callTrainingPeaksBridge } from "@/lib/trainingpeaks/bridge";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL("/login", request.url));

  const providerError = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (providerError) {
    const target = new URL("/profile/connections", request.url);
    target.searchParams.set("trainingpeaks", "error");
    target.searchParams.set("message", providerError.slice(0, 300));
    return NextResponse.redirect(target);
  }

  try {
    await callTrainingPeaksBridge("finish", {
      code: url.searchParams.get("code"),
      state: url.searchParams.get("state")
    });
    const target = new URL("/profile/connections", request.url);
    target.searchParams.set("trainingpeaks", "connected");
    return NextResponse.redirect(target);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Finalisation TrainingPeaks impossible";
    const target = new URL("/profile/connections", request.url);
    target.searchParams.set("trainingpeaks", "error");
    target.searchParams.set("message", message.slice(0, 300));
    return NextResponse.redirect(target);
  }
}
