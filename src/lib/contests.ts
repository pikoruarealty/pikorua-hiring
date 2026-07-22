import { z } from "zod";
import { prisma } from "@/lib/db";
import { ContestVisibility, ContestStatus, UserRole } from "@/generated/prisma/enums";

/**
 * Contest domain rules: authoring schemas, the structural-lock window, and
 * the publish/unpublish state machine. All timestamps are accepted/stored as
 * UTC instants — IST is a display concern (see schema.prisma header); the
 * server clock (`new Date()`) is the single source of truth for "has this
 * contest started" everywhere below.
 */

const contestContentSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().max(5000).optional(),
    instructions: z.string().trim().max(20_000).optional(),
    visibility: z.enum(ContestVisibility),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    durationMinutes: z.coerce.number().int().min(1).max(24 * 60),
    resultsVisibleToParticipants: z.boolean().default(false),
  })
  .refine((c) => c.endAt > c.startAt, {
    message: "End time must be after start time.",
    path: ["endAt"],
  })
  .refine(
    (c) => c.durationMinutes * 60_000 <= c.endAt.getTime() - c.startAt.getTime(),
    {
      message: "Duration cannot exceed the contest's start–end window.",
      path: ["durationMinutes"],
    },
  );

export const createContestSchema = contestContentSchema;
export type CreateContestInput = z.infer<typeof createContestSchema>;

// Same shape for edits — full replace, only permitted pre-lock (see isContestLocked).
export const updateContestSchema = contestContentSchema;
export type UpdateContestInput = z.infer<typeof updateContestSchema>;

/**
 * Structural mutations (contest fields, attached questions, roster) are
 * locked once at least one participant has actually entered the contest
 * (`ContestParticipant.contestStartedAt` set by Phase 3's start flow) —
 * editing the question set or timing out from under a candidate mid-contest
 * would corrupt their attempt. This is deliberately NOT based on wall-clock
 * `startAt` alone: a contest whose start time has simply passed with nobody
 * having entered yet (e.g. it was never published in time, or an admin is
 * iterating on a test contest) must stay editable — locking on time alone
 * would permanently brick it with no recovery path. Publishing/unpublishing
 * status is tracked separately from this lock.
 */
export async function isContestLocked(contestId: string): Promise<boolean> {
  const started = await prisma.contestParticipant.findFirst({
    where: { contestId, contestStartedAt: { not: null } },
    select: { id: true },
  });
  return started !== null;
}

export const attachQuestionSchema = z.object({
  questionId: z.string().min(1),
  pointsOverride: z.coerce.number().min(0).max(100_000).optional(),
  hardLockSecondsOverride: z.coerce.number().int().min(30).max(24 * 3600).optional(),
  sectionLabel: z.string().trim().max(100).optional(),
});

export const reorderQuestionsSchema = z.object({
  order: z.array(z.string().min(1)).min(1),
});

export const addParticipantsSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(5000),
});

/**
 * Shared roster-insertion logic: validate candidate user ids are real
 * PARTICIPANT users, skip anyone already on the roster, insert the rest as
 * `INVITED`. Used by both the direct invite route
 * (`.../contests/[id]/participants`) and Phase 6's shortlist-into-contest
 * flow so the dedupe/validation rules never drift between the two callers.
 */
export async function inviteParticipants(contestId: string, userIds: string[]) {
  const validUsers = await prisma.user.findMany({
    where: { id: { in: userIds }, role: UserRole.PARTICIPANT },
    select: { id: true },
  });
  const validIds = new Set(validUsers.map((u) => u.id));
  const invalidCount = userIds.length - validIds.size;

  const existingRows = await prisma.contestParticipant.findMany({
    where: { contestId, userId: { in: [...validIds] } },
    select: { userId: true },
  });
  const alreadyInvited = new Set(existingRows.map((r) => r.userId));
  const toInvite = [...validIds].filter((id) => !alreadyInvited.has(id));

  if (toInvite.length > 0) {
    await prisma.contestParticipant.createMany({
      data: toInvite.map((userId) => ({ contestId, userId })),
    });
  }

  return {
    invited: toInvite.length,
    alreadyInvited: alreadyInvited.size,
    invalid: invalidCount,
  };
}

/**
 * Publish DRAFT -> SCHEDULED. Requires at least one attached question, and
 * (for INVITE_ONLY contests) at least one roster entry — an invite-only
 * contest nobody is invited to can never be entered.
 */
export async function assertPublishable(contestId: string): Promise<string | null> {
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    select: {
      status: true,
      visibility: true,
      _count: { select: { contestQuestions: true, participants: true } },
    },
  });
  if (!contest) return "Contest not found.";
  if (contest.status !== ContestStatus.DRAFT) {
    return "Only a draft contest can be published.";
  }
  if (contest._count.contestQuestions === 0) {
    return "Attach at least one question before publishing.";
  }
  if (
    contest.visibility === ContestVisibility.INVITE_ONLY &&
    contest._count.participants === 0
  ) {
    return "Invite at least one participant before publishing an invite-only contest.";
  }
  return null;
}
