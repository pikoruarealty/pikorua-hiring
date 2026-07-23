import { prisma } from "@/lib/db";
import { scoreMcq, scoreText } from "@/lib/scoring";
import {
  ContestVisibility,
  ContestStatus,
  ParticipantStatus,
  AttemptType,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Participant-facing contest domain rules: eligibility, the server-authoritative
 * countdown, autosave scoring, and final-submit aggregation. The server clock
 * (`new Date()`) is the single source of truth for timing everywhere — the
 * client's own countdown is a display estimate only, resynced from these
 * endpoints (see AGENTS.md / initial-prompt.md "Timezones" resolution).
 */

export type ContestPhase = "UPCOMING" | "ACTIVE" | "ENDED";

export function contestPhase(
  contest: { startAt: Date; endAt: Date },
  now: Date = new Date(),
): ContestPhase {
  if (now < contest.startAt) return "UPCOMING";
  if (now >= contest.endAt) return "ENDED";
  return "ACTIVE";
}

/**
 * The deadline a participant's own countdown must resync against: the
 * earlier of the contest's global `endAt` and their personal
 * `contestStartedAt + durationMinutes` (once they've started). Before they've
 * started, only the contest window applies.
 */
export function effectiveDeadline(
  contest: { endAt: Date; durationMinutes: number },
  participant: { contestStartedAt: Date | null } | null,
): Date {
  if (!participant?.contestStartedAt) return contest.endAt;
  const perParticipant = new Date(
    participant.contestStartedAt.getTime() + contest.durationMinutes * 60_000,
  );
  return perParticipant < contest.endAt ? perParticipant : contest.endAt;
}

/** A contest is visible/enterable at all only once published (non-DRAFT). */
function isPublished(contest: { status: ContestStatus }): boolean {
  return contest.status !== ContestStatus.DRAFT;
}

/**
 * Load a contest + this participant's roster row (if any). Returns null for
 * `contest` if it doesn't exist or isn't published — callers should treat
 * that as "not found" rather than leaking draft contests.
 */
export async function loadForParticipant(contestId: string, userId: string) {
  const contest = await prisma.contest.findUnique({ where: { id: contestId } });
  if (!contest || !isPublished(contest)) {
    return { contest: null, participant: null };
  }
  const participant = await prisma.contestParticipant.findUnique({
    where: { contestId_userId: { contestId, userId } },
  });
  return { contest, participant };
}

/**
 * Can this participant enter (start/resume) right now? Returns a reason
 * string on failure (safe to show verbatim), or null if they're clear to go.
 */
export function assertEnterable(
  contest: { visibility: ContestVisibility; startAt: Date; endAt: Date },
  participant: {
    status: ParticipantStatus;
    contestStartedAt: Date | null;
  } | null,
  now: Date = new Date(),
): string | null {
  if (contest.visibility === ContestVisibility.INVITE_ONLY && !participant) {
    return "You are not invited to this contest.";
  }
  if (participant?.status === ParticipantStatus.SUBMITTED) {
    return "You have already submitted this contest.";
  }
  if (participant?.status === ParticipantStatus.AUTO_SUBMITTED) {
    return "This contest was auto-submitted after time expired.";
  }
  if (participant?.status === ParticipantStatus.LOCKED_OUT) {
    return "You have been locked out of this contest.";
  }
  // Already started: resuming is allowed any time before their own deadline,
  // even if the global contest window's `endAt` math gets close — the
  // in-progress check below (ensureNotExpired) is what actually cuts it off.
  if (participant?.contestStartedAt) return null;
  if (now < contest.startAt) return "This contest hasn't started yet.";
  if (now >= contest.endAt) return "This contest has ended.";
  return null;
}

/**
 * If this participant's deadline has passed while they were still
 * IN_PROGRESS, finalize their submission right now (server-detected timeout —
 * not dependent on the client calling submit). Returns the up-to-date
 * ContestParticipant row either way.
 */
export async function ensureNotExpired(
  contest: { id: string; endAt: Date; durationMinutes: number },
  contestParticipantId: string,
) {
  const participant = await prisma.contestParticipant.findUniqueOrThrow({
    where: { id: contestParticipantId },
  });
  if (participant.status !== ParticipantStatus.IN_PROGRESS) return participant;
  const deadline = effectiveDeadline(contest, participant);
  if (new Date() < deadline) return participant;
  return finalizeSubmission(contestParticipantId, "TIMEOUT");
}

const FINALIZE_STATUS: Record<"MANUAL" | "TIMEOUT" | "PROCTORING", ParticipantStatus> = {
  MANUAL: ParticipantStatus.SUBMITTED,
  TIMEOUT: ParticipantStatus.AUTO_SUBMITTED,
  PROCTORING: ParticipantStatus.LOCKED_OUT,
};

type TxClient = Prisma.TransactionClient;

/**
 * Score and lock in every saved (SUBMIT-type) attempt for this participant,
 * sum their scores into `totalScore`, and mark them submitted/auto-submitted/
 * locked-out. Idempotent — calling it again once already in a terminal
 * status is a no-op. Pass `client` (a transaction client) when calling from
 * inside another transaction, e.g. proctoring's own strike-counting
 * transaction (see `src/lib/proctoring.ts`) — nesting `prisma.$transaction`
 * calls isn't supported.
 */
export async function finalizeSubmission(
  contestParticipantId: string,
  reason: "MANUAL" | "TIMEOUT" | "PROCTORING",
  reasonText?: string,
  client?: TxClient,
) {
  const run = async (tx: TxClient) => {
    const participant = await tx.contestParticipant.findUniqueOrThrow({
      where: { id: contestParticipantId },
    });
    if (
      participant.status === ParticipantStatus.SUBMITTED ||
      participant.status === ParticipantStatus.AUTO_SUBMITTED ||
      participant.status === ParticipantStatus.LOCKED_OUT
    ) {
      return participant;
    }

    const attempts = await tx.attempt.findMany({
      where: { contestParticipantId, attemptType: AttemptType.SUBMIT },
      select: { score: true, totalExecutionTimeMs: true },
    });
    const totalScore = attempts.reduce(
      (acc, a) => acc + Number(a.score ?? 0),
      0,
    );
    const tieBreakExecutionTimeMs = attempts.some(
      (a) => a.totalExecutionTimeMs != null,
    )
      ? attempts.reduce((acc, a) => acc + (a.totalExecutionTimeMs ?? 0), 0)
      : null;

    return tx.contestParticipant.update({
      where: { id: contestParticipantId },
      data: {
        status: FINALIZE_STATUS[reason],
        contestSubmittedAt: new Date(),
        totalScore,
        tieBreakExecutionTimeMs,
        autoSubmittedReason:
          reason === "TIMEOUT" ? "Time expired" : reason === "PROCTORING" ? (reasonText ?? "Proctoring violation") : null,
      },
    });
  };

  return client ? run(client) : prisma.$transaction(run);
}

/** Compute (and persist) the score for one saved MCQ/TEXT answer. */
export function computeAnswerScore(
  question: {
    type: string;
    options: { id: string; score: Prisma.Decimal }[];
    textAnswerConfig: { correctAnswer: string } | null;
  },
  points: number,
  selectedOptionIds: string[],
  textAnswer: string | null,
): number | null {
  if (question.type === "MCQ") {
    return scoreMcq(question.options, selectedOptionIds).toNumber();
  }
  if (question.type === "TEXT" && question.textAnswerConfig) {
    return scoreText(question.textAnswerConfig.correctAnswer, textAnswer, points).toNumber();
  }
  return null;
}

/** Strip admin-only fields (scores, correct answers, solutions) for participant views. */
export function toParticipantQuestion(
  cq: {
    id: string;
    order: number;
    sectionLabel: string | null;
    pointsOverride: Prisma.Decimal | null;
    hardLockSecondsOverride: number | null;
    question: {
      id: string;
      type: string;
      title: string;
      body: string;
      defaultPoints: Prisma.Decimal;
      allowMultipleAnswers: boolean;
      options: { id: string; text: string; order: number }[];
      codingConfig: {
        timeLimitSeconds: number;
        memoryLimitMb: number;
        allowedLanguages: string[];
        starterCode: Prisma.JsonValue;
        defaultHardLockSeconds: number | null;
        testCases: { id: string; input: string; expectedOutput: string }[];
      } | null;
    };
  },
  questionStartedAt: Date | null = null,
) {
  const hardLockSeconds =
    cq.hardLockSecondsOverride ?? cq.question.codingConfig?.defaultHardLockSeconds ?? null;
  const lockDeadline =
    hardLockSeconds != null && questionStartedAt
      ? new Date(questionStartedAt.getTime() + hardLockSeconds * 1000)
      : null;

  return {
    id: cq.id,
    order: cq.order,
    sectionLabel: cq.sectionLabel,
    points: Number(cq.pointsOverride ?? cq.question.defaultPoints),
    question: {
      id: cq.question.id,
      type: cq.question.type,
      title: cq.question.title,
      body: cq.question.body,
      allowMultipleAnswers: cq.question.allowMultipleAnswers,
      options: cq.question.options
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((o) => ({ id: o.id, text: o.text })),
      coding: cq.question.codingConfig
        ? {
            timeLimitSeconds: cq.question.codingConfig.timeLimitSeconds,
            memoryLimitMb: cq.question.codingConfig.memoryLimitMb,
            allowedLanguages: cq.question.codingConfig.allowedLanguages,
            starterCode: cq.question.codingConfig.starterCode,
            sampleTestCases: cq.question.codingConfig.testCases,
            hardLockSeconds,
            hardLockDeadline: lockDeadline,
            questionStartedAt,
          }
        : null,
    },
  };
}
