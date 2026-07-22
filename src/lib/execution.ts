import { env } from "./env";
import {
  PISTON_RUNTIME,
  PISTON_SOURCE_FILENAME,
  type SupportedLanguage,
} from "./languages";

/**
 * Piston execution client + test-case grading. Used only by the worker
 * (`src/worker/index.ts`) — never called from a request handler directly,
 * since a single execution can take seconds and must go through BullMQ.
 */

export interface TestCaseSpec {
  id: string;
  input: string;
  expectedOutput: string;
  score: number;
  isSample: boolean;
}

export interface TestCaseResult {
  testCaseId: string;
  isSample: boolean;
  passed: boolean;
  actualOutput: string; // redacted (empty) for hidden cases before sending to participant
  executionTimeMs: number;
  timedOut: boolean;
  error: string | null; // stderr/signal summary, only for sample cases in the participant view
}

export interface GradeResult {
  status: "PASSED" | "FAILED" | "PARTIAL" | "ERROR" | "TIME_LIMIT_EXCEEDED";
  score: number;
  maxScore: number;
  totalExecutionTimeMs: number;
  compileError: string | null;
  results: TestCaseResult[];
}

interface PistonExecuteResponse {
  compile?: { stdout: string; stderr: string; code: number | null; signal: string | null };
  run: { stdout: string; stderr: string; code: number | null; signal: string | null };
}

function normalize(s: string): string {
  return s.replace(/\r\n/g, "\n").trimEnd();
}

function truncate(s: string): string {
  const buf = Buffer.from(s, "utf8");
  if (buf.length <= env.MAX_OUTPUT_BYTES) return s;
  return buf.subarray(0, env.MAX_OUTPUT_BYTES).toString("utf8") + "\n…(truncated)";
}

async function executeOne(
  language: SupportedLanguage,
  code: string,
  stdin: string,
  timeLimitSeconds: number,
  memoryLimitMb: number,
): Promise<{ result: PistonExecuteResponse | null; executionTimeMs: number; networkError: string | null }> {
  const runtime = PISTON_RUNTIME[language];
  const filename = PISTON_SOURCE_FILENAME[language];
  const started = Date.now();
  try {
    const res = await fetch(`${env.PISTON_API_URL}/api/v2/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language: runtime.language,
        version: runtime.version,
        files: [{ name: filename, content: code }],
        stdin,
        compile_timeout: 10_000,
        run_timeout: timeLimitSeconds * 1000,
        compile_memory_limit: -1,
        run_memory_limit: memoryLimitMb * 1024 * 1024,
      }),
    });
    const executionTimeMs = Date.now() - started;
    if (!res.ok) {
      return { result: null, executionTimeMs, networkError: `Piston HTTP ${res.status}` };
    }
    const body = (await res.json()) as PistonExecuteResponse;
    return { result: body, executionTimeMs, networkError: null };
  } catch (err) {
    return {
      result: null,
      executionTimeMs: Date.now() - started,
      networkError: err instanceof Error ? err.message : "Piston request failed",
    };
  }
}

/**
 * Run `code` against every given test case sequentially (Piston has no batch
 * endpoint) and grade the result. `resultsAreHidden` controls whether actual
 * output/error is redacted for non-sample cases (Run always passes only
 * sample cases in, so this is really only relevant for Submit).
 */
export async function gradeSubmission(
  language: SupportedLanguage,
  code: string,
  testCases: TestCaseSpec[],
  timeLimitSeconds: number,
  memoryLimitMb: number,
  onResult?: (result: TestCaseResult) => void | Promise<void>,
): Promise<GradeResult> {
  const results: TestCaseResult[] = [];
  let totalExecutionTimeMs = 0;
  let compileError: string | null = null;

  for (const tc of testCases) {
    const { result, executionTimeMs, networkError } = await executeOne(
      language,
      code,
      tc.input,
      timeLimitSeconds,
      memoryLimitMb,
    );
    totalExecutionTimeMs += executionTimeMs;

    let entry: TestCaseResult;
    if (networkError || !result) {
      entry = {
        testCaseId: tc.id,
        isSample: tc.isSample,
        passed: false,
        actualOutput: "",
        executionTimeMs,
        timedOut: false,
        error: networkError ?? "Execution failed",
      };
    } else if (result.compile && result.compile.code !== 0) {
      compileError = truncate(normalize(result.compile.stderr || result.compile.stdout));
      entry = {
        testCaseId: tc.id,
        isSample: tc.isSample,
        passed: false,
        actualOutput: "",
        executionTimeMs,
        timedOut: false,
        error: "Compilation failed",
      };
    } else {
      const timedOut = result.run.signal === "SIGKILL";
      const actualOutput = truncate(normalize(result.run.stdout));
      const passed = !timedOut && result.run.code === 0 && actualOutput === normalize(tc.expectedOutput);
      entry = {
        testCaseId: tc.id,
        isSample: tc.isSample,
        passed,
        actualOutput,
        executionTimeMs,
        timedOut,
        error: timedOut
          ? "Time limit exceeded"
          : result.run.code !== 0
            ? truncate(normalize(result.run.stderr)) || `Exited with code ${result.run.code}`
            : null,
      };
    }

    results.push(entry);
    await onResult?.(entry);
    // A compile error is identical for every remaining test case (same source) —
    // stop making redundant Piston calls once we've seen one.
    if (compileError) {
      for (const rest of testCases.slice(results.length)) {
        const skipped: TestCaseResult = {
          testCaseId: rest.id,
          isSample: rest.isSample,
          passed: false,
          actualOutput: "",
          executionTimeMs: 0,
          timedOut: false,
          error: "Compilation failed",
        };
        results.push(skipped);
        await onResult?.(skipped);
      }
      break;
    }
  }

  const maxScore = testCases.reduce((acc, tc) => acc + tc.score, 0);

  if (compileError) {
    return { status: "ERROR", score: 0, maxScore, totalExecutionTimeMs, compileError, results };
  }
  if (results.some((r) => r.timedOut)) {
    return {
      status: "TIME_LIMIT_EXCEEDED",
      score: results.filter((r) => r.passed).reduce((acc, r) => {
        const tc = testCases.find((t) => t.id === r.testCaseId);
        return acc + (tc?.score ?? 0);
      }, 0),
      maxScore,
      totalExecutionTimeMs,
      compileError: null,
      results,
    };
  }

  const score = results.reduce((acc, r) => {
    if (!r.passed) return acc;
    const tc = testCases.find((t) => t.id === r.testCaseId);
    return acc + (tc?.score ?? 0);
  }, 0);
  const allPassed = results.length > 0 && results.every((r) => r.passed);
  const nonePassed = results.every((r) => !r.passed);

  return {
    status: allPassed ? "PASSED" : nonePassed ? "FAILED" : "PARTIAL",
    score,
    maxScore,
    totalExecutionTimeMs,
    compileError: null,
    results,
  };
}
