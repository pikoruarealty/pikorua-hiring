import { NextResponse } from "next/server";
import { z } from "zod";
import { requireParticipant, requireCsrf, requestMeta } from "@/lib/auth/guards";
import { loadForParticipant, ensureNotExpired } from "@/lib/participant-contests";
import { recordProctoringEvent } from "@/lib/proctoring";
import { rateLimit } from "@/lib/rate-limit";
import { ParticipantStatus, ProctoringEventType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

export const runtime = "nodejs";

const bodySchema = z.object({
  eventType: z.nativeEnum(ProctoringEventType),
  clientTimestamp: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * POST — ingest one client-detected proctoring event. Best-effort defense in
 * depth (a determined participant can always tamper with client JS), so this
 * intentionally fails open on rate-limit: dropping an occasional event just
 * means one fewer data point, not a security hole, and a hard 429 here would
 * otherwise let a participant dodge the very trigger meant to auto-submit
 * them by spamming the endpoint.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await requireParticipant();
  if (user instanceof NextResponse) return user;
  const csrf = await requireCsrf(user);
  if (csrf) return csrf;

  const { id: contestId } = await ctx.params;
  const { contest, participant } = await loadForParticipant(contestId, user.id);
  if (!contest || !participant?.contestStartedAt) {
    return NextResponse.json({ error: "Contest not started" }, { status: 404 });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const rl = await rateLimit(`proctor:${participant.id}`, 20, 10);
  if (!rl.allowed) {
    return NextResponse.json({ action: "NONE", cumulativeCount: null, status: participant.status });
  }

  const current = await ensureNotExpired(contest, participant.id);
  if (current.status !== ParticipantStatus.IN_PROGRESS) {
    return NextResponse.json({ action: "NONE", cumulativeCount: null, status: current.status });
  }

  const { ip, userAgent } = await requestMeta();
  const result = await recordProctoringEvent({
    contestParticipantId: participant.id,
    eventType: parsed.eventType,
    clientTimestamp: parsed.clientTimestamp ? new Date(parsed.clientTimestamp) : null,
    ip,
    userAgent,
    metadata: parsed.metadata as Prisma.InputJsonValue | undefined,
  });

  return NextResponse.json(result);
}
