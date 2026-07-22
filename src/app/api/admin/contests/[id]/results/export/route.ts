import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin, requireCsrf, requestMeta } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { toCsv } from "@/lib/csv";
import { buildResultsPdf, type ResultRow } from "@/lib/pdf-credentials";
import { buildResultsXlsx } from "@/lib/xlsx-results";
import { getLeaderboard } from "@/lib/results";

export const runtime = "nodejs";

const bodySchema = z.object({
  format: z.enum(["csv", "xlsx", "pdf"]),
  contestParticipantIds: z.array(z.string().min(1)).optional(),
});

function toResultRow(row: Awaited<ReturnType<typeof getLeaderboard>>[number]): ResultRow {
  return {
    rank: row.rank,
    username: row.user.username,
    fullName: row.user.fullName,
    totalScore: row.totalScore,
    tieBreakExecutionTimeMs: row.tieBreakExecutionTimeMs,
    status: row.status,
  };
}

/**
 * POST — export the leaderboard as CSV/XLSX/PDF. Omitting
 * `contestParticipantIds` (or sending an empty array) exports every ranked
 * participant; otherwise only the selected rows. Rate-limited + audited,
 * mirroring the credentials export (`/api/admin/participants/export`).
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const csrf = await requireCsrf(admin);
  if (csrf) return csrf;

  const { id: contestId } = await ctx.params;
  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    select: { id: true, title: true },
  });
  if (!contest) {
    return NextResponse.json({ error: "Contest not found" }, { status: 404 });
  }

  const rl = await rateLimit(`results-export:${admin.id}`, 5, 60);
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

  const leaderboard = await getLeaderboard(contestId);
  const idSet = body.contestParticipantIds?.length
    ? new Set(body.contestParticipantIds)
    : null;
  const rows = idSet
    ? leaderboard.filter((r) => idSet.has(r.contestParticipantId))
    : leaderboard;

  if (rows.length === 0) {
    return NextResponse.json({ error: "No matching results to export." }, { status: 400 });
  }

  const { ip, userAgent } = await requestMeta();
  await writeAudit({
    actorUserId: admin.id,
    action: "EXPORT_RESULTS",
    targetType: "Contest",
    targetId: contestId,
    diff: { format: body.format, count: rows.length, scope: idSet ? "selected" : "all" },
    ip,
    userAgent,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const resultRows = rows.map(toResultRow);

  if (body.format === "csv") {
    const csv = toCsv([
      ["rank", "username", "fullName", "totalScore", "tieBreakExecutionTimeMs", "status"],
      ...resultRows.map((r) => [
        r.rank,
        r.username,
        r.fullName ?? "",
        r.totalScore,
        r.tieBreakExecutionTimeMs ?? "",
        r.status,
      ]),
    ]);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="results-${stamp}.csv"`,
        "cache-control": "no-store",
      },
    });
  }

  if (body.format === "xlsx") {
    const buf = buildResultsXlsx(resultRows);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="results-${stamp}.xlsx"`,
        "cache-control": "no-store",
      },
    });
  }

  const pdf = await buildResultsPdf(resultRows, { title: `Results — ${contest.title}` });
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="results-${stamp}.pdf"`,
      "cache-control": "no-store",
    },
  });
}
