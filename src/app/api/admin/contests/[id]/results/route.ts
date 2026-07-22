import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/guards";
import { getLeaderboard } from "@/lib/results";

export const runtime = "nodejs";

/** GET — ranked leaderboard for a contest (only participants in a final status are ranked). */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;

  const { id: contestId } = await ctx.params;
  const contest = await prisma.contest.findUnique({ where: { id: contestId }, select: { id: true } });
  if (!contest) {
    return NextResponse.json({ error: "Contest not found" }, { status: 404 });
  }

  return NextResponse.json({ leaderboard: await getLeaderboard(contestId) });
}
