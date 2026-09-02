import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callCorosBridge } from "@/lib/coros/bridge";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL("/login", request.url));

  const providerError = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (providerError) {
    const target = new URL("/profile/connections", request.url);
    target.searchParams.set("coros", "error");
    target.searchParams.set("message", providerError.slice(0, 300));
    return NextResponse.redirect(target);
  }

  try {
    await callCorosBridge("finish", {
      code: url.searchParams.get("code"),
      state: url.searchParams.get("state")
    });

    let sync = "success";
    try {
      const result = await callCorosBridge("sync", { syncType: "initial" });
      sync = result?.status || "success";
    } catch {
      sync = "error";
    }

    const target = new URL("/profile/connections", request.url);
    target.searchParams.set("coros", "connected");
    target.searchParams.set("sync", sync);
    return NextResponse.redirect(target);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Finalisation COROS impossible";
    const target = new URL("/profile/connections", request.url);
    target.searchParams.set("coros", "error");
    target.searchParams.set("message", message.slice(0, 300));
    return NextResponse.redirect(target);
  }
}
