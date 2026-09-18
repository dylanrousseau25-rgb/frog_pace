import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "frog_session";

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isPublic = path.startsWith("/login")
    || path.startsWith("/api/auth")
    || path.startsWith("/legal")
    || path.startsWith("/_next")
    || path === "/favicon.ico"
    || path === "/manifest.webmanifest"
    || path === "/sw.js";

  if (!isPublic && !request.cookies.get(SESSION_COOKIE)?.value) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
