import { NextResponse } from "next/server";
import { requireParticipant, requireCsrf } from "@/lib/auth/guards";
import {
  loadForParticipant,
  ensureNotExpired,
  finalizeSubmission,
} from "@/lib/participant-contests";
import { ParticipantStatus } from "@/generated/prisma/enums";

export const runtime = "nodejs";

/**
 * POST — final submit (manual). Idempotent: if the deadline already passed
 * server-side, `ensureNotExpired` has already auto-finalized as TIMEOUT by
 * the time this runs, and this just reports that outcome rather than
 * double-submitting.
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
  if (!contest || !participant?.contestStartedAt) {
    return NextResponse.json({ error: "Contest not started" }, { status: 404 });
  }

  const current = await ensureNotExpired(contest, participant.id);
  const finalized =
    current.status === ParticipantStatus.IN_PROGRESS
      ? await finalizeSubmission(participant.id, "MANUAL")
      : current;

  return NextResponse.json({
    status: finalized.status,
    totalScore: contest.resultsVisibleToParticipants ? Number(finalized.totalScore) : null,
  });
}
