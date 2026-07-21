/**
 * Minimal RFC-4180-ish CSV utilities. Hand-rolled to avoid a dependency for what
 * is a small, well-scoped need (participant import/export). Handles quoted
 * fields, embedded commas/newlines, and escaped double-quotes ("").
 */

/** Parse CSV text into an array of string-cell rows. Empty input → []. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  // Strip a UTF-8 BOM if present (Excel loves adding one).
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      pushField();
      i++;
      continue;
    }
    if (c === "\r") {
      // Handle CRLF and lone CR as row terminators.
      pushRow();
      if (text[i + 1] === "\n") i++;
      i++;
      continue;
    }
    if (c === "\n") {
      pushRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Flush trailing field/row unless the input ended on a clean newline with no
  // pending content.
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }
  return rows;
}

/** Quote a single CSV cell if it contains a comma, quote, or newline. */
function quoteCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Serialize rows of cells to CSV text. Prepends a UTF-8 BOM so Excel opens
 * UTF-8 correctly. Uses CRLF line endings per the spec.
 */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const body = rows
    .map((r) => r.map((c) => quoteCell(c == null ? "" : String(c))).join(","))
    .join("\r\n");
  return `﻿${body}\r\n`;
}
