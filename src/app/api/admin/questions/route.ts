import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin, requireCsrf, requestMeta } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";
import { createQuestionSchema, createQuestion } from "@/lib/questions";
import { QuestionType, QuestionDifficulty } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

export const runtime = "nodejs";

const listQuerySchema = z.object({
  query: z.string().trim().max(200).optional(),
  type: z.enum(QuestionType).optional(),
  difficulty: z.enum(QuestionDifficulty).optional(),
  archived: z.enum(["all", "active", "archived"]).default("active"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** GET — paginated, searchable question bank list (metadata only, no options/testcases). */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;

  const url = new URL(request.url);
  const parsed = listQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }
  const { query, type, difficulty, archived, page, pageSize } = parsed.data;

  const where: Prisma.QuestionWhereInput = {};
  if (archived !== "all") where.isArchived = archived === "archived";
  if (type) where.type = type;
  if (difficulty) where.difficulty = difficulty;
  if (query) {
    where.OR = [
      { title: { contains: query, mode: "insensitive" } },
      { tags: { has: query } },
    ];
  }

  const [total, questions] = await Promise.all([
    prisma.question.count({ where }),
    prisma.question.findMany({
      where,
      select: {
        id: true,
        type: true,
        title: true,
        difficulty: true,
        tags: true,
        defaultPoints: true,
        isArchived: true,
        createdAt: true,
        _count: { select: { contestQuestions: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    questions: questions.map((q) => ({
      ...q,
      contestCount: q._count.contestQuestions,
      _count: undefined,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}

/** POST — author a new MCQ / TEXT / CODING question in the reusable bank. */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const csrf = await requireCsrf(admin);
  if (csrf) return csrf;

  let input: z.infer<typeof createQuestionSchema>;
  try {
    input = createQuestionSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const questionId = await createQuestion(input, admin.id);

  const { ip, userAgent } = await requestMeta();
  await writeAudit({
    actorUserId: admin.id,
    action: "CREATE_QUESTION",
    targetType: "Question",
    targetId: questionId,
    diff: { type: input.type, title: input.title },
    ip,
    userAgent,
  });

  return NextResponse.json({ id: questionId }, { status: 201 });
}
