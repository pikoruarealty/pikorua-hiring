import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { UserRole } from "@/generated/prisma/enums";

/**
 * Session model: an opaque random token is sent to the client in an httpOnly
 * cookie; only its SHA-256 hash is stored in the DB, so a DB leak alone can't be
 * replayed as a live session. Single-active-session for PARTICIPANT is enforced
 * by snapshotting User.sessionVersion into the session and comparing on every
 * request (see validateSessionToken). Admins skip that check.
 */

export const SESSION_COOKIE = env.SESSION_COOKIE_NAME;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newRawToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface CreateSessionResult {
  rawToken: string;
  sessionId: string;
  expiresAt: Date;
}

/**
 * Create a session for a user. For PARTICIPANT, bumps User.sessionVersion first
 * so any previously-issued session is instantly invalidated (single active
 * session). ADMIN keeps its sessionVersion, allowing concurrent sessions.
 */
export async function createSession(
  userId: string,
  ip: string | null,
  userAgent: string | null,
): Promise<CreateSessionResult> {
  const rawToken = newRawToken();
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_SECONDS * 1000);

  const sessionId = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true, sessionVersion: true },
    });

    let sessionVersion = user.sessionVersion;
    if (user.role === UserRole.PARTICIPANT) {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { sessionVersion: { increment: 1 } },
        select: { sessionVersion: true },
      });
      sessionVersion = updated.sessionVersion;
    }

    const session = await tx.session.create({
      data: {
        userId,
        tokenHash: hashToken(rawToken),
        sessionVersion,
        ip,
        userAgent,
        expiresAt,
      },
      select: { id: true },
    });
    return session.id;
  });

  return { rawToken, sessionId, expiresAt };
}

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  username: string;
  email: string | null;
  fullName: string | null;
  sessionId: string;
}

/**
 * Validate a raw session token. Returns the user if the session is live,
 * unexpired, unrevoked, the account is active, and (for participants) the
 * session's sessionVersion still matches the user's current sessionVersion.
 * Otherwise returns null.
 */
export async function validateSessionToken(
  rawToken: string | undefined,
): Promise<AuthenticatedUser | null> {
  if (!rawToken) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: {
      user: {
        select: {
          id: true,
          role: true,
          username: true,
          email: true,
          fullName: true,
          isActive: true,
          sessionVersion: true,
        },
      },
    },
  });

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (!session.user.isActive) return null;

  // Single-active-session enforcement for participants.
  if (
    session.user.role === UserRole.PARTICIPANT &&
    session.sessionVersion !== session.user.sessionVersion
  ) {
    return null;
  }

  return {
    id: session.user.id,
    role: session.user.role,
    username: session.user.username,
    email: session.user.email,
    fullName: session.user.fullName,
    sessionId: session.id,
  };
}

/** Revoke a single session by raw token (logout). Idempotent. */
export async function revokeSessionByToken(rawToken: string): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
