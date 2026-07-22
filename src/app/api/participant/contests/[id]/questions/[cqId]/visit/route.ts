import { NextResponse } from "next/server";
import { requireParticipant, requireCsrf } from "@/lib/auth/guards";
import { loadForParticipant, ensureNotExpired } from "@/lib/participant-contests";
import {
  loadCodingQuestion,
  resolveHardLockSeconds,
  hardLockDeadline,
  ensureQuestionStarted,
} from "@/lib/coding";
import { ParticipantStatus } from "@/generated/prisma/enums";

export const runtime = "nodejs";

/**
 * POST — mark a coding question visited and start its hard-lock clock the
 * first time the participant opens it (mirrors the MCQ/TEXT "visit on
 * navigate" behavior, which the answers/[cqId] PATCH does implicitly — coding
 * has no answer PATCH, so this is its equivalent).
 */
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string; cqId: string }> },
) {
  const user = await requireParticipant();
  if (user instanceof NextResponse) return user;
  const csrf = await requireCsrf(user);
  if (csrf) return csrf;

  const { id: contestId, cqId } = await ctx.params;
  const { contest, participant } = await loadForParticipant(contestId, user.id);
  if (!contest || !participant?.contestStartedAt) {
    return NextResponse.json({ error: "Contest not started" }, { status: 404 });
  }

  const current = await ensureNotExpired(contest, participant.id);
  if (current.status !== ParticipantStatus.IN_PROGRESS) {
    return NextResponse.json({ error: "This contest has already been submitted." }, { status: 409 });
  }

  const cq = await loadCodingQuestion(contestId, cqId);
  if (!cq) {
    return NextResponse.json({ error: "Coding question not found in this contest" }, { status: 404 });
  }

  const questionStartedAt = await ensureQuestionStarted(participant.id, cqId);
  const hardLockSeconds = resolveHardLockSeconds(cq);

  return NextResponse.json({
    questionStartedAt,
    hardLockDeadline: hardLockDeadline(hardLockSeconds, questionStartedAt),
  });
}
