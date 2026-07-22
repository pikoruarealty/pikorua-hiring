import { NextResponse } from "next/server";
import { requireParticipant } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";
import { executionChannel, toParticipantTestCaseResult } from "@/lib/execution-events";
import type { TestCaseResult } from "@/lib/execution";
import { AttemptStatus } from "@/generated/prisma/enums";

export const runtime = "nodejs";

const TERMINAL_STATUSES: AttemptStatus[] = [
  AttemptStatus.PASSED,
  AttemptStatus.FAILED,
  AttemptStatus.PARTIAL,
  AttemptStatus.ERROR,
  AttemptStatus.TIME_LIMIT_EXCEEDED,
];

/**
 * GET — Server-Sent Events stream of live Run/Submit status for one Attempt.
 * Sends the current DB state immediately (covers the case where the job
 * already finished before the client subscribed), then relays Redis pub/sub
 * events the worker publishes as it grades each test case.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string; cqId: string }> }) {
  const user = await requireParticipant();
  if (user instanceof NextResponse) return user;

  const { id: contestId, cqId } = await ctx.params;
  const attemptId = new URL(request.url).searchParams.get("attemptId");
  if (!attemptId) return NextResponse.json({ error: "attemptId required" }, { status: 400 });

  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    include: { contestParticipant: true, contestQuestion: true },
  });
  if (
    !attempt ||
    attempt.contestQuestionId !== cqId ||
    attempt.contestQuestion.contestId !== contestId ||
    attempt.contestParticipant.userId !== user.id
  ) {
    return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  const channel = executionChannel(attemptId);
  const sub = redis.duplicate();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      // Must stay `let`, not `const`: `close()` (below) can run via the
      // already-terminal early-return path before this is ever assigned.
      // eslint-disable-next-line prefer-const -- see comment above
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const send = (event: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        sub.unsubscribe().catch(() => {});
        sub.quit().catch(() => {});
        try {
          controller.close();
        } catch {
          // already closed by client disconnect
        }
      };

      if (TERMINAL_STATUSES.includes(attempt.status)) {
        send({
          type: "final",
          status: attempt.status,
          score: attempt.score != null ? Number(attempt.score) : 0,
          maxScore: attempt.maxPossibleScore != null ? Number(attempt.maxPossibleScore) : 0,
          totalExecutionTimeMs: attempt.totalExecutionTimeMs,
          results: Array.isArray(attempt.testCaseResults)
            ? (attempt.testCaseResults as unknown as TestCaseResult[]).map(toParticipantTestCaseResult)
            : [],
        });
        close();
        return;
      }

      send({ type: "status", status: attempt.status });

      await sub.subscribe(channel);
      sub.on("message", (_ch, message) => {
        try {
          const event = JSON.parse(message);
          send(event);
          if (event.type === "final") close();
        } catch {
          // ignore malformed message
        }
      });

      heartbeat = setInterval(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(`: heartbeat\n\n`));
      }, 15_000);

      request.signal.addEventListener("abort", close);
    },
    cancel() {
      sub.unsubscribe().catch(() => {});
      sub.quit().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
