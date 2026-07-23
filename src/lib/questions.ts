import { z } from "zod";
import { prisma } from "@/lib/db";
import { QuestionType, QuestionDifficulty } from "@/generated/prisma/enums";
import { SUPPORTED_LANGUAGES } from "@/lib/languages";

/**
 * Question-bank domain rules: zod schemas for authoring MCQ / TEXT / CODING
 * questions, and the sane-range checks called out in the brief (coding time
 * 1–15s, memory 16–512MB). Options/test cases are replace-all on edit — see
 * `canEditQuestion` for the guard against mutating a question already
 * attached to a non-DRAFT contest.
 */

export const CODING_TIME_LIMIT_RANGE = { min: 1, max: 15 } as const;
export const CODING_MEMORY_LIMIT_RANGE = { min: 16, max: 512 } as const;

const title = z.string().trim().min(3).max(200);
const body = z.string().trim().min(1).max(20_000);
const tags = z.array(z.string().trim().min(1).max(40)).max(20).default([]);
const difficulty = z.enum(QuestionDifficulty).optional();
const points = z.coerce.number().min(0).max(100_000);

const optionInput = z.object({
  text: z.string().trim().min(1).max(2000),
  score: z.coerce.number().min(-1000).max(1000),
  order: z.coerce.number().int().min(0).default(0),
  isCorrect: z.boolean().default(false),
});

const mcqQuestionSchema = z
  .object({
    type: z.literal(QuestionType.MCQ),
    title,
    body,
    difficulty,
    tags,
    defaultPoints: points,
    allowMultipleAnswers: z.boolean().default(true),
    options: z
      .array(optionInput)
      .min(2, "MCQ questions need at least 2 options.")
      .max(20),
  })
  .refine(
    (q) => q.allowMultipleAnswers || q.options.filter((o) => o.score > 0).length <= 1,
    {
      message: "A single-answer question can have at most one option with a positive score.",
      path: ["options"],
    },
  );

const textQuestionSchema = z.object({
  type: z.literal(QuestionType.TEXT),
  title,
  body,
  difficulty,
  tags,
  defaultPoints: points,
  correctAnswer: z.string().trim().min(1).max(500),
});

const testCaseInput = z.object({
  input: z.string().max(50_000).default(""),
  expectedOutput: z.string().max(50_000),
  isSample: z.boolean().default(false),
  score: z.coerce.number().min(0).max(1000),
  order: z.coerce.number().int().min(0).default(0),
});

const codingConfigInput = z.object({
  timeLimitSeconds: z.coerce
    .number()
    .int()
    .min(CODING_TIME_LIMIT_RANGE.min)
    .max(CODING_TIME_LIMIT_RANGE.max),
  memoryLimitMb: z.coerce
    .number()
    .int()
    .min(CODING_MEMORY_LIMIT_RANGE.min)
    .max(CODING_MEMORY_LIMIT_RANGE.max),
  allowedLanguages: z
    .array(z.enum(SUPPORTED_LANGUAGES))
    .min(1, "Select at least one allowed language."),
  // Per-language starter/boilerplate shown in the editor, e.g. { python: "..." }.
  starterCode: z.record(z.string(), z.string().max(10_000)).optional(),
  // Contest-facing default hard-lock seconds; a contest may override per attach.
  defaultHardLockSeconds: z.coerce.number().int().min(30).max(24 * 3600).optional(),
  // Admin-only reference solution, never sent to participants.
  solutionCode: z.record(z.string(), z.string().max(20_000)).optional(),
});

const codingQuestionSchema = z.object({
  type: z.literal(QuestionType.CODING),
  title,
  body,
  difficulty,
  tags,
  codingConfig: codingConfigInput,
  testCases: z
    .array(testCaseInput)
    .min(1, "At least one test case is required.")
    .max(200)
    .refine((cases) => cases.some((c) => c.isSample), {
      message: "At least one test case must be marked sample (used by Run).",
    }),
});

export const createQuestionSchema = z.discriminatedUnion("type", [
  mcqQuestionSchema,
  textQuestionSchema,
  codingQuestionSchema,
]);
export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;

