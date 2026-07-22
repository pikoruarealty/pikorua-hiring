import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireParticipant } from "@/lib/auth/guards";
import {
  loadForParticipant,
  contestPhase,
  effectiveDeadline,
  ensureNotExpired,
  toParticipantQuestion,
} from "@/lib/participant-contests";
import { AttemptType, ParticipantStatus } from "@/generated/prisma/enums";

export const runtime = "nodejs";

/**
 * GET — contest state for this participant: metadata, phase, and — once
 * they've started — the question list (safe projection, no answers/scores
 * leaked) plus their saved answers and server-computed remaining seconds.
 * Resync from this endpoint periodically; the client's own countdown is a
 * display estimate only.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await requireParticipant();
  if (user instanceof NextResponse) return user;

  const { id: contestId } = await ctx.params;
  const { contest, participant: initialParticipant } = await loadForParticipant(
    contestId,
    user.id,
  );
  if (!contest) {
    return NextResponse.json({ error: "Contest not found" }, { status: 404 });
  }

  const now = new Date();
  const base = {
    id: contest.id,
    title: contest.title,
    description: contest.description,
    instructions: contest.instructions,
    visibility: contest.visibility,
    startAt: contest.startAt,
    endAt: contest.endAt,
    durationMinutes: contest.durationMinutes,
    phase: contestPhase(contest, now),
  };

  if (!initialParticipant || !initialParticipant.contestStartedAt) {
    return NextResponse.json({
      contest: base,
      participant: initialParticipant
        ? { status: initialParticipant.status, contestStartedAt: null }
        : null,
      questions: null,
      answers: null,
      remainingSeconds: null,
    });
  }

  const participant = await ensureNotExpired(contest, initialParticipant.id);

  const contestQuestions = await prisma.contestQuestion.findMany({
    where: { contestId },
    orderBy: { order: "asc" },
    include: {
      question: {
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          defaultPoints: true,
          options: { select: { id: true, text: true, order: true } },
          codingConfig: {
            select: {
              timeLimitSeconds: true,
              memoryLimitMb: true,
              allowedLanguages: true,
              starterCode: true,
            },
          },
        },
      },
    },
  });

  const attempts = await prisma.attempt.findMany({
    where: { contestParticipantId: participant.id, attemptType: AttemptType.SUBMIT },
    select: {
      contestQuestionId: true,
      selectedOptionIds: true,
      textAnswer: true,
      visited: true,
      markedForReview: true,
    },
  });
  const answers = Object.fromEntries(
    attempts.map((a) => [
      a.contestQuestionId,
      {
        selectedOptionIds: a.selectedOptionIds,
        textAnswer: a.textAnswer,
        visited: a.visited,
        markedForReview: a.markedForReview,
      },
    ]),
  );

  return NextResponse.json({
    contest: base,
    participant: {
      status: participant.status,
      contestStartedAt: participant.contestStartedAt,
    },
    questions: contestQuestions.map(toParticipantQuestion),
    answers,
    remainingSeconds:
      participant.status === ParticipantStatus.IN_PROGRESS
        ? Math.max(
            0,
            Math.round(
              (effectiveDeadline(contest, participant).getTime() - Date.now()) / 1000,
            ),
          )
        : 0,
  });
}
