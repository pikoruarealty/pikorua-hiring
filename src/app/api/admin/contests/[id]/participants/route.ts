import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin, requireCsrf, requestMeta } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";
import { addParticipantsSchema, inviteParticipants, isContestLocked } from "@/lib/contests";
import { ContestVisibility } from "@/generated/prisma/enums";

export const runtime = "nodejs";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** GET — the contest's invite roster (paginated). */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;

  const { id: contestId } = await ctx.params;
  const url = new URL(request.url);
  const parsed = listQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }
  const { page, pageSize } = parsed.data;

  const [total, roster] = await Promise.all([
    prisma.contestParticipant.count({ where: { contestId } }),
    prisma.contestParticipant.findMany({
      where: { contestId },
      select: {
        id: true,
        status: true,
        invitedAt: true,
        user: { select: { id: true, username: true, fullName: true, email: true } },
      },
      orderBy: { invitedAt: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    roster,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}

/**
 * POST — bulk-invite participants by id (INVITE_ONLY contests only; an OPEN
 * contest has no explicit roster). Duplicates are skipped, not errored.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const csrf = await requireCsrf(admin);
  if (csrf) return csrf;

  const { id: contestId } = await ctx.params;
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    select: { id: true, visibility: true },
  });
  if (!contest) {
    return NextResponse.json({ error: "Contest not found" }, { status: 404 });
  }
  if (contest.visibility !== ContestVisibility.INVITE_ONLY) {
    return NextResponse.json(
      { error: "Only invite-only contests maintain an explicit roster." },
      { status: 400 },
    );
  }
  if (await isContestLocked(contestId)) {
    return NextResponse.json(
      {
        error:
          "A participant has already entered this contest; its roster is locked.",
      },
      { status: 409 },
    );
  }

  let input: z.infer<typeof addParticipantsSchema>;
  try {
    input = addParticipantsSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const result = await inviteParticipants(contestId, input.userIds);

  const { ip, userAgent } = await requestMeta();
  await writeAudit({
    actorUserId: admin.id,
    action: "INVITE_CONTEST_PARTICIPANTS",
    targetType: "Contest",
    targetId: contestId,
    diff: result,
    ip,
    userAgent,
  });

  return NextResponse.json(result);
}

/** DELETE — remove a participant from the roster via ?userId=, if they haven't started. */
export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const csrf = await requireCsrf(admin);
  if (csrf) return csrf;

  const { id: contestId } = await ctx.params;
  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId query param is required." }, { status: 400 });
  }

  const existing = await prisma.contestParticipant.findUnique({
    where: { contestId_userId: { contestId, userId } },
    select: { id: true, contestStartedAt: true, user: { select: { username: true } } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Participant is not on this roster." }, { status: 404 });
  }
  if (existing.contestStartedAt) {
    return NextResponse.json(
      { error: "This participant has already started the contest and cannot be removed." },
      { status: 409 },
    );
  }

  const { ip, userAgent } = await requestMeta();
  await prisma.$transaction(async (tx) => {
    await tx.contestParticipant.delete({ where: { id: existing.id } });
    await writeAudit(
      {
        actorUserId: admin.id,
        action: "REMOVE_CONTEST_PARTICIPANT",
        targetType: "Contest",
        targetId: contestId,
        diff: { username: existing.user.username },
        ip,
        userAgent,
      },
      tx,
    );
  });

  return NextResponse.json({ ok: true });
}
