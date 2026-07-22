import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireParticipant } from "@/lib/auth/guards";
import { contestPhase } from "@/lib/participant-contests";
import { ContestStatus, ContestVisibility } from "@/generated/prisma/enums";

export const runtime = "nodejs";

/** GET — contests this participant can see: OPEN + published, or INVITE_ONLY where invited. */
export async function GET() {
  const user = await requireParticipant();
  if (user instanceof NextResponse) return user;

  const contests = await prisma.contest.findMany({
    where: {
      status: { not: ContestStatus.DRAFT },
      OR: [
        { visibility: ContestVisibility.OPEN },
        {
          visibility: ContestVisibility.INVITE_ONLY,
          participants: { some: { userId: user.id } },
        },
      ],
    },
    select: {
      id: true,
      title: true,
      description: true,
      visibility: true,
      startAt: true,
      endAt: true,
      durationMinutes: true,
      participants: {
        where: { userId: user.id },
        select: { status: true, contestStartedAt: true, contestSubmittedAt: true },
      },
    },
    orderBy: { startAt: "asc" },
  });

  const now = new Date();
  return NextResponse.json({
    contests: contests.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      visibility: c.visibility,
      startAt: c.startAt,
      endAt: c.endAt,
      durationMinutes: c.durationMinutes,
      phase: contestPhase(c, now),
      participantStatus: c.participants[0]?.status ?? null,
    })),
  });
}
