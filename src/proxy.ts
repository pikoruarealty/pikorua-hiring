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
 * CSP (tuned in Phase 5): Monaco (@monaco-editor/react) loads its bundle and
 * worker scripts from jsdelivr's CDN by default (no self-hosting plugin is
 * wired up — Next 16 + Turbopack, and self-hosting needs a webpack-specific
 * plugin), so that host has to be allow-listed for script/style/worker/font
 * sources. `'unsafe-inline'` on script/style is a known gap: Next's App
 * Router injects inline hydration/RSC payload scripts and Tailwind emits
 * inline style attributes, and this app has no nonce plumbing to replace it
 * with. Tightening that further (nonce-based CSP) is a follow-up, not a
 * Phase 5 blocker. connect-src covers same-origin fetch/XHR/SSE.
 */
const MONACO_CDN = "https://cdn.jsdelivr.net";

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
  res.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' ${MONACO_CDN}`,
      `style-src 'self' 'unsafe-inline' ${MONACO_CDN}`,
      `font-src 'self' data: ${MONACO_CDN}`,
      "img-src 'self' data: blob:",
      "worker-src 'self' blob:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  );
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
