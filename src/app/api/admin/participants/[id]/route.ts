import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin, requireCsrf, requestMeta } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";
import { patchParticipantSchema } from "@/lib/participants";
import { Prisma } from "@/generated/prisma/client";
import { UserRole } from "@/generated/prisma/enums";

export const runtime = "nodejs";

/** Load a PARTICIPANT by id, or null (never returns admins). */
async function loadParticipant(id: string) {
  return prisma.user.findFirst({
    where: { id, role: UserRole.PARTICIPANT },
    select: {
      id: true,
      username: true,
      fullName: true,
      email: true,
      phone: true,
      isActive: true,
      sessionVersion: true,
    },
  });
}

/** PATCH — edit profile fields / activation. Bumps sessionVersion on deactivate. */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const csrf = await requireCsrf(admin);
  if (csrf) return csrf;

  const { id } = await ctx.params;
  const existing = await loadParticipant(id);
  if (!existing) {
    return NextResponse.json({ error: "Participant not found" }, { status: 404 });
  }

  let input: z.infer<typeof patchParticipantSchema>;
  try {
    input = patchParticipantSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const data: Prisma.UserUpdateInput = {};
  if (input.fullName !== undefined) data.fullName = input.fullName ?? null;
  if (input.email !== undefined) data.email = input.email ?? null;
  if (input.phone !== undefined) data.phone = input.phone ?? null;
  if (input.isActive !== undefined) {
    data.isActive = input.isActive;
    // Deactivating must kill any live session immediately.
    if (input.isActive === false && existing.isActive) {
      data.sessionVersion = { increment: 1 };
    }
  }

  const { ip, userAgent } = await requestMeta();

  let updated;
  try {
    updated = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
        phone: true,
        isActive: true,
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A user with that email already exists." },
        { status: 409 },
      );
    }
    throw err;
  }

  await writeAudit({
    actorUserId: admin.id,
    action: "UPDATE_PARTICIPANT",
    targetType: "User",
    targetId: id,
    diff: {
      before: {
        fullName: existing.fullName,
        email: existing.email,
        phone: existing.phone,
        isActive: existing.isActive,
      },
      after: {
        fullName: updated.fullName,
        email: updated.email,
        phone: updated.phone,
        isActive: updated.isActive,
      },
    },
    ip,
    userAgent,
  });

  return NextResponse.json({ participant: updated });
}

/**
 * DELETE — hard-delete a participant only if they have no contest history
 * (deleting would orphan Attempt/ContestParticipant rows). Otherwise 409 with a
 * hint to deactivate instead (soft delete preserves historical results).
 */
export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const csrf = await requireCsrf(admin);
  if (csrf) return csrf;

  const { id } = await ctx.params;
  const existing = await prisma.user.findFirst({
    where: { id, role: UserRole.PARTICIPANT },
    select: {
      id: true,
      username: true,
      _count: { select: { contestParticipants: true } },
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Participant not found" }, { status: 404 });
  }
  if (existing._count.contestParticipants > 0) {
    return NextResponse.json(
      {
        error:
          "This participant has contest history and cannot be deleted. Deactivate them instead to preserve results.",
      },
      { status: 409 },
    );
  }

  const { ip, userAgent } = await requestMeta();
  await prisma.$transaction(async (tx) => {
    await tx.user.delete({ where: { id } });
    await writeAudit(
      {
        actorUserId: admin.id,
        action: "DELETE_PARTICIPANT",
        targetType: "User",
        targetId: id,
        diff: { username: existing.username },
        ip,
        userAgent,
      },
      tx,
    );
  });

  return NextResponse.json({ ok: true });
}
