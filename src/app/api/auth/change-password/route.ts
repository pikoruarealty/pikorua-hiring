import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  hashPassword,
  verifyPassword,
  validatePasswordComplexity,
} from "@/lib/auth/password";
import { requireUser, requireCsrf } from "@/lib/auth/guards";

export const runtime = "nodejs";

const bodySchema = z.object({
  currentPassword: z.string().min(1).max(500),
  newPassword: z.string().min(1).max(500),
});

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const csrf = await requireCsrf(auth);
  if (csrf) return csrf;

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const complexityError = validatePasswordComplexity(parsed.newPassword);
  if (complexityError) {
    return NextResponse.json({ error: complexityError }, { status: 400 });
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: auth.id },
    select: { passwordHash: true },
  });

  const ok = await verifyPassword(user.passwordHash, parsed.currentPassword);
  if (!ok) {
    return NextResponse.json(
      { error: "Current password is incorrect" },
      { status: 400 },
    );
  }

  const newHash = await hashPassword(parsed.newPassword);

  // Update the hash and revoke all other live sessions for this user (keep the
  // current one). Runs in a transaction so both take effect atomically.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: auth.id },
      data: { passwordHash: newHash },
    }),
    prisma.session.updateMany({
      where: { userId: auth.id, id: { not: auth.sessionId }, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
