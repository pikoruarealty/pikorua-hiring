import { prisma } from "@/lib/db";
import { compareForRanking } from "@/lib/scoring";
import { AttemptType, ParticipantStatus } from "@/generated/prisma/enums";

/**
 * Admin-facing results domain: the ranked leaderboard and the full
 * per-participant drill-down (code, test results, proctoring log). Unlike
 * the participant-facing projection in `participant-contests.ts`, nothing
 * here is redacted — this is the admin view.
 */

// Statuses that represent a finished attempt at the contest — these are the
// rows that get ranked. Anyone still INVITED/REGISTERED/IN_PROGRESS hasn't
// produced a final score yet and is excluded from the ranked leaderboard.
const FINAL_STATUSES: ParticipantStatus[] = [
  ParticipantStatus.SUBMITTED,
  ParticipantStatus.AUTO_SUBMITTED,
  ParticipantStatus.LOCKED_OUT,
];

export interface LeaderboardRow {
  contestParticipantId: string;
  rank: number;
  user: { id: string; username: string; fullName: string | null };
  status: ParticipantStatus;
  totalScore: number;
  tieBreakExecutionTimeMs: number | null;
  contestSubmittedAt: Date | null;
}

/**
 * Ranked leaderboard for a contest: only participants in a final status are
 * ranked (via `compareForRanking`, reused from `scoring.ts` — same
 * comparator that will eventually drive any participant-facing leaderboard
 * too). Ties share a rank (next distinct row's rank accounts for the gap,
 * i.e. standard competition ranking: 1,1,3).
 */
export async function getLeaderboard(contestId: string): Promise<LeaderboardRow[]> {
  const rows = await prisma.contestParticipant.findMany({
    where: { contestId, status: { in: FINAL_STATUSES } },
    select: {
      id: true,
      status: true,
      totalScore: true,
      tieBreakExecutionTimeMs: true,
      contestSubmittedAt: true,
      user: { select: { id: true, username: true, fullName: true } },
    },
  });

  const sorted = rows.slice().sort((a, b) =>
    compareForRanking(
      { totalScore: a.totalScore, submittedAt: a.contestSubmittedAt, tieBreakExecutionTimeMs: a.tieBreakExecutionTimeMs },
      { totalScore: b.totalScore, submittedAt: b.contestSubmittedAt, tieBreakExecutionTimeMs: b.tieBreakExecutionTimeMs },
    ),
  );

  let rank = 0;
  let seen = 0;
  let prev: (typeof sorted)[number] | null = null;
  return sorted.map((row) => {
    seen += 1;
    if (
      !prev ||
      compareForRanking(
        { totalScore: prev.totalScore, submittedAt: prev.contestSubmittedAt, tieBreakExecutionTimeMs: prev.tieBreakExecutionTimeMs },
        { totalScore: row.totalScore, submittedAt: row.contestSubmittedAt, tieBreakExecutionTimeMs: row.tieBreakExecutionTimeMs },
      ) !== 0
    ) {
      rank = seen;
    }
    prev = row;
    return {
      contestParticipantId: row.id,
      rank,
      user: row.user,
      status: row.status,
      totalScore: Number(row.totalScore),
      tieBreakExecutionTimeMs: row.tieBreakExecutionTimeMs,
      contestSubmittedAt: row.contestSubmittedAt,
    };
  });
}

/**
 * Full admin drill-down for one participant: every SUBMIT (and, if present,
 * RUN) attempt with unredacted test-case results, MCQ/TEXT answers joined
 * against the correct answer, and the full proctoring event timeline.
 * Deliberately does NOT call the participant-facing `redactHiddenResults` —
 * that redaction is participant-view-only by design.
 */
