import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin, requireCsrf, requestMeta } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";
import { updateContestSchema, isContestLocked } from "@/lib/contests";
import { ContestStatus } from "@/generated/prisma/enums";

export const runtime = "nodejs";

async function loadContest(id: string) {
  return prisma.contest.findUnique({
    where: { id },
    include: {
      contestQuestions: {
        orderBy: { order: "asc" },
        include: {
          question: {
            select: { id: true, type: true, title: true, defaultPoints: true },
          },
        },
      },
      _count: { select: { participants: true } },
    },
  });
}

/** GET — full contest detail incl. attached questions (ordered) and roster count. */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;

  const { id } = await ctx.params;
  const contest = await loadContest(id);
  if (!contest) {
    return NextResponse.json({ error: "Contest not found" }, { status: 404 });
  }
  return NextResponse.json({
    contest: { ...contest, locked: await isContestLocked(id) },
  });
}

/** PATCH — full content replace. Blocked once the contest's start time has passed. */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const csrf = await requireCsrf(admin);
  if (csrf) return csrf;

  const { id } = await ctx.params;
  const existing = await prisma.contest.findUnique({
    where: { id },
    select: { id: true, title: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Contest not found" }, { status: 404 });
  }
  if (await isContestLocked(id)) {
    return NextResponse.json(
      {
        error:
          "A participant has already entered this contest; it can no longer be edited.",
      },
      { status: 409 },
    );
  }

  let input: z.infer<typeof updateContestSchema>;
  try {
    input = updateContestSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const updated = await prisma.contest.update({
    where: { id },
    data: {
      title: input.title,
      description: input.description ?? null,
      instructions: input.instructions ?? null,
      visibility: input.visibility,
      startAt: input.startAt,
      endAt: input.endAt,
      durationMinutes: input.durationMinutes,
      resultsVisibleToParticipants: input.resultsVisibleToParticipants,
    },
    select: { id: true, title: true },
  });

  const { ip, userAgent } = await requestMeta();
  await writeAudit({
    actorUserId: admin.id,
    action: "UPDATE_CONTEST",
    targetType: "Contest",
    targetId: id,
    diff: { before: { title: existing.title }, after: { title: updated.title } },
    ip,
    userAgent,
  });

  return NextResponse.json({ contest: await loadContest(id) });
}

/** DELETE — hard-delete only while still a DRAFT (nothing to preserve yet). */
export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const csrf = await requireCsrf(admin);
  if (csrf) return csrf;

  const { id } = await ctx.params;
  const existing = await prisma.contest.findUnique({
    where: { id },
    select: { id: true, title: true, status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Contest not found" }, { status: 404 });
  }
  if (existing.status !== ContestStatus.DRAFT) {
    return NextResponse.json(
      {
        error:
          "Only a draft contest can be deleted. Unpublish it first if you need to remove it.",
      },
      { status: 409 },
    );
  }

  const { ip, userAgent } = await requestMeta();
  await prisma.$transaction(async (tx) => {
    await tx.contest.delete({ where: { id } });
    await writeAudit(
      {
        actorUserId: admin.id,
        action: "DELETE_CONTEST",
        targetType: "Contest",
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
