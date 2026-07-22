import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin, requireCsrf, requestMeta } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";
import {
  attachQuestionSchema,
  reorderQuestionsSchema,
  isContestLocked,
} from "@/lib/contests";
import { Prisma } from "@/generated/prisma/client";

export const runtime = "nodejs";

async function loadLockableContest(id: string) {
  return prisma.contest.findUnique({
    where: { id },
    select: { id: true, title: true },
  });
}

/** POST — attach a bank question to this contest (appended to the end). */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const csrf = await requireCsrf(admin);
  if (csrf) return csrf;

  const { id: contestId } = await ctx.params;
  const contest = await loadLockableContest(contestId);
  if (!contest) {
    return NextResponse.json({ error: "Contest not found" }, { status: 404 });
  }
  if (await isContestLocked(contestId)) {
    return NextResponse.json(
      {
        error:
          "A participant has already entered this contest; its question set is locked.",
      },
      { status: 409 },
    );
  }

  let input: z.infer<typeof attachQuestionSchema>;
  try {
    input = attachQuestionSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const question = await prisma.question.findUnique({
    where: { id: input.questionId },
    select: { id: true, title: true, isArchived: true },
  });
  if (!question) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }
  if (question.isArchived) {
    return NextResponse.json(
      { error: "Cannot attach an archived question." },
      { status: 400 },
    );
  }

  const count = await prisma.contestQuestion.count({ where: { contestId } });

  let contestQuestion;
  try {
    contestQuestion = await prisma.contestQuestion.create({
      data: {
        contestId,
        questionId: input.questionId,
        order: count,
        pointsOverride: input.pointsOverride ?? null,
        hardLockSecondsOverride: input.hardLockSecondsOverride ?? null,
        sectionLabel: input.sectionLabel ?? null,
      },
      select: { id: true },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "This question is already attached to the contest." },
        { status: 409 },
      );
    }
    throw err;
  }

  const { ip, userAgent } = await requestMeta();
  await writeAudit({
    actorUserId: admin.id,
    action: "ATTACH_CONTEST_QUESTION",
    targetType: "Contest",
    targetId: contestId,
    diff: { questionId: question.id, questionTitle: question.title },
    ip,
    userAgent,
  });

  return NextResponse.json({ id: contestQuestion.id }, { status: 201 });
}

/** PATCH — bulk reorder: `{ order: [contestQuestionId, ...] }` in the new order. */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const csrf = await requireCsrf(admin);
  if (csrf) return csrf;

  const { id: contestId } = await ctx.params;
  const contest = await loadLockableContest(contestId);
  if (!contest) {
    return NextResponse.json({ error: "Contest not found" }, { status: 404 });
  }
  if (await isContestLocked(contestId)) {
    return NextResponse.json(
      {
        error:
          "A participant has already entered this contest; its question set is locked.",
      },
      { status: 409 },
    );
  }

  let input: z.infer<typeof reorderQuestionsSchema>;
  try {
    input = reorderQuestionsSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const existing = await prisma.contestQuestion.findMany({
    where: { contestId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  if (
    input.order.length !== existing.length ||
    !input.order.every((id) => existingIds.has(id))
  ) {
    return NextResponse.json(
      { error: "Order list must contain exactly the contest's current questions." },
      { status: 400 },
    );
  }

  await prisma.$transaction(
    input.order.map((cqId, index) =>
      prisma.contestQuestion.update({
        where: { id: cqId },
        data: { order: index },
      }),
    ),
  );

  return NextResponse.json({ ok: true });
}

/** DELETE — detach a question via ?contestQuestionId=. */
export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const csrf = await requireCsrf(admin);
  if (csrf) return csrf;

  const { id: contestId } = await ctx.params;
  const contest = await loadLockableContest(contestId);
  if (!contest) {
    return NextResponse.json({ error: "Contest not found" }, { status: 404 });
  }
  if (await isContestLocked(contestId)) {
    return NextResponse.json(
      {
        error:
          "A participant has already entered this contest; its question set is locked.",
      },
      { status: 409 },
    );
  }

  const cqId = new URL(request.url).searchParams.get("contestQuestionId");
  if (!cqId) {
    return NextResponse.json(
      { error: "contestQuestionId query param is required." },
      { status: 400 },
    );
  }
  const existing = await prisma.contestQuestion.findFirst({
    where: { id: cqId, contestId },
    select: { id: true, question: { select: { title: true } } },
  });
  if (!existing) {
    return NextResponse.json(
      { error: "Question is not attached to this contest." },
      { status: 404 },
    );
  }

  const { ip, userAgent } = await requestMeta();
  await prisma.$transaction(async (tx) => {
    await tx.contestQuestion.delete({ where: { id: cqId } });
    await writeAudit(
      {
        actorUserId: admin.id,
        action: "DETACH_CONTEST_QUESTION",
        targetType: "Contest",
        targetId: contestId,
        diff: { questionTitle: existing.question.title },
        ip,
        userAgent,
      },
      tx,
    );
  });

  return NextResponse.json({ ok: true });
}
