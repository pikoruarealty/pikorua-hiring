import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * CSRF: signed double-submit token. The token is `<nonce>.<hmac>` where the HMAC
 * (keyed by APP_SECRET) covers the nonce bound to the session id. It is stored in
 * a non-httpOnly cookie AND must be echoed in the `x-csrf-token` header on every
 * state-changing request. An attacker on another origin can't read the cookie to
 * echo it, and can't forge the HMAC without APP_SECRET. Binding to the session id
 * prevents using a token minted for a different session.
 *
 * This layers on top of SameSite=Strict on the session cookie for defense in depth.
 */

export const CSRF_COOKIE = "contest_csrf";
export const CSRF_HEADER = "x-csrf-token";

function sign(nonce: string, sessionId: string): string {
  return createHmac("sha256", env.APP_SECRET)
    .update(`${nonce}.${sessionId}`)
    .digest("base64url");
}

export function issueCsrfToken(sessionId: string): string {
  const nonce = randomBytes(18).toString("base64url");
  return `${nonce}.${sign(nonce, sessionId)}`;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify a CSRF token against the session. Requires the header token to equal the
 * cookie token (double-submit) and to carry a valid HMAC for this session.
 */
export function verifyCsrf(
  cookieToken: string | undefined,
  headerToken: string | undefined,
  sessionId: string,
): boolean {
  if (!cookieToken || !headerToken) return false;
  if (!safeEqual(cookieToken, headerToken)) return false;

  const [nonce, mac] = headerToken.split(".");
  if (!nonce || !mac) return false;
  return safeEqual(mac, sign(nonce, sessionId));
}
