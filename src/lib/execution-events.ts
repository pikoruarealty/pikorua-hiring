import type { TestCaseResult } from "./execution";

/** Redis pub/sub channel the worker publishes to and the SSE route subscribes to. */
export function executionChannel(attemptId: string): string {
  return `exec:${attemptId}`;
}

export type ExecutionEvent =
  | { type: "status"; status: "RUNNING" }
  | { type: "test-result"; result: ParticipantTestCaseResult }
  | {
      type: "final";
      status: "PASSED" | "FAILED" | "PARTIAL" | "ERROR" | "TIME_LIMIT_EXCEEDED";
      score: number;
      maxScore: number;
      totalExecutionTimeMs: number;
      compileError: string | null;
      results?: ParticipantTestCaseResult[];
    };

/** Hidden test cases never reveal actual output/error to the participant, only pass/fail. */
export type ParticipantTestCaseResult = Pick<
  TestCaseResult,
  "testCaseId" | "isSample" | "passed" | "executionTimeMs" | "timedOut"
> &
  Partial<Pick<TestCaseResult, "actualOutput" | "error">>;

export function toParticipantTestCaseResult(r: TestCaseResult): ParticipantTestCaseResult {
  if (r.isSample) return r;
  const { testCaseId, isSample, passed, executionTimeMs, timedOut } = r;
  return { testCaseId, isSample, passed, executionTimeMs, timedOut };
}
