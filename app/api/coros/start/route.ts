import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callCorosBridge } from "@/lib/coros/bridge";

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL("/login", request.url));

  try {
    const origin = new URL(request.url).origin;
    const redirectUri = `${origin}/api/coros/callback`;
    const result = await callCorosBridge("start", { redirectUri });
    if (!result?.authorizationUrl) throw new Error("URL d’autorisation COROS manquante");
    return NextResponse.redirect(result.authorizationUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connexion COROS impossible";
    const url = new URL("/profile/connections", request.url);
    url.searchParams.set("coros", "error");
    url.searchParams.set("message", message.slice(0, 300));
    return NextResponse.redirect(url);
  }
}
