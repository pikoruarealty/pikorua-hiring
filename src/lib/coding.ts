import { prisma } from "@/lib/db";
import { AttemptType } from "@/generated/prisma/enums";
import { isSupportedLanguage } from "@/lib/languages";

/** Load a CODING contest question with everything a Run/Submit route needs, scoped to one contest. */
export async function loadCodingQuestion(contestId: string, contestQuestionId: string) {
  const cq = await prisma.contestQuestion.findFirst({
    where: { id: contestQuestionId, contestId },
    include: {
      question: {
        include: {
          codingConfig: { include: { testCases: { select: { id: true, isSample: true } } } },
        },
      },
    },
  });
  if (!cq || cq.question.type !== "CODING" || !cq.question.codingConfig) return null;
  return cq;
}

/** Reason string if this language isn't one of the question's `allowedLanguages`, else null. */
export function assertLanguageAllowed(
  allowedLanguages: string[],
  language: string,
): string | null {
  if (!isSupportedLanguage(language)) return "Unsupported language.";
  if (allowedLanguages.length > 0 && !allowedLanguages.includes(language)) {
    return "This language isn't allowed for this question.";
  }
  return null;
}

/**
 * Participant-facing coding-question domain rules: the per-question hard-lock
 * timer (distinct from the contest-wide `effectiveDeadline` in
 * participant-contests.ts and from Piston's per-run `timeLimitSeconds`).
 */

/** Resolve the effective hard-lock duration for a contest question (seconds), or null = no lock. */
export function resolveHardLockSeconds(cq: {
  hardLockSecondsOverride: number | null;
  question: { codingConfig: { defaultHardLockSeconds: number | null } | null };
}): number | null {
  return cq.hardLockSecondsOverride ?? cq.question.codingConfig?.defaultHardLockSeconds ?? null;
}

export function hardLockDeadline(
  hardLockSeconds: number | null,
  questionStartedAt: Date | null,
): Date | null {
  if (hardLockSeconds == null || !questionStartedAt) return null;
  return new Date(questionStartedAt.getTime() + hardLockSeconds * 1000);
}

/**
 * Ensure the canonical SUBMIT-type Attempt row exists for this
 * (participant, question) pair and has `questionStartedAt` set — this is the
 * same row MCQ/TEXT use as their answer row, and for CODING it anchors the
 * hard-lock deadline. Idempotent: only sets `questionStartedAt`/`visited` on
 * first call, never overwrites a later code submission.
 */
export async function ensureQuestionStarted(contestParticipantId: string, contestQuestionId: string) {
  const existing = await prisma.attempt.findUnique({
    where: {
      contestParticipantId_contestQuestionId_attemptType: {
        contestParticipantId,
        contestQuestionId,
        attemptType: AttemptType.SUBMIT,
      },
    },
    select: { questionStartedAt: true },
  });
  if (existing?.questionStartedAt) return existing.questionStartedAt;

  const now = new Date();
  const row = await prisma.attempt.upsert({
    where: {
      contestParticipantId_contestQuestionId_attemptType: {
        contestParticipantId,
        contestQuestionId,
        attemptType: AttemptType.SUBMIT,
      },
    },
    create: {
      contestParticipantId,
      contestQuestionId,
      attemptType: AttemptType.SUBMIT,
      visited: true,
      questionStartedAt: now,
    },
    update: {
      visited: true,
      questionStartedAt: now,
    },
    select: { questionStartedAt: true },
  });
  return row.questionStartedAt;
}

/** Returns a user-safe reason string if the question's hard lock has expired, else null. */
export function assertQuestionNotLocked(
  hardLockSeconds: number | null,
  questionStartedAt: Date | null,
  now: Date = new Date(),
): string | null {
  const deadline = hardLockDeadline(hardLockSeconds, questionStartedAt);
  if (deadline && now >= deadline) {
    return "This question's time limit has expired.";
  }
  return null;
}
