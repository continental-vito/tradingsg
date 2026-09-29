import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { formatCents, formatPpm } from "@/server/money";
import type { ReportSummary } from "./template";

/**
 * The weekly report as a downloadable PDF.
 *
 * pdf-lib rather than a headless browser: Chromium does not fit in a Vercel
 * function without a separate binary layer, and the report is a few tables —
 * it does not need a layout engine, it needs to always work.
 *
 * Built from the frozen report rows, never from live prices, for the same
 * reason the email was: the PDF must say what the leaderboard said that week.
 */

export interface ReportPdfRow {
  rank: number | null;
  name: string;
  totalValueCents: bigint;
  weeklyReturnPpm: number;
  totalReturnPpm: number;
  bestSymbol: string | null;
  worstSymbol: string | null;
}

export interface ReportPdfInput {
  summary: ReportSummary;
  isoWeek: string;
  revision: number;
  introMessage: string | null;
  showLeaderboard: boolean;
  showIndividual: boolean;
  leaderboardSize: number;
  rows: ReportPdfRow[];
}

const INK = rgb(0.082, 0.106, 0.149);
const MUTED = rgb(0.404, 0.443, 0.525);
const BORDER = rgb(0.843, 0.859, 0.89);
const SUNKEN = rgb(0.965, 0.969, 0.976);
const UP = rgb(0.051, 0.518, 0.286);
const DOWN = rgb(0.722, 0.184, 0.184);

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

function tone(ppm: number) {
  return ppm > 0 ? UP : ppm < 0 ? DOWN : MUTED;
}

/**
 * The standard PDF fonts only encode WinAnsi, and pdf-lib THROWS on anything
 * else — so one colleague named Łukasz or 王伟 would make the whole download
 * fail. Accents are stripped where that leaves a readable letter; anything
 * still unencodable becomes "?" rather than taking the report down.
 */
function makeSanitizer(font: PDFFont) {
  const supported = new Set(font.getCharacterSet());
  const fallback: Record<string, string> = {
    "−": "-",
    "→": "->",
    " ": " ",
    " ": " ",
    Ł: "L",
    ł: "l",
    Đ: "D",
    đ: "d",
  };
  return (text: string): string =>
    Array.from(text)
      .map((ch) => {
        if (supported.has(ch.codePointAt(0) ?? 0)) return ch;
        if (fallback[ch]) return fallback[ch];
        const stripped = ch.normalize("NFD").replace(/\p{M}/gu, "");
        return stripped && Array.from(stripped).every((c) => supported.has(c.codePointAt(0) ?? 0))
          ? stripped
          : "?";
      })
      .join("");
}

interface Column {
  label: string;
  width: number;
  align: "left" | "right";
}

