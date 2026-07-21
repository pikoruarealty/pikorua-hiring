import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  validateSessionToken,
  type AuthenticatedUser,
} from "./session";
import { CSRF_COOKIE, CSRF_HEADER, verifyCsrf } from "./csrf";
import { UserRole } from "@/generated/prisma/enums";

/**
 * Data Access Layer entrypoint: resolve the current user from the session cookie.
 * Auth is verified here (in route handlers / server components), not in proxy.ts,
 * per Next.js guidance to not rely on the proxy layer as the sole auth check.
 */
export async function getSessionUser(): Promise<AuthenticatedUser | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  return validateSessionToken(raw);
}

function jsonError(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Require an authenticated user. Returns the user, or a 401 NextResponse the
 * caller should return directly:
 *   const auth = await requireUser();
 *   if (auth instanceof NextResponse) return auth;
 */
export async function requireUser(): Promise<AuthenticatedUser | NextResponse> {
  const user = await getSessionUser();
  if (!user) return jsonError(401, "Not authenticated");
  return user;
}

/** Require an ADMIN. Returns the user or a 401/403 NextResponse. */
export async function requireAdmin(): Promise<AuthenticatedUser | NextResponse> {
  const user = await getSessionUser();
  if (!user) return jsonError(401, "Not authenticated");
  if (user.role !== UserRole.ADMIN) return jsonError(403, "Forbidden");
  return user;
}

/**
 * CSRF guard for state-changing routes. Call after resolving the user. Returns
 * null if OK, or a 403 NextResponse to return.
 */
export async function requireCsrf(
  user: AuthenticatedUser,
): Promise<NextResponse | null> {
  const store = await cookies();
  const cookieToken = store.get(CSRF_COOKIE)?.value;
  const hdrs = await headers();
  const headerToken = hdrs.get(CSRF_HEADER) ?? undefined;
  if (!verifyCsrf(cookieToken, headerToken, user.sessionId)) {
    return jsonError(403, "Invalid CSRF token");
  }
  return null;
}

/** Best-effort client IP + UA from request headers, for session/audit records. */
export async function requestMeta(): Promise<{
  ip: string | null;
  userAgent: string | null;
}> {
  const hdrs = await headers();
  const ip =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    hdrs.get("x-real-ip") ||
    null;
  const userAgent = hdrs.get("user-agent");
  return { ip, userAgent };
}
