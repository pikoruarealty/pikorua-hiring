import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin, requireCsrf, requestMeta } from "@/lib/auth/guards";
import { writeAudit } from "@/lib/audit";
import { parseCsv } from "@/lib/csv";
import {
  importRowSchema,
  isUsernameTaken,
  generateUniqueUsername,
} from "@/lib/participants";
import { Prisma } from "@/generated/prisma/client";
import { UserRole } from "@/generated/prisma/enums";

export const runtime = "nodejs";

const MAX_ROWS = 2000;

const bodySchema = z.object({
  csv: z.string().min(1).max(2_000_000),
});

// Map many header spellings to our canonical field names.
const HEADER_ALIASES: Record<string, "username" | "fullName" | "email" | "phone"> = {
  username: "username",
  user: "username",
  login: "username",
  fullname: "fullName",
  "full name": "fullName",
  full_name: "fullName",
  name: "fullName",
  email: "email",
  "e-mail": "email",
  mail: "email",
  phone: "phone",
  mobile: "phone",
  "phone number": "phone",
  contact: "phone",
};

interface Skipped {
  row: number;
  username?: string;
  reason: string;
}
interface Created {
  row: number;
  username: string;
  fullName: string | null;
  email: string | null;
}

/**
 * POST — bulk import participants from CSV. Per-row validation: duplicates
 * (in-file and against the DB) are skipped and reported, malformed rows report a
 * specific reason, and valid rows create dormant accounts (no password until you
 * Export credentials). One bad row never fails the whole batch.
 */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const csrf = await requireCsrf(admin);
  if (csrf) return csrf;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const rows = parseCsv(body.csv).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length === 0) {
    return NextResponse.json({ error: "The file has no rows." }, { status: 400 });
  }

  // First non-empty row is the header. Map columns to canonical fields.
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const colMap = header.map((h) => HEADER_ALIASES[h]);
  if (!colMap.some((c) => c === "username" || c === "fullName" || c === "email")) {
    return NextResponse.json(
      {
        error:
          "Could not find a recognizable header row. Expected columns: username, fullName, email, phone.",
      },
      { status: 400 },
    );
  }

  const dataRows = rows.slice(1);
  if (dataRows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Too many rows (${dataRows.length}). Limit is ${MAX_ROWS}.` },
      { status: 400 },
    );
  }

  const created: Created[] = [];
  const skipped: Skipped[] = [];
  const takenUsernames = new Set<string>();
  const seenEmails = new Set<string>();

  for (let i = 0; i < dataRows.length; i++) {
    const rowNum = i + 2; // 1-based, +1 for header
    const cells = dataRows[i];
    const record: Record<string, string> = {};
    colMap.forEach((field, idx) => {
      if (field) record[field] = (cells[idx] ?? "").trim();
    });

    const parsed = importRowSchema.safeParse(record);
    if (!parsed.success) {
      skipped.push({
        row: rowNum,
        username: record.username,
        reason: parsed.error.issues[0]?.message ?? "Invalid row",
      });
      continue;
    }
    const { username, fullName, email, phone } = parsed.data;

    // In-file duplicate email check (DB check happens on insert).
    if (email) {
      const key = email.toLowerCase();
      if (seenEmails.has(key)) {
        skipped.push({ row: rowNum, username, reason: `Duplicate email in file: ${email}` });
        continue;
      }
      seenEmails.add(key);
    }

    let finalUsername: string;
    if (username && username.length > 0) {
      // Explicit username: an admin chose it, so a collision is a real duplicate —
      // skip and report rather than silently renaming it.
      if (await isUsernameTaken(username, takenUsernames)) {
        skipped.push({
          row: rowNum,
          username,
          reason: "Username already exists.",
        });
        continue;
      }
      takenUsernames.add(username);
      finalUsername = username;
    } else {
      // No username given: system-assign a unique one.
      finalUsername = await generateUniqueUsername(takenUsernames);
    }

    try {
      const user = await prisma.user.create({
        data: {
          username: finalUsername,
          fullName: fullName ?? null,
          email: email ?? null,
          phone: phone ?? null,
          role: UserRole.PARTICIPANT,
          // Dormant until credentials are issued via Export.
          passwordHash: "pending",
        },
        select: { username: true, fullName: true, email: true },
      });
      created.push({
        row: rowNum,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const target = (err.meta?.target as string[] | undefined)?.join(", ");
        skipped.push({
          row: rowNum,
          username: finalUsername,
          reason: target?.includes("email")
            ? `Email already exists: ${email}`
            : "Username already exists.",
        });
        continue;
      }
      throw err;
    }
  }

  const { ip, userAgent } = await requestMeta();
  await writeAudit({
    actorUserId: admin.id,
    action: "BULK_IMPORT_PARTICIPANTS",
    targetType: "User",
    diff: {
      totalRows: dataRows.length,
      created: created.length,
      skipped: skipped.length,
      // Usernames only — never passwords.
      createdUsernames: created.map((c) => c.username),
    },
    ip,
    userAgent,
  });

  return NextResponse.json({
    summary: {
      totalRows: dataRows.length,
      created: created.length,
      skipped: skipped.length,
    },
    created,
    skipped,
  });
}
