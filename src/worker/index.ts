import "dotenv/config";
import { Worker } from "bullmq";
import Redis from "ioredis";
import {
  EXECUTION_QUEUE,
  createQueueConnection,
  type ExecutionJobData,
} from "../lib/queue";
import { prisma } from "../lib/db";
import { gradeSubmission, type TestCaseSpec } from "../lib/execution";
import { executionChannel, toParticipantTestCaseResult } from "../lib/execution-events";
import { isSupportedLanguage } from "../lib/languages";
import { AttemptStatus, AttemptType } from "../generated/prisma/enums";
import type { Prisma } from "../generated/prisma/client";
import { env } from "../lib/env";

/**
 * Code-execution worker — a SEPARATE process from the web app (per
 * initial-prompt.md), so a misbehaving execution job can't reach the web
 * app's filesystem or environment. Consumes `code-execution` jobs, calls
 * Piston, persists graded results to the Attempt row, and publishes live
 * status/test-result events over Redis pub/sub for the participant-facing
 * SSE stream (`/api/participant/.../stream`).
 */
const publisher = new Redis(env.REDIS_URL);

const worker = new Worker<ExecutionJobData>(
  EXECUTION_QUEUE,
  async (job) => {
    const { attemptId } = job.data;
    const attempt = await prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        contestQuestion: {
          include: {
            question: {
              include: { codingConfig: { include: { testCases: { orderBy: { order: "asc" } } } } },
            },
          },
        },
      },
    });

    if (!attempt || !attempt.language || attempt.code == null) {
      console.error(`[worker] attempt ${attemptId} missing or has no code`);
      return { ok: false };
    }
    const codingConfig = attempt.contestQuestion.question.codingConfig;
    if (!codingConfig || !isSupportedLanguage(attempt.language)) {
      await prisma.attempt.update({
        where: { id: attemptId },
        data: { status: AttemptStatus.ERROR },
      });
      return { ok: false };
    }

    await prisma.attempt.update({
      where: { id: attemptId },
      data: { status: AttemptStatus.RUNNING },
    });
    const channel = executionChannel(attemptId);
    await publisher.publish(channel, JSON.stringify({ type: "status", status: "RUNNING" }));

    // Both Run and Submit execute every test case (sample + hidden); only the
    // participant-facing presentation differs (hidden results are shown as an
    // aggregate pass/fail summary, never individually) and Run's score is
    // never persisted/reported below.
    const testCases: TestCaseSpec[] = codingConfig.testCases.map((tc) => ({
      id: tc.id,
      input: tc.input,
      expectedOutput: tc.expectedOutput,
      score: Number(tc.score),
      isSample: tc.isSample,
    }));

    const graded = await gradeSubmission(
      attempt.language,
      attempt.code,
      testCases,
      codingConfig.timeLimitSeconds,
      codingConfig.memoryLimitMb,
      async (result) => {
        await publisher.publish(
          channel,
          JSON.stringify({ type: "test-result", result: toParticipantTestCaseResult(result) }),
        );
      },
    );

    const statusMap: Record<typeof graded.status, AttemptStatus> = {
      PASSED: AttemptStatus.PASSED,
      FAILED: AttemptStatus.FAILED,
      PARTIAL: AttemptStatus.PARTIAL,
      ERROR: AttemptStatus.ERROR,
      TIME_LIMIT_EXCEEDED: AttemptStatus.TIME_LIMIT_EXCEEDED,
    };

    await prisma.attempt.update({
      where: { id: attemptId },
      data: {
        status: statusMap[graded.status],
        testCaseResults: graded.results as unknown as Prisma.InputJsonValue,
        totalExecutionTimeMs: graded.totalExecutionTimeMs,
        // Run results never count toward score; only Submit is graded.
        score: attempt.attemptType === AttemptType.SUBMIT ? graded.score : null,
        maxPossibleScore: attempt.attemptType === AttemptType.SUBMIT ? graded.maxScore : null,
      },
    });

    await publisher.publish(
      channel,
      JSON.stringify({
        type: "final",
        status: graded.status,
        score: attempt.attemptType === AttemptType.SUBMIT ? graded.score : 0,
        maxScore: graded.maxScore,
        totalExecutionTimeMs: graded.totalExecutionTimeMs,
        compileError: graded.compileError,
        // Included so a client that subscribes late (missing earlier
        // "test-result" events to the race between job start and SSE
        // handshake) still ends up with the complete, correctly-ordered set.
        results: graded.results.map(toParticipantTestCaseResult),
      }),
    );

    return { ok: true };
  },
  { connection: createQueueConnection() },
);

worker.on("ready", () => {
  console.log(`[worker] ready, listening on queue "${EXECUTION_QUEUE}"`);
});

worker.on("failed", async (job, err) => {
  console.error(`[worker] job ${job?.id} failed:`, err.message);
  const attemptId = job?.data?.attemptId;
  if (!attemptId) return;
  await prisma.attempt
    .update({ where: { id: attemptId }, data: { status: AttemptStatus.ERROR } })
    .catch(() => {});
  await publisher
    .publish(
      executionChannel(attemptId),
      JSON.stringify({
        type: "final",
        status: "ERROR",
        score: 0,
        maxScore: 0,
        totalExecutionTimeMs: 0,
        compileError: err.message,
      }),
    )
    .catch(() => {});
});

async function shutdown() {
  console.log("[worker] shutting down…");
  await worker.close();
  await publisher.quit();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
