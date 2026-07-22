import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin, requireCsrf, requestMeta } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";
import {
  updateQuestionSchema,
  archiveQuestionSchema,
  replaceQuestionContent,
  canEditQuestion,
} from "@/lib/questions";

export const runtime = "nodejs";

async function loadQuestion(id: string) {
  return prisma.question.findUnique({
    where: { id },
    include: {
      options: { orderBy: { order: "asc" } },
      textAnswerConfig: true,
      codingConfig: { include: { testCases: { orderBy: { order: "asc" } } } },
      _count: { select: { contestQuestions: true } },
    },
  });
}

/** GET — full question detail (options/testcases included) for the edit form. */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;

  const { id } = await ctx.params;
  const question = await loadQuestion(id);
  if (!question) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }
  return NextResponse.json({ question });
}

/**
 * PATCH — either `{ isArchived }` (always allowed) or a full content replace
 * matching the create shape (blocked once the question is attached to a
 * non-DRAFT contest, and the question's `type` cannot change).
 */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const csrf = await requireCsrf(admin);
  if (csrf) return csrf;

  const { id } = await ctx.params;
  const existing = await prisma.question.findUnique({
    where: { id },
    select: { id: true, type: true, title: true, isArchived: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  const body: unknown = await request.json();
  const { ip, userAgent } = await requestMeta();

  // Archive/unarchive: a narrow, always-safe toggle distinct from content edits.
  if (
    typeof body === "object" &&
    body !== null &&
    "isArchived" in body &&
    Object.keys(body).length === 1
  ) {
    const parsed = archiveQuestionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const updated = await prisma.question.update({
      where: { id },
      data: { isArchived: parsed.data.isArchived },
      select: { id: true, isArchived: true },
    });
    await writeAudit({
      actorUserId: admin.id,
      action: parsed.data.isArchived ? "ARCHIVE_QUESTION" : "UNARCHIVE_QUESTION",
      targetType: "Question",
      targetId: id,
      diff: { title: existing.title },
      ip,
      userAgent,
    });
    return NextResponse.json({ question: updated });
  }

  // Full content replace.
  let input: z.infer<typeof updateQuestionSchema>;
  try {
    input = updateQuestionSchema.parse(body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (input.type !== existing.type) {
    return NextResponse.json(
      { error: "A question's type cannot be changed. Create a new question instead." },
      { status: 400 },
    );
  }
  if (!(await canEditQuestion(id))) {
    return NextResponse.json(
      {
        error:
          "This question is attached to a published contest and can no longer be edited. Archive it and create a new version instead.",
      },
      { status: 409 },
    );
  }

  await replaceQuestionContent(id, input);
  await writeAudit({
    actorUserId: admin.id,
    action: "UPDATE_QUESTION",
    targetType: "Question",
    targetId: id,
    diff: { before: { title: existing.title }, after: { title: input.title } },
    ip,
    userAgent,
  });

  const question = await loadQuestion(id);
  return NextResponse.json({ question });
}

/** DELETE — hard-delete only if never attached to a contest; else 409 (archive instead). */
export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const csrf = await requireCsrf(admin);
  if (csrf) return csrf;

  const { id } = await ctx.params;
  const existing = await prisma.question.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      _count: { select: { contestQuestions: true } },
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }
  if (existing._count.contestQuestions > 0) {
    return NextResponse.json(
      {
        error:
          "This question is used in one or more contests and cannot be deleted. Archive it instead.",
      },
      { status: 409 },
    );
  }

  const { ip, userAgent } = await requestMeta();
  await prisma.$transaction(async (tx) => {
    await tx.question.delete({ where: { id } });
    await writeAudit(
      {
        actorUserId: admin.id,
        action: "DELETE_QUESTION",
        targetType: "Question",
        targetId: id,
        diff: { title: existing.title },
        ip,
        userAgent,
      },
      tx,
    );
  });

  return NextResponse.json({ ok: true });
}
