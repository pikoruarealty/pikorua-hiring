import type { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { SESSION_COOKIE } from "./session";
import { CSRF_COOKIE } from "./csrf";

const isProd = env.NODE_ENV === "production";

/**
 * Set the session (httpOnly) and CSRF (readable) cookies on a response.
 * SameSite=Strict on both; Secure only in production (dev runs over http).
 * The CSRF cookie is intentionally NOT httpOnly so client JS can echo it in the
 * x-csrf-token header (signed double-submit pattern).
 */
export function setAuthCookies(
  res: NextResponse,
  sessionToken: string,
  csrfToken: string,
  expiresAt: Date,
): void {
  res.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });
  res.cookies.set(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure: isProd,
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });
}

/** Clear both auth cookies (logout). */
export function clearAuthCookies(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  res.cookies.set(CSRF_COOKIE, "", {
    httpOnly: false,
    secure: isProd,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}
