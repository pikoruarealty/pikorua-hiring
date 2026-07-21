import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin, requireCsrf, requestMeta } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { toCsv } from "@/lib/csv";
import { buildCredentialsPdf, type Credential } from "@/lib/pdf-credentials";
import { issueCredential, PARTICIPANT_WHERE } from "@/lib/participants";

export const runtime = "nodejs";

const MAX_EXPORT = 2000;

const bodySchema = z
  .object({
    format: z.enum(["csv", "pdf"]),
    scope: z.enum(["selected", "all"]).default("selected"),
    participantIds: z.array(z.string().min(1)).max(MAX_EXPORT).optional(),
    active: z.enum(["all", "active", "inactive"]).default("all"),
  })
  .refine((b) => b.scope === "all" || (b.participantIds?.length ?? 0) > 0, {
    message: "Select at least one participant to export.",
  });

/**
 * POST — export login credentials as CSV or PDF. Because only password *hashes*
 * are stored, exporting RE-ISSUES a fresh password for each participant (the old
 * one stops working). This is the one-time credential delivery step. Rate-limited
 * and audited (usernames + counts only — never passwords).
 */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const csrf = await requireCsrf(admin);
  if (csrf) return csrf;

  // Rate limit credential exports per admin (they reset passwords).
  const rl = await rateLimit(`export:${admin.id}`, 5, 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many exports. Try again shortly." },
      { status: 429, headers: { "retry-after": String(rl.resetSeconds) } },
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Invalid request" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const where =
    body.scope === "all"
      ? {
          ...PARTICIPANT_WHERE,
          ...(body.active !== "all" ? { isActive: body.active === "active" } : {}),
        }
      : { ...PARTICIPANT_WHERE, id: { in: body.participantIds! } };

  const participants = await prisma.user.findMany({
    where,
    select: { id: true, username: true, fullName: true, email: true },
    orderBy: { username: "asc" },
    take: MAX_EXPORT,
  });

  if (participants.length === 0) {
    return NextResponse.json(
      { error: "No matching participants to export." },
      { status: 400 },
    );
  }

  // Re-issue a password for each participant. Sequential — argon2 is CPU-bound
  // and we cap the batch, so this stays bounded.
  const credentials: Credential[] = [];
  for (const p of participants) {
    const { password } = await issueCredential(p.id);
    credentials.push({
      username: p.username,
      password,
      fullName: p.fullName,
      email: p.email,
    });
  }

  const { ip, userAgent } = await requestMeta();
  await writeAudit({
    actorUserId: admin.id,
    action: "EXPORT_CREDENTIALS",
    targetType: "User",
    diff: {
      format: body.format,
      scope: body.scope,
      count: credentials.length,
      // Usernames only, never passwords.
      usernames: credentials.map((c) => c.username),
    },
    ip,
    userAgent,
  });

  const stamp = new Date().toISOString().slice(0, 10);

  if (body.format === "csv") {
    const csv = toCsv([
      ["username", "password", "fullName", "email"],
      ...credentials.map((c) => [c.username, c.password, c.fullName ?? "", c.email ?? ""]),
    ]);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="credentials-${stamp}.csv"`,
        "cache-control": "no-store",
      },
    });
  }

  const pdf = await buildCredentialsPdf(credentials);
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="credentials-${stamp}.pdf"`,
      "cache-control": "no-store",
    },
  });
}
