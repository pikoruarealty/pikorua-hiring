import { prisma } from "@/lib/db";
import { finalizeSubmission } from "@/lib/participant-contests";
import { ParticipantStatus, ProctoringAction, ProctoringEventType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Server-side proctoring policy: every detected event is logged, but only
 * some count as strikes toward the 2-strike auto-submit+lockout. FOCUS_RETURN
 * is the "came back" companion to TAB_BLUR/VISIBILITY_HIDDEN/FULLSCREEN_EXIT —
 * it's informational for the timeline, not itself a violation.
 */
function isStrike(eventType: ProctoringEventType): boolean {
  return eventType !== ProctoringEventType.FOCUS_RETURN;
}

export interface RecordProctoringEventInput {
  contestParticipantId: string;
  eventType: ProctoringEventType;
  clientTimestamp: Date | null;
  ip: string | null;
  userAgent: string | null;
  metadata?: Prisma.InputJsonValue;
}

export interface RecordProctoringEventResult {
  action: ProctoringAction;
  cumulativeCount: number;
  status: ParticipantStatus;
}

/**
 * Ingest one proctoring event. Strike 1 -> WARNED (logged only). Strike 2 ->
 * AUTO_SUBMITTED action on the event row + LOCKED_OUT participant status,
 * scoring whatever was already saved (same aggregation as a normal submit).
 * Runs inside a transaction so the event row and any resulting lockout are
 * consistent with the cumulative count they report.
 */
export async function recordProctoringEvent(
  input: RecordProctoringEventInput,
): Promise<RecordProctoringEventResult> {
  return prisma.$transaction(async (tx) => {
    const participant = await tx.contestParticipant.findUniqueOrThrow({
      where: { id: input.contestParticipantId },
    });

    // Already terminal (submitted/timed out/locked out by a concurrent
    // request) — log the event for the record but take no further action.
    if (participant.status !== ParticipantStatus.IN_PROGRESS) {
      const count = await tx.proctoringEvent.count({
        where: { contestParticipantId: input.contestParticipantId },
      });
      await tx.proctoringEvent.create({
        data: {
          contestParticipantId: input.contestParticipantId,
          eventType: input.eventType,
          clientTimestamp: input.clientTimestamp,
          ip: input.ip,
          userAgent: input.userAgent,
          metadata: input.metadata,
          cumulativeCountAtEvent: count + 1,
          actionTaken: ProctoringAction.NONE,
        },
      });
      return { action: ProctoringAction.NONE, cumulativeCount: count + 1, status: participant.status };
    }

    const priorStrikes = isStrike(input.eventType)
      ? await tx.proctoringEvent.count({
          where: {
            contestParticipantId: input.contestParticipantId,
            eventType: { not: ProctoringEventType.FOCUS_RETURN },
          },
        })
      : 0;
    const strikeNumber = isStrike(input.eventType) ? priorStrikes + 1 : 0;

    const action =
      strikeNumber >= 2
        ? ProctoringAction.AUTO_SUBMITTED
        : strikeNumber === 1
          ? ProctoringAction.WARNED
          : ProctoringAction.NONE;

    const totalEvents = await tx.proctoringEvent.count({
      where: { contestParticipantId: input.contestParticipantId },
    });

    await tx.proctoringEvent.create({
      data: {
        contestParticipantId: input.contestParticipantId,
        eventType: input.eventType,
        clientTimestamp: input.clientTimestamp,
        ip: input.ip,
        userAgent: input.userAgent,
        metadata: input.metadata,
        cumulativeCountAtEvent: totalEvents + 1,
        actionTaken: action,
      },
    });

    let status: ParticipantStatus = participant.status;
    if (action === ProctoringAction.AUTO_SUBMITTED) {
      const finalized = await finalizeSubmission(
        input.contestParticipantId,
        "PROCTORING",
        `Proctoring violation (${input.eventType}, strike 2)`,
        tx,
      );
      status = finalized.status;
    }

    return { action, cumulativeCount: strikeNumber, status };
  });
}
