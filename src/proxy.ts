import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Proxy (Next.js 16's renamed middleware). Two jobs here:
 *   1. Attach baseline security headers to every response.
 *   2. Coarse, defense-in-depth redirect: bounce unauthenticated visitors away
 *      from protected page trees to /login based on cookie *presence* only.
 *
 * This is NOT the real authorization check — per Next.js guidance, actual session
 * validation and role checks live in the route handlers / layouts (see
 * src/lib/auth/guards.ts). The proxy can't hit the DB to validate the session, so
 * it only checks whether a session cookie exists at all.
 *
 * The CSP is intentionally permissive for dev (Phase 0 stub); it is tuned in
 * Phase 5 once Monaco's web workers and SSE endpoints are wired.
 */

const SESSION_COOKIE = "contest_session";
const PROTECTED_PREFIXES = ["/admin", "/participant"];

function securityHeaders(res: NextResponse): NextResponse {
  // Contests must never be embeddable (would defeat proctoring/fullscreen checks).
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  // HSTS only matters over HTTPS; harmless over http in dev.
  res.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );
  // Phase 0 stub CSP: lock framing, tightened further in Phase 5.
  res.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  return res;
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (isProtected && !request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return securityHeaders(NextResponse.redirect(url));
  }

  return securityHeaders(NextResponse.next());
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};
