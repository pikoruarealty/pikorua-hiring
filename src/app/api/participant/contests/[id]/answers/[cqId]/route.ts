import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireParticipant, requireCsrf } from "@/lib/auth/guards";
import {
  loadForParticipant,
  ensureNotExpired,
  computeAnswerScore,
} from "@/lib/participant-contests";
import { AttemptType, ParticipantStatus, QuestionType } from "@/generated/prisma/enums";

export const runtime = "nodejs";

const answerSchema = z.object({
  selectedOptionIds: z.array(z.string()).max(20).optional(),
  textAnswer: z.string().max(2000).nullable().optional(),
  markedForReview: z.boolean(),
});

/**
 * PATCH — autosave a saved (SUBMIT-type) answer for one MCQ/TEXT question.
 * Also doubles as the "visit" signal: calling this (even with an unchanged
 * answer, when the palette navigates to a question) marks it visited.
 * Scored immediately — MCQ/TEXT grading is synchronous and cheap, unlike
 * coding (Phase 4), so there's no reason to defer it to final submit.
 */
export async function PATCH(
  request: Request,
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
    return NextResponse.json(
      { error: "This contest has already been submitted." },
      { status: 409 },
    );
  }

  let input: z.infer<typeof answerSchema>;
  try {
    input = answerSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const contestQuestion = await prisma.contestQuestion.findFirst({
    where: { id: cqId, contestId },
    include: {
      question: {
        select: {
          type: true,
          defaultPoints: true,
          options: { select: { id: true, score: true } },
          textAnswerConfig: { select: { correctAnswer: true } },
        },
      },
    },
  });
  if (!contestQuestion) {
    return NextResponse.json({ error: "Question not found in this contest" }, { status: 404 });
  }
  if (contestQuestion.question.type === QuestionType.CODING) {
    return NextResponse.json(
      { error: "Coding questions are answered from the code editor." },
      { status: 400 },
    );
  }

  const validOptionIds = new Set(contestQuestion.question.options.map((o) => o.id));
  const selectedOptionIds = (input.selectedOptionIds ?? []).filter((id) =>
    validOptionIds.has(id),
  );
  const textAnswer = input.textAnswer ?? null;
  const points = Number(contestQuestion.pointsOverride ?? contestQuestion.question.defaultPoints);
  const score = computeAnswerScore(
    contestQuestion.question,
    points,
    selectedOptionIds,
    textAnswer,
  );

  const attempt = await prisma.attempt.upsert({
    where: {
      contestParticipantId_contestQuestionId_attemptType: {
        contestParticipantId: participant.id,
        contestQuestionId: cqId,
        attemptType: AttemptType.SUBMIT,
      },
    },
    create: {
      contestParticipantId: participant.id,
      contestQuestionId: cqId,
      attemptType: AttemptType.SUBMIT,
      selectedOptionIds,
      textAnswer,
      visited: true,
      markedForReview: input.markedForReview,
      score,
      maxPossibleScore: points,
    },
    update: {
      selectedOptionIds,
      textAnswer,
      visited: true,
      markedForReview: input.markedForReview,
      score,
      maxPossibleScore: points,
    },
    select: { selectedOptionIds: true, textAnswer: true, visited: true, markedForReview: true },
  });

  return NextResponse.json({ answer: attempt });
}
