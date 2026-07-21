import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

/**
 * Append-only audit trail. Every state-changing admin action writes one row —
 * ideally inside the same transaction as its mutation, so an audit entry and the
 * change it describes commit or roll back together. Pass a transaction client as
 * `client` to do so; defaults to the shared prisma client.
 *
 * `diff` is a before/after summary — NEVER put plaintext passwords or full hashes
 * in it. Credential-issuing actions log counts and usernames only.
 */
export interface AuditInput {
  actorUserId: string;
  action: string; // e.g. CREATE_PARTICIPANT, BULK_IMPORT_PARTICIPANTS, EXPORT_CREDENTIALS
  targetType: string; // e.g. User, Participant
  targetId?: string | null;
  diff?: Prisma.InputJsonValue;
  ip?: string | null;
  userAgent?: string | null;
}

type Client = Pick<typeof prisma, "auditLog">;

export async function writeAudit(
  input: AuditInput,
  client: Client = prisma,
): Promise<void> {
  await client.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      diff: input.diff,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}
