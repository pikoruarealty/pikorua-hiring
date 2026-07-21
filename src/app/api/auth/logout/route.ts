import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, revokeSessionByToken } from "@/lib/auth/session";
import { clearAuthCookies } from "@/lib/auth/cookies";

export const runtime = "nodejs";

export async function POST() {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (raw) {
    await revokeSessionByToken(raw);
  }
  const res = NextResponse.json({ ok: true });
  clearAuthCookies(res);
  return res;
}
