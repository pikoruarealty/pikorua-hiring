import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin, requireCsrf, requestMeta } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";
import {
  createParticipantSchema,
  issueCredential,
  PARTICIPANT_WHERE,
} from "@/lib/participants";
import { Prisma } from "@/generated/prisma/client";
import { UserRole } from "@/generated/prisma/enums";

export const runtime = "nodejs";

const listQuerySchema = z.object({
  query: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  active: z.enum(["all", "active", "inactive"]).default("all"),
});

/** GET — paginated, searchable participant list. Never returns password data. */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;

  const url = new URL(request.url);
  const parsed = listQuerySchema.safeParse(
    Object.fromEntries(url.searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }
  const { query, page, pageSize, active } = parsed.data;

  const where: Prisma.UserWhereInput = { ...PARTICIPANT_WHERE };
  if (active !== "all") where.isActive = active === "active";
  if (query) {
    where.OR = [
      { username: { contains: query, mode: "insensitive" } },
      { fullName: { contains: query, mode: "insensitive" } },
      { email: { contains: query, mode: "insensitive" } },
    ];
  }

  const [total, participants] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
        phone: true,
        isActive: true,
        createdAt: true,
        _count: { select: { contestParticipants: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    participants: participants.map((p) => ({
      id: p.id,
      username: p.username,
      fullName: p.fullName,
      email: p.email,
      phone: p.phone,
      isActive: p.isActive,
      createdAt: p.createdAt,
      contestCount: p._count.contestParticipants,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}

/**
 * POST — create a single participant. Issues a credential and returns the
 * plaintext password ONCE (create-time reveal); it cannot be retrieved later.
 */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const csrf = await requireCsrf(admin);
  if (csrf) return csrf;

  let input: z.infer<typeof createParticipantSchema>;
  try {
    input = createParticipantSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { ip, userAgent } = await requestMeta();

  let user;
  try {
    user = await prisma.user.create({
      data: {
        username: input.username,
        fullName: input.fullName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        role: UserRole.PARTICIPANT,
        // Placeholder hash; replaced immediately by issueCredential below.
        passwordHash: "pending",
      },
      select: { id: true, username: true, fullName: true, email: true },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const target = (err.meta?.target as string[] | undefined)?.join(", ");
      return NextResponse.json(
        {
          error: target?.includes("email")
            ? "A user with that email already exists."
            : "That username is already taken.",
        },
        { status: 409 },
      );
    }
    throw err;
  }

  const credential = await issueCredential(user.id);
  await writeAudit({
    actorUserId: admin.id,
    action: "CREATE_PARTICIPANT",
    targetType: "User",
    targetId: user.id,
    diff: { username: user.username, fullName: user.fullName, email: user.email },
    ip,
    userAgent,
  });

  return NextResponse.json(
    {
      participant: user,
      credential: { username: user.username, password: credential.password },
    },
    { status: 201 },
  );
}