// Edit uses the same per-type shape (replace-all for options/test cases) plus
// isArchived toggling, which is handled separately (no content required).
export const updateQuestionSchema = createQuestionSchema;
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;

export const archiveQuestionSchema = z.object({
  isArchived: z.boolean(),
});

/**
 * A question already attached to a non-DRAFT contest is locked against
 * structural edits (options/test cases/config) so it can't silently rescore
 * a contest a candidate has already started. Cosmetic edits (title/body/tags)
 * still go through the same route today — full-block is the simple, safe
 * default; split it into "edit metadata only" if that friction is a problem.
 */
export async function canEditQuestion(questionId: string): Promise<boolean> {
  const inLiveContest = await prisma.contestQuestion.findFirst({
    where: {
      questionId,
      contest: { status: { not: "DRAFT" } },
    },
    select: { id: true },
  });
  return inLiveContest === null;
}

/** Sum of test-case scores — the real ceiling for a CODING question. */
export function codingTotalScore(testCases: { score: number }[]): number {
  return testCases.reduce((acc, t) => acc + t.score, 0);
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Insert the type-specific children (options / text config / coding config+cases). */
async function createQuestionContent(
  tx: Tx,
  questionId: string,
  input: CreateQuestionInput,
): Promise<void> {
  if (input.type === QuestionType.MCQ) {
    await tx.option.createMany({
      data: input.options.map((o, i) => ({
        questionId,
        text: o.text,
        score: o.score,
        order: o.order ?? i,
        isCorrect: o.isCorrect,
      })),
    });
  } else if (input.type === QuestionType.TEXT) {
    await tx.textAnswerConfig.create({
      data: { questionId, correctAnswer: input.correctAnswer },
    });
  } else {
    const config = await tx.codingQuestionConfig.create({
      data: {
        questionId,
        timeLimitSeconds: input.codingConfig.timeLimitSeconds,
        memoryLimitMb: input.codingConfig.memoryLimitMb,
        allowedLanguages: input.codingConfig.allowedLanguages,
        starterCode: input.codingConfig.starterCode ?? undefined,
        defaultHardLockSeconds: input.codingConfig.defaultHardLockSeconds ?? null,
        solutionCode: input.codingConfig.solutionCode ?? undefined,
      },
    });
    await tx.testCase.createMany({
      data: input.testCases.map((t, i) => ({
        codingConfigId: config.id,
        input: t.input,
        expectedOutput: t.expectedOutput,
        isSample: t.isSample,
        score: t.score,
        order: t.order ?? i,
      })),
    });
  }
}

/** Create a question and its type-specific children in one transaction. */
export async function createQuestion(
  input: CreateQuestionInput,
  createdById: string,
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const question = await tx.question.create({
      data: {
        type: input.type,
        title: input.title,
        body: input.body,
        difficulty: input.difficulty ?? null,
        tags: input.tags,
        defaultPoints:
          input.type === QuestionType.CODING
            ? codingTotalScore(input.testCases)
            : input.defaultPoints,
        allowMultipleAnswers: input.type === QuestionType.MCQ ? input.allowMultipleAnswers : true,
        createdById,
      },
      select: { id: true },
    });
    await createQuestionContent(tx, question.id, input);
    return question.id;
  });
}

/**
 * Replace a question's content in place (title/body/tags/type-specific
 * children). The question's `type` cannot change — callers must reject that
 * before calling this (create a new question instead).
 */
export async function replaceQuestionContent(
  questionId: string,
  input: UpdateQuestionInput,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.option.deleteMany({ where: { questionId } });
    await tx.textAnswerConfig.deleteMany({ where: { questionId } });
    // Deleting the config cascades its TestCase rows (onDelete: Cascade).
    await tx.codingQuestionConfig.deleteMany({ where: { questionId } });

    await tx.question.update({
      where: { id: questionId },
      data: {
        title: input.title,
        body: input.body,
        difficulty: input.difficulty ?? null,
        tags: input.tags,
        defaultPoints:
          input.type === QuestionType.CODING
            ? codingTotalScore(input.testCases)
            : input.defaultPoints,
        allowMultipleAnswers: input.type === QuestionType.MCQ ? input.allowMultipleAnswers : true,
      },
    });
    await createQuestionContent(tx, questionId, input);
  });
}
