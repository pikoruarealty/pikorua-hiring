import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin, requireCsrf, requestMeta } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";
import { assertPublishable } from "@/lib/contests";
import { ContestStatus } from "@/generated/prisma/enums";

export const runtime = "nodejs";

/** POST — DRAFT -> SCHEDULED. Requires >=1 question, and >=1 invitee if INVITE_ONLY. */
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const csrf = await requireCsrf(admin);
  if (csrf) return csrf;

  const { id } = await ctx.params;
  const problem = await assertPublishable(id);
  if (problem) {
    return NextResponse.json(
      { error: problem },
      { status: problem === "Contest not found." ? 404 : 409 },
    );
  }

  const contest = await prisma.contest.update({
    where: { id },
    data: { status: ContestStatus.SCHEDULED },
    select: { id: true, title: true, status: true },
  });

  const { ip, userAgent } = await requestMeta();
  await writeAudit({
    actorUserId: admin.id,
    action: "PUBLISH_CONTEST",
    targetType: "Contest",
    targetId: id,
    diff: { title: contest.title },
    ip,
    userAgent,
  });

  return NextResponse.json({ contest });
}
