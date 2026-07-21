import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

/**
 * Server-side PDF generation for one-time credential handouts. Uses pdf-lib
 * (pure JS, no native deps or headless browser) so it bundles cleanly in the
 * Next.js server runtime. Produces a simple paginated table of login credentials.
 */

export interface Credential {
  username: string;
  password: string;
  fullName?: string | null;
  email?: string | null;
}

const PAGE = { w: 595.28, h: 841.89 }; // A4 portrait, points
const MARGIN = 48;
const ROW_H = 22;
const HEADER_H = 26;

const COLUMNS = [
  { key: "fullName" as const, label: "Name", width: 130 },
  { key: "username" as const, label: "Username", width: 120 },
  { key: "password" as const, label: "Password", width: 150 },
  { key: "email" as const, label: "Email", width: 99 },
];

/** Truncate a string to fit a column width at a given font size. */
function fit(font: PDFFont, text: string, size: number, maxW: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxW) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > maxW) {
    t = t.slice(0, -1);
  }
  return t + "…";
}

export async function buildCredentialsPdf(
  credentials: Credential[],
  opts: { title?: string; note?: string } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);

  const title = opts.title ?? "Participant Login Credentials";
  const note =
    opts.note ??
    "Confidential. Distribute privately. Passwords are shown once and cannot be recovered — only re-issued.";
  const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 16);

  const contentW = PAGE.w - MARGIN * 2;
  const ink = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.42, 0.42, 0.46);
  const line = rgb(0.82, 0.82, 0.85);
  const headerBg = rgb(0.95, 0.95, 0.97);

  let page = doc.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - MARGIN;

  const drawTableHeader = () => {
    page.drawRectangle({
      x: MARGIN,
      y: y - HEADER_H,
      width: contentW,
      height: HEADER_H,
      color: headerBg,
    });
    let x = MARGIN + 6;
    for (const col of COLUMNS) {
      page.drawText(col.label, {
        x,
        y: y - HEADER_H + 8,
        size: 9,
        font: bold,
        color: muted,
      });
      x += col.width;
    }
    y -= HEADER_H;
  };

  const drawPageChrome = (isFirst: boolean) => {
    if (isFirst) {
      page.drawText(title, { x: MARGIN, y, size: 18, font: bold, color: ink });
      y -= 22;
      page.drawText(`Generated ${generatedAt} UTC · ${credentials.length} participants`, {
        x: MARGIN,
        y,
        size: 9,
        font,
        color: muted,
      });
      y -= 16;
      for (const lineText of wrap(font, note, 9, contentW)) {
        page.drawText(lineText, { x: MARGIN, y, size: 9, font, color: muted });
        y -= 12;
      }
      y -= 8;
    }
    drawTableHeader();
  };

  drawPageChrome(true);

  credentials.forEach((c, idx) => {
    if (y - ROW_H < MARGIN + 20) {
      page = doc.addPage([PAGE.w, PAGE.h]);
      y = PAGE.h - MARGIN;
      drawPageChrome(false);
    }
    // Zebra striping for readability.
    if (idx % 2 === 1) {
      page.drawRectangle({
        x: MARGIN,
        y: y - ROW_H,
        width: contentW,
        height: ROW_H,
        color: rgb(0.985, 0.985, 0.99),
      });
    }
    let x = MARGIN + 6;
    for (const col of COLUMNS) {
      const raw = (c[col.key] ?? "") as string;
      const useMono = col.key === "username" || col.key === "password";
      const f = useMono ? mono : font;
      const size = useMono ? 9 : 9;
      page.drawText(fit(f, raw, size, col.width - 10), {
        x,
        y: y - ROW_H + 7,
        size,
        font: f,
        color: col.key === "password" ? ink : ink,
      });
      x += col.width;
    }
    page.drawLine({
      start: { x: MARGIN, y: y - ROW_H },
      end: { x: MARGIN + contentW, y: y - ROW_H },
      thickness: 0.5,
      color: line,
    });
    y -= ROW_H;
  });

  return doc.save();
}

/** Greedy word-wrap for the note line. */
function wrap(font: PDFFont, text: string, size: number, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const trial = current ? `${current} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) > maxW && current) {
      lines.push(current);
      current = w;
    } else {
      current = trial;
    }
  }
  if (current) lines.push(current);
  return lines;
}
