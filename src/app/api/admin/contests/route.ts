import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin, requireCsrf, requestMeta } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";
import { createContestSchema } from "@/lib/contests";
import { ContestStatus, ContestVisibility } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

export const runtime = "nodejs";

const listQuerySchema = z.object({
  query: z.string().trim().max(200).optional(),
  status: z.enum(ContestStatus).optional(),
  visibility: z.enum(ContestVisibility).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** GET — paginated, searchable contest list. */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;

  const url = new URL(request.url);
  const parsed = listQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }
  const { query, status, visibility, page, pageSize } = parsed.data;

  const where: Prisma.ContestWhereInput = {};
  if (status) where.status = status;
  if (visibility) where.visibility = visibility;
  if (query) where.title = { contains: query, mode: "insensitive" };

  const [total, contests] = await Promise.all([
    prisma.contest.count({ where }),
    prisma.contest.findMany({
      where,
      select: {
        id: true,
        title: true,
        visibility: true,
        status: true,
        startAt: true,
        endAt: true,
        durationMinutes: true,
        createdAt: true,
        _count: { select: { contestQuestions: true, participants: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    contests: contests.map((c) => ({
      ...c,
      questionCount: c._count.contestQuestions,
      participantCount: c._count.participants,
      _count: undefined,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}

/** POST — create a DRAFT contest. Questions/roster/publish happen via sub-routes. */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const csrf = await requireCsrf(admin);
  if (csrf) return csrf;

  let input: z.infer<typeof createContestSchema>;
  try {
    input = createContestSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const contest = await prisma.contest.create({
    data: {
      title: input.title,
      description: input.description ?? null,
      instructions: input.instructions ?? null,
      visibility: input.visibility,
      startAt: input.startAt,
      endAt: input.endAt,
      durationMinutes: input.durationMinutes,
      resultsVisibleToParticipants: input.resultsVisibleToParticipants,
      status: ContestStatus.DRAFT,
      createdById: admin.id,
    },
    select: { id: true, title: true, status: true },
  });

  const { ip, userAgent } = await requestMeta();
  await writeAudit({
    actorUserId: admin.id,
    action: "CREATE_CONTEST",
    targetType: "Contest",
    targetId: contest.id,
    diff: { title: contest.title },
    ip,
    userAgent,
  });

  return NextResponse.json({ contest }, { status: 201 });
}
