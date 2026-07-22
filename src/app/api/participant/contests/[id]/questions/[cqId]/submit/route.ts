import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireParticipant, requireCsrf } from "@/lib/auth/guards";
import { loadForParticipant, ensureNotExpired } from "@/lib/participant-contests";
import {
  loadCodingQuestion,
  assertLanguageAllowed,
  resolveHardLockSeconds,
  assertQuestionNotLocked,
  ensureQuestionStarted,
} from "@/lib/coding";
import { rateLimit } from "@/lib/rate-limit";
import { executionQueue } from "@/lib/queue";
import { env } from "@/lib/env";
import { AttemptType, AttemptStatus, ParticipantStatus } from "@/generated/prisma/enums";

export const runtime = "nodejs";

const bodySchema = z.object({
  language: z.string(),
  code: z.string().min(1).max(50_000),
});

/**
 * POST — Submit (per coding question): executes against every test case
 * (public + private) and computes score. Allowed multiple times; only the
 * latest Submission is persisted (overwrite previous) — this is what the
 * contest-level final Submit sums into `totalScore`.
 */
export async function POST(
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
    return NextResponse.json({ error: "This contest has already been submitted." }, { status: 409 });
  }

  const cq = await loadCodingQuestion(contestId, cqId);
  if (!cq) {
    return NextResponse.json({ error: "Coding question not found in this contest" }, { status: 404 });
  }

  let input: z.infer<typeof bodySchema>;
  try {
    input = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const langError = assertLanguageAllowed(cq.question.codingConfig!.allowedLanguages, input.language);
  if (langError) return NextResponse.json({ error: langError }, { status: 400 });

  const questionStartedAt = await ensureQuestionStarted(participant.id, cqId);
  const hardLockSeconds = resolveHardLockSeconds(cq);
  const lockError = assertQuestionNotLocked(hardLockSeconds, questionStartedAt);
  if (lockError) return NextResponse.json({ error: lockError }, { status: 409 });

  const rl = await rateLimit(`exec:${user.id}`, 1, env.RATE_LIMIT_RUN_SUBMIT_SECONDS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Please wait ${rl.resetSeconds}s between Run/Submit calls.` },
      { status: 429 },
    );
  }

  // This is the same (participant, question, SUBMIT) row `ensureQuestionStarted`
  // created — update it in place with the code to grade, without touching
  // `questionStartedAt`/`visited`.
  const attempt = await prisma.attempt.update({
    where: {
      contestParticipantId_contestQuestionId_attemptType: {
        contestParticipantId: participant.id,
        contestQuestionId: cqId,
        attemptType: AttemptType.SUBMIT,
      },
    },
    data: {
      language: input.language,
      code: input.code,
      status: AttemptStatus.QUEUED,
      testCaseResults: undefined,
      score: null,
      maxPossibleScore: null,
      totalExecutionTimeMs: null,
      submittedAt: new Date(),
    },
    select: { id: true },
  });

  await executionQueue.add("submit", { attemptId: attempt.id });

  return NextResponse.json({ attemptId: attempt.id });
}
