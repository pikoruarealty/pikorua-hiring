import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { getParticipantDrilldown } from "@/lib/results";

export const runtime = "nodejs";

/**
 * GET — full admin drill-down for one participant: per-question answers/
 * code with unredacted (sample + hidden) test-case results, and the
 * proctoring event timeline. No redaction — this is the admin view.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string; contestParticipantId: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;

  const { id: contestId, contestParticipantId } = await ctx.params;
  const drilldown = await getParticipantDrilldown(contestId, contestParticipantId);
  if (!drilldown) {
    return NextResponse.json({ error: "Participant not found in this contest" }, { status: 404 });
  }

  return NextResponse.json(drilldown);
}
