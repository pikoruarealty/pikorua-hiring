import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireParticipant, requireCsrf, requestMeta } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";
import { loadForParticipant, assertEnterable } from "@/lib/participant-contests";
import { ParticipantStatus } from "@/generated/prisma/enums";

export const runtime = "nodejs";

/**
 * POST — start (first time) or resume (subsequent calls) this contest.
 * Idempotent: once `contestStartedAt` is set, calling again just confirms
 * eligibility and returns ok — the client should then GET the contest for
 * current state. `contestStartedAt` is the server clock, never the client's.
 */
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await requireParticipant();
  if (user instanceof NextResponse) return user;
  const csrf = await requireCsrf(user);
  if (csrf) return csrf;

  const { id: contestId } = await ctx.params;
  const { contest, participant } = await loadForParticipant(contestId, user.id);
  if (!contest) {
    return NextResponse.json({ error: "Contest not found" }, { status: 404 });
  }

  const reason = assertEnterable(contest, participant);
  if (reason) {
    return NextResponse.json({ error: reason }, { status: 403 });
  }

  if (participant?.contestStartedAt) {
    return NextResponse.json({ ok: true });
  }

  const now = new Date();
  if (participant) {
    await prisma.contestParticipant.update({
      where: { id: participant.id },
      data: {
        status: ParticipantStatus.IN_PROGRESS,
        registeredAt: participant.registeredAt ?? now,
        contestStartedAt: now,
      },
    });
  } else {
    await prisma.contestParticipant.create({
      data: {
        contestId,
        userId: user.id,
        status: ParticipantStatus.IN_PROGRESS,
        registeredAt: now,
        contestStartedAt: now,
      },
    });
  }

  const { ip, userAgent } = await requestMeta();
  await writeAudit({
    actorUserId: user.id,
    action: "START_CONTEST",
    targetType: "Contest",
    targetId: contestId,
    ip,
    userAgent,
  });

  return NextResponse.json({ ok: true });
}
