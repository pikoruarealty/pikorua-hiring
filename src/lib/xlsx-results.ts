import * as XLSX from "xlsx";
import type { ResultRow } from "@/lib/pdf-credentials";

/** Leaderboard export as a real .xlsx workbook, one sheet, same columns as the CSV/PDF exports. */
export function buildResultsXlsx(rows: ResultRow[]): Buffer {
  const sheet = XLSX.utils.json_to_sheet(
    rows.map((r) => ({
      Rank: r.rank,
      Name: r.fullName ?? "",
      Username: r.username,
      Score: r.totalScore,
      "Time (ms)": r.tieBreakExecutionTimeMs ?? "",
      Status: r.status,
    })),
  );
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Results");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
