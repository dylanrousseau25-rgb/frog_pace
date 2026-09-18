import { NextResponse } from "next/server";

// Legacy Supabase callback kept only so old bookmarks/redirects fail cleanly.
// Frog Pace now uses local MariaDB authentication and creates the session at signup/login time.
export async function GET(request: Request) {
  return NextResponse.redirect(new URL("/login", request.url));
}