export async function getParticipantDrilldown(contestId: string, contestParticipantId: string) {
  const participant = await prisma.contestParticipant.findFirst({
    where: { id: contestParticipantId, contestId },
    select: {
      id: true,
      status: true,
      totalScore: true,
      tieBreakExecutionTimeMs: true,
      contestStartedAt: true,
      contestSubmittedAt: true,
      autoSubmittedReason: true,
      user: { select: { id: true, username: true, fullName: true, email: true } },
    },
  });
  if (!participant) return null;

  const attempts = await prisma.attempt.findMany({
    where: { contestParticipantId },
    orderBy: [{ contestQuestion: { order: "asc" } }, { attemptType: "asc" }],
    select: {
      id: true,
      attemptType: true,
      status: true,
      language: true,
      code: true,
      testCaseResults: true,
      totalExecutionTimeMs: true,
      selectedOptionIds: true,
      textAnswer: true,
      score: true,
      maxPossibleScore: true,
      submittedAt: true,
      contestQuestion: {
        select: {
          id: true,
          order: true,
          sectionLabel: true,
          question: {
            select: {
              id: true,
              type: true,
              title: true,
              body: true,
              options: { select: { id: true, text: true, score: true, isCorrect: true, order: true } },
              textAnswerConfig: { select: { correctAnswer: true } },
            },
          },
        },
      },
    },
  });

  // Group RUN + SUBMIT attempts per question so the UI can show both.
  const byQuestion = new Map<
    string,
    { submit: (typeof attempts)[number] | null; run: (typeof attempts)[number] | null }
  >();
  for (const a of attempts) {
    const key = a.contestQuestion.id;
    const entry = byQuestion.get(key) ?? { submit: null, run: null };
    if (a.attemptType === AttemptType.SUBMIT) entry.submit = a;
    else entry.run = a;
    byQuestion.set(key, entry);
  }

  const questions = [...byQuestion.entries()]
    .map(([contestQuestionId, { submit, run }]) => {
      const cq = (submit ?? run)!.contestQuestion;
      return {
        contestQuestionId,
        order: cq.order,
        sectionLabel: cq.sectionLabel,
        question: {
          id: cq.question.id,
          type: cq.question.type,
          title: cq.question.title,
          body: cq.question.body,
          options: cq.question.options
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((o) => ({ id: o.id, text: o.text, score: Number(o.score), isCorrect: o.isCorrect })),
          correctAnswer: cq.question.textAnswerConfig?.correctAnswer ?? null,
        },
        submit: submit
          ? {
              status: submit.status,
              language: submit.language,
              code: submit.code,
              testCaseResults: submit.testCaseResults,
              totalExecutionTimeMs: submit.totalExecutionTimeMs,
              selectedOptionIds: submit.selectedOptionIds,
              textAnswer: submit.textAnswer,
              score: submit.score != null ? Number(submit.score) : null,
              maxPossibleScore: submit.maxPossibleScore != null ? Number(submit.maxPossibleScore) : null,
              submittedAt: submit.submittedAt,
            }
          : null,
        run: run
          ? {
              status: run.status,
              language: run.language,
              code: run.code,
              testCaseResults: run.testCaseResults,
              totalExecutionTimeMs: run.totalExecutionTimeMs,
            }
          : null,
      };
    })
    .sort((a, b) => a.order - b.order);

  const proctoringEvents = await prisma.proctoringEvent.findMany({
    where: { contestParticipantId },
    orderBy: { occurredAt: "asc" },
    select: {
      id: true,
      eventType: true,
      occurredAt: true,
      cumulativeCountAtEvent: true,
      actionTaken: true,
      metadata: true,
    },
  });

  return {
    participant: {
      id: participant.id,
      status: participant.status,
      totalScore: Number(participant.totalScore),
      tieBreakExecutionTimeMs: participant.tieBreakExecutionTimeMs,
      contestStartedAt: participant.contestStartedAt,
      contestSubmittedAt: participant.contestSubmittedAt,
      autoSubmittedReason: participant.autoSubmittedReason,
      user: participant.user,
    },
    questions,
    proctoringEvents,
  };
}
