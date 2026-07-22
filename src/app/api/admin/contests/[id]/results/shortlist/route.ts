import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin, requireCsrf, requestMeta } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";
import { inviteParticipants, isContestLocked } from "@/lib/contests";
import { ContestVisibility } from "@/generated/prisma/enums";

export const runtime = "nodejs";

const bodySchema = z.object({
  targetContestId: z.string().min(1),
  contestParticipantIds: z.array(z.string().min(1)).min(1),
});

/**
 * POST — shortlist selected leaderboard rows into another contest's
 * roster. Resolves the source `ContestParticipant` ids to `userId`s, then
 * reuses `inviteParticipants` (the same dedupe/validate logic as the direct
 * invite route) against the target contest.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const csrf = await requireCsrf(admin);
  if (csrf) return csrf;

  const { id: sourceContestId } = await ctx.params;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (body.targetContestId === sourceContestId) {
    return NextResponse.json(
      { error: "Choose a different contest to shortlist into." },
      { status: 400 },
    );
  }

  const target = await prisma.contest.findUnique({
    where: { id: body.targetContestId },
    select: { id: true, visibility: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Target contest not found" }, { status: 404 });
  }
  if (target.visibility !== ContestVisibility.INVITE_ONLY) {
    return NextResponse.json(
      { error: "Only invite-only contests maintain an explicit roster." },
      { status: 400 },
    );
  }
  if (await isContestLocked(body.targetContestId)) {
    return NextResponse.json(
      { error: "A participant has already entered the target contest; its roster is locked." },
      { status: 409 },
    );
  }

  const source = await prisma.contestParticipant.findMany({
    where: { id: { in: body.contestParticipantIds }, contestId: sourceContestId },
    select: { userId: true },
  });
  if (source.length === 0) {
    return NextResponse.json({ error: "No matching participants to shortlist." }, { status: 400 });
  }

  const result = await inviteParticipants(body.targetContestId, source.map((s) => s.userId));

  const { ip, userAgent } = await requestMeta();
  await writeAudit({
    actorUserId: admin.id,
    action: "SHORTLIST_PARTICIPANTS",
    targetType: "Contest",
    targetId: body.targetContestId,
    diff: { fromContestId: sourceContestId, ...result },
    ip,
    userAgent,
  });

  return NextResponse.json(result);
}
