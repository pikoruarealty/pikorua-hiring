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
import { toParticipantTestCaseResult } from "@/lib/execution-events";
import type { TestCaseResult } from "@/lib/execution";
import type { Prisma } from "@/generated/prisma/client";

export const runtime = "nodejs";

function redactHiddenResults(testCaseResults: Prisma.JsonValue) {
  if (!Array.isArray(testCaseResults)) return [];
  return (testCaseResults as unknown as TestCaseResult[]).map(toParticipantTestCaseResult);
}

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
    resultsVisibleToParticipants: contest.resultsVisibleToParticipants,
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
          allowMultipleAnswers: true,
          options: { select: { id: true, text: true, order: true } },
          codingConfig: {
            select: {
              timeLimitSeconds: true,
              memoryLimitMb: true,
              allowedLanguages: true,
              starterCode: true,
              defaultHardLockSeconds: true,
              testCases: {
                where: { isSample: true },
                orderBy: { order: "asc" },
                select: { id: true, input: true, expectedOutput: true },
              },
            },
          },
        },
      },
    },
  });

  const submitAttempts = await prisma.attempt.findMany({
    where: { contestParticipantId: participant.id, attemptType: AttemptType.SUBMIT },
    select: {
      contestQuestionId: true,
      selectedOptionIds: true,
      textAnswer: true,
      visited: true,
      markedForReview: true,
      questionStartedAt: true,
      language: true,
      code: true,
      status: true,
      score: true,
      maxPossibleScore: true,
      totalExecutionTimeMs: true,
      testCaseResults: true,
    },
  });
  const runAttempts = await prisma.attempt.findMany({
    where: { contestParticipantId: participant.id, attemptType: AttemptType.RUN },
    select: {
      contestQuestionId: true,
      language: true,
      code: true,
      status: true,
      totalExecutionTimeMs: true,
      testCaseResults: true,
    },
  });
  const runByQuestion = Object.fromEntries(runAttempts.map((r) => [r.contestQuestionId, r]));

  const answers = Object.fromEntries(
    submitAttempts.map((a) => {
      const run = runByQuestion[a.contestQuestionId];
      return [
        a.contestQuestionId,
        {
          selectedOptionIds: a.selectedOptionIds,
          textAnswer: a.textAnswer,
          visited: a.visited,
          markedForReview: a.markedForReview,
          questionStartedAt: a.questionStartedAt,
          coding: a.language
            ? {
                submit: {
                  language: a.language,
                  code: a.code,
                  status: a.status,
                  score: a.score != null ? Number(a.score) : null,
                  maxScore: a.maxPossibleScore != null ? Number(a.maxPossibleScore) : null,
                  totalExecutionTimeMs: a.totalExecutionTimeMs,
                  results: redactHiddenResults(a.testCaseResults),
                },
                run: run
                  ? {
                      language: run.language,
                      code: run.code,
                      status: run.status,
                      totalExecutionTimeMs: run.totalExecutionTimeMs,
                      results: redactHiddenResults(run.testCaseResults),
                    }
                  : null,
              }
            : run
              ? {
                  submit: null,
                  run: {
                    language: run.language,
                    code: run.code,
                    status: run.status,
                    totalExecutionTimeMs: run.totalExecutionTimeMs,
                    results: redactHiddenResults(run.testCaseResults),
                  },
                }
              : null,
        },
      ];
    }),
  );

  const questionStartedByQuestion = Object.fromEntries(
    submitAttempts.map((a) => [a.contestQuestionId, a.questionStartedAt]),
  );

  const isFinalized =
    participant.status === ParticipantStatus.SUBMITTED ||
    participant.status === ParticipantStatus.AUTO_SUBMITTED ||
    participant.status === ParticipantStatus.LOCKED_OUT;

  return NextResponse.json({
    contest: base,
    participant: {
      status: participant.status,
      contestStartedAt: participant.contestStartedAt,
      totalScore:
        isFinalized && contest.resultsVisibleToParticipants
          ? Number(participant.totalScore)
          : null,
    },
    questions: contestQuestions.map((cq) =>
      toParticipantQuestion(cq, questionStartedByQuestion[cq.id] ?? null),
    ),
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
