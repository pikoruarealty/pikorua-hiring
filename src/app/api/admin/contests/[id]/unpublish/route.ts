import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, requireCsrf, requestMeta } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";
import { isContestLocked } from "@/lib/contests";
import { ContestStatus } from "@/generated/prisma/enums";

export const runtime = "nodejs";

/** POST — SCHEDULED -> DRAFT. Only while the contest hasn't started yet. */
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const csrf = await requireCsrf(admin);
  if (csrf) return csrf;

  const { id } = await ctx.params;
  const existing = await prisma.contest.findUnique({
    where: { id },
    select: { id: true, title: true, status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Contest not found" }, { status: 404 });
  }
  if (existing.status !== ContestStatus.SCHEDULED) {
    return NextResponse.json(
      { error: "Only a scheduled contest can be unpublished." },
      { status: 409 },
    );
  }
  if (await isContestLocked(id)) {
    return NextResponse.json(
      {
        error:
          "A participant has already entered this contest; it can no longer be unpublished.",
      },
      { status: 409 },
    );
  }

  const contest = await prisma.contest.update({
    where: { id },
    data: { status: ContestStatus.DRAFT },
    select: { id: true, title: true, status: true },
  });

  const { ip, userAgent } = await requestMeta();
  await writeAudit({
    actorUserId: admin.id,
    action: "UNPUBLISH_CONTEST",
    targetType: "Contest",
    targetId: id,
    diff: { title: contest.title },
    ip,
    userAgent,
  });

  return NextResponse.json({ contest });
}
