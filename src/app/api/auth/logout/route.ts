import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, revokeSessionByToken } from "@/lib/auth/session";
import { clearAuthCookies } from "@/lib/auth/cookies";
import { getSessionUser, requireCsrf } from "@/lib/auth/guards";

export const runtime = "nodejs";

export async function POST() {
  const user = await getSessionUser();
  if (user) {
    const csrf = await requireCsrf(user);
    if (csrf) return csrf;
  }

  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (raw) {
    await revokeSessionByToken(raw);
  }
  const res = NextResponse.json({ ok: true });
  clearAuthCookies(res);
  return res;
}
