import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { issueCsrfToken } from "@/lib/auth/csrf";
import { setAuthCookies } from "@/lib/auth/cookies";
import { requestMeta } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const bodySchema = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(500),
});

export async function POST(request: Request) {
  const { ip, userAgent } = await requestMeta();

  // Rate limit login attempts per IP to blunt credential stuffing / brute force.
  const rl = await rateLimit(
    `login:${ip ?? "unknown"}`,
    env.RATE_LIMIT_LOGIN_MAX,
    env.RATE_LIMIT_LOGIN_WINDOW_SECONDS,
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many login attempts. Try again later." },
      { status: 429, headers: { "retry-after": String(rl.resetSeconds) } },
    );
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { username: parsed.username },
    select: { id: true, passwordHash: true, isActive: true, role: true },
  });

  // Constant-ish response: always verify against something to avoid user enumeration
  // via timing. Generic error message regardless of which check fails.
  const okPassword = user
    ? await verifyPassword(user.passwordHash, parsed.password)
    : await verifyPassword(
        // dummy argon2id hash of a random value; result discarded
        "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$3s0m3Fmxb3B0Rk0mRnh0b3B0Rk0mRnh0b3B0Rk0",
        parsed.password,
      );

  if (!user || !user.isActive || !okPassword) {
    return NextResponse.json(
      { error: "Invalid username or password" },
      { status: 401 },
    );
  }

  const { rawToken, sessionId, expiresAt } = await createSession(
    user.id,
    ip,
    userAgent,
  );
  const csrfToken = issueCsrfToken(sessionId);

  const res = NextResponse.json({ ok: true, role: user.role });
  setAuthCookies(res, rawToken, csrfToken, expiresAt);
  return res;
}