export async function renderReportPdf(input: ReportPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const clean = makeSanitizer(regular);
  const { summary } = input;
  const money = (cents: bigint | string) => formatCents(BigInt(cents), summary.currency);

  doc.setTitle(clean(`${summary.competitionName} — ${input.isoWeek}`));
  doc.setAuthor(clean(summary.companyName));
  doc.setCreator("TradingSG");

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  };
  const ensure = (height: number) => {
    if (y - height < MARGIN) newPage();
  };

  // Truncated to fit rather than overflowing into the next column: a long
  // display name must not push a return figure off the edge of the page.
  const fit = (text: string, font: PDFFont, size: number, width: number) => {
    let t = clean(text);
    if (font.widthOfTextAtSize(t, size) <= width) return t;
    while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1);
    return `${t}...`;
  };

  const text = (
    value: string,
    x: number,
    opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {},
  ) => {
    page.drawText(clean(value), {
      x,
      y,
      font: opts.font ?? regular,
      size: opts.size ?? 10,
      color: opts.color ?? INK,
    });
  };

  const wrap = (value: string, font: PDFFont, size: number, width: number): string[] => {
    const lines: string[] = [];
    for (const paragraph of clean(value).split(/\r?\n/)) {
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > width && line) {
          lines.push(line);
          line = word;
        } else {
          line = next;
        }
      }
      lines.push(line);
    }
    return lines;
  };

  // ── Header ───────────────────────────────────────────────────────────────
  text(summary.companyName.toUpperCase(), MARGIN, { size: 9, color: MUTED, font: bold });
  y -= 22;
  text(summary.competitionName, MARGIN, { size: 18, font: bold });
  y -= 18;
  text(
    `${summary.weekLabel} · ${summary.periodStart} to ${summary.periodEnd}` +
      (input.revision > 1 ? ` · revision ${input.revision}` : ""),
    MARGIN,
    { size: 10, color: MUTED },
  );
  y -= 24;

  if (input.introMessage) {
    for (const line of wrap(input.introMessage, regular, 10, CONTENT_W)) {
      ensure(14);
      text(line, MARGIN, { size: 10 });
      y -= 14;
    }
    y -= 10;
  }

  // ── Summary tiles ────────────────────────────────────────────────────────
  const tiles: { label: string; value: string; color?: ReturnType<typeof rgb> }[] = [
    { label: "Leader", value: summary.leaderName },
    {
      label: "Average return",
      value: formatPpm(summary.averageReturnPpm),
      color: tone(summary.averageReturnPpm),
    },
    {
      label: "Best / worst",
      value: `${formatPpm(summary.bestReturnPpm)} / ${formatPpm(summary.worstReturnPpm)}`,
    },
    {
      label: "Participants",
      value: `${summary.rankedCount} of ${summary.participantCount} ranked`,
    },
    { label: "Total portfolio value", value: money(summary.aumCents) },
    { label: "Days remaining", value: String(summary.daysRemaining) },
  ];
  const tileW = (CONTENT_W - 16) / 3;
  const tileH = 44;
  for (let i = 0; i < tiles.length; i += 3) {
    ensure(tileH + 8);
    tiles.slice(i, i + 3).forEach((tile, j) => {
      const x = MARGIN + j * (tileW + 8);
      page.drawRectangle({
        x,
        y: y - tileH,
        width: tileW,
        height: tileH,
        color: SUNKEN,
        borderColor: BORDER,
        borderWidth: 0.5,
      });
      page.drawText(fit(tile.label, regular, 8, tileW - 16), {
        x: x + 8,
        y: y - 14,
        size: 8,
        font: regular,
        color: MUTED,
      });
      page.drawText(fit(tile.value, bold, 11, tileW - 16), {
        x: x + 8,
        y: y - 32,
        size: 11,
        font: bold,
        color: tile.color ?? INK,
      });
    });
    y -= tileH + 8;
  }
  y -= 16;

  // ── Tables ───────────────────────────────────────────────────────────────
  const table = (
    title: string,
    columns: Column[],
    rows: { cells: string[]; colors?: (ReturnType<typeof rgb> | undefined)[] }[],
  ) => {
    const rowH = 18;
    const drawHead = () => {
      page.drawLine({
        start: { x: MARGIN, y: y - 5 },
        end: { x: MARGIN + CONTENT_W, y: y - 5 },
        thickness: 0.5,
        color: BORDER,
      });
      let x = MARGIN;
      for (const col of columns) {
        const label = fit(col.label, bold, 8, col.width - 6);
        const w = bold.widthOfTextAtSize(label, 8);
        text(label, col.align === "right" ? x + col.width - w - 3 : x + 3, {
          font: bold,
          size: 8,
          color: MUTED,
        });
        x += col.width;
      }
      y -= rowH;
    };

    ensure(28 + rowH * 2);
    text(title, MARGIN, { font: bold, size: 12 });
    y -= 20;
    drawHead();

    rows.forEach((row, index) => {
      if (y - rowH < MARGIN) {
        newPage();
        drawHead();
      }
      if (index % 2 === 1) {
        page.drawRectangle({
          x: MARGIN,
          y: y - 5,
          width: CONTENT_W,
          height: rowH,
          color: SUNKEN,
        });
      }
      let x = MARGIN;
      columns.forEach((col, i) => {
        const value = fit(row.cells[i] ?? "", regular, 9, col.width - 6);
        const w = regular.widthOfTextAtSize(value, 9);
        text(value, col.align === "right" ? x + col.width - w - 3 : x + 3, {
          size: 9,
          color: row.colors?.[i] ?? INK,
        });
        x += col.width;
      });
      y -= rowH;
    });
    y -= 20;
  };

  const ranked = input.rows.filter((r) => r.rank !== null);

  if (input.showLeaderboard) {
    table(
      `Top ${Math.min(input.leaderboardSize, ranked.length)}`,
      [
        { label: "Rank", width: 40, align: "left" },
        { label: "Participant", width: CONTENT_W - 40 - 110 - 90 - 90, align: "left" },
        { label: "Value", width: 110, align: "right" },
        { label: "This week", width: 90, align: "right" },
        { label: "Total", width: 90, align: "right" },
      ],
      ranked.slice(0, input.leaderboardSize).map((r) => ({
        cells: [
          String(r.rank),
          r.name,
          money(r.totalValueCents),
          formatPpm(r.weeklyReturnPpm),
          formatPpm(r.totalReturnPpm),
        ],
        colors: [undefined, undefined, undefined, tone(r.weeklyReturnPpm), tone(r.totalReturnPpm)],
      })),
    );
  }

  if (input.showIndividual) {
    table(
      `All participants (${input.rows.length})`,
      [
        { label: "Rank", width: 36, align: "left" },
        { label: "Participant", width: CONTENT_W - 36 - 90 - 62 - 62 - 62 - 62, align: "left" },
        { label: "Value", width: 90, align: "right" },
        { label: "This week", width: 62, align: "right" },
        { label: "Total", width: 62, align: "right" },
        { label: "Best", width: 62, align: "right" },
        { label: "Worst", width: 62, align: "right" },
      ],
      input.rows.map((r) => ({
        cells: [
          r.rank === null ? "-" : String(r.rank),
          r.name,
          money(r.totalValueCents),
          formatPpm(r.weeklyReturnPpm),
          formatPpm(r.totalReturnPpm),
          r.bestSymbol ?? "-",
          r.worstSymbol ?? "-",
        ],
        colors: [
          undefined,
          undefined,
          undefined,
          tone(r.weeklyReturnPpm),
          tone(r.totalReturnPpm),
          r.bestSymbol ? UP : MUTED,
          r.worstSymbol ? DOWN : MUTED,
        ],
      })),
    );
  }

  // ── Footer on every page ─────────────────────────────────────────────────
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const footer = clean(
      `${summary.competitionName} · ${input.isoWeek} · page ${i + 1} of ${pages.length}`,
    );
    p.drawText(footer, { x: MARGIN, y: MARGIN / 2, size: 8, font: regular, color: MUTED });
  });

  return doc.save();
}
