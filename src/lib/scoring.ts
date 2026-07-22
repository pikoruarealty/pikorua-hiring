import { Decimal } from "@prisma/client/runtime/client";

/**
 * Pure scoring functions shared by the grading path (Phase 3/4) and any
 * preview/validation UI. No I/O — callers own persistence.
 */

export interface ScoredOption {
  id: string;
  score: Decimal | number;
}

/** MCQ: sum of scores of all selected options, floored at 0. */
export function scoreMcq(
  options: ScoredOption[],
  selectedOptionIds: string[],
): Decimal {
  const selected = new Set(selectedOptionIds);
  const sum = options
    .filter((o) => selected.has(o.id))
    .reduce((acc, o) => acc.add(o.score), new Decimal(0));
  return sum.lessThan(0) ? new Decimal(0) : sum;
}

/** Text: case-insensitive, trimmed, single correct string. Full points or 0. */
export function scoreText(
  correctAnswer: string,
  submitted: string | null | undefined,
  points: Decimal | number,
): Decimal {
  if (!submitted) return new Decimal(0);
  const a = correctAnswer.trim().toLowerCase();
  const b = submitted.trim().toLowerCase();
  return a === b ? new Decimal(points) : new Decimal(0);
}

export interface ScoredTestCase {
  id: string;
  score: Decimal | number;
}

export interface TestCaseResult {
  testCaseId: string;
  passed: boolean;
}

/** Coding: sum of scores of passed test cases, out of the total possible score. */
export function scoreCoding(
  testCases: ScoredTestCase[],
  results: TestCaseResult[],
): Decimal {
  const passed = new Set(
    results.filter((r) => r.passed).map((r) => r.testCaseId),
  );
  return testCases
    .filter((tc) => passed.has(tc.id))
    .reduce((acc, tc) => acc.add(tc.score), new Decimal(0));
}

export interface TieBreakInput {
  submittedAt: Date | null;
  tieBreakExecutionTimeMs: number | null;
}

/**
 * Ranking comparator: higher totalScore first; ties broken by earlier
 * submittedAt, then faster tieBreakExecutionTimeMs. Nulls sort last (treated
 * as "did not finish" for that criterion).
 */
export function compareForRanking(
  a: { totalScore: Decimal | number } & TieBreakInput,
  b: { totalScore: Decimal | number } & TieBreakInput,
): number {
  const scoreDiff = new Decimal(b.totalScore).sub(a.totalScore).toNumber();
  if (scoreDiff !== 0) return scoreDiff;

  const aTime = a.submittedAt?.getTime() ?? Infinity;
  const bTime = b.submittedAt?.getTime() ?? Infinity;
  if (aTime !== bTime) return aTime - bTime;

  const aExec = a.tieBreakExecutionTimeMs ?? Infinity;
  const bExec = b.tieBreakExecutionTimeMs ?? Infinity;
  return aExec - bExec;
}
