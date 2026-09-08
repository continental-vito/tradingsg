import { formatCents, formatPpm } from "@/server/money";

/**
 * The weekly report email, as a string.
 *
 * Table-based layout with inline styles, because that is what email clients
 * actually render. Outlook has no flexbox, no grid, and ignores most of a
 * <style> block; a beautiful email built the way a web page is built arrives as
 * a column of unstyled text.
 *
 * Colours are inlined literals rather than CSS variables for the same reason —
 * var() is not supported in the clients that matter, and a colour that resolves
 * to nothing makes a gain and a loss look identical.
 */

const INK = "#151b26";
const MUTED = "#677186";
const BORDER = "#d7dbe3";
const SURFACE = "#ffffff";
const SUNKEN = "#f6f7f9";
const ACCENT = "#3b5bdb";
const UP = "#0d8449";
const DOWN = "#b82f2f";

// Declared on every block that contains text, not once on a wrapper. Email
// clients do not reliably inherit font-family through table cells, and Outlook
// substitutes Times for anything it cannot resolve — which is how a carefully
// built email arrives looking like a legal notice.
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export interface ReportLeaderRow {
  rank: number;
  name: string;
  valueCents: string;
  totalReturnPpm: number;
  weeklyReturnPpm: number;
  isYou: boolean;
}

export interface ReportPersonal {
  firstName: string;
  rank: number | null;
  rankChange: number | null;
  isRanked: boolean;
  valueCents: string;
  weeklyReturnPpm: number;
  totalReturnPpm: number;
  weeklyPnlCents: string;
  totalPnlCents: string;
  best: { symbol: string; returnPpm: number; contributionCents: string } | null;
  worst: { symbol: string; returnPpm: number; contributionCents: string } | null;
}

export interface ReportSummary {
  competitionName: string;
  companyName: string;
  weekLabel: string;
  periodStart: string;
  periodEnd: string;
  participantCount: number;
  rankedCount: number;
  leaderName: string;
  averageReturnPpm: number;
  bestReturnPpm: number;
  worstReturnPpm: number;
  aumCents: string;
  daysRemaining: number;
  currency: string;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tone(ppm: number): string {
  return ppm > 0 ? UP : ppm < 0 ? DOWN : MUTED;
}

function money(cents: string, currency: string): string {
  return formatCents(BigInt(cents), currency);
}

function medal(rank: number): string {
  return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : String(rank);
}

/** The leaderboard table and competition stats — identical for every recipient. */
export function renderShared(
  summary: ReportSummary,
  leaders: ReportLeaderRow[],
  showLeaderboard: boolean,
): string {
  const stats = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;font-family:${FONT}">
      <tr>
        ${[
          ["Participants", String(summary.participantCount)],
          ["Average return", formatPpm(summary.averageReturnPpm)],
          ["Best return", formatPpm(summary.bestReturnPpm)],
          ["Days left", String(summary.daysRemaining)],
        ]
          .map(
            ([label, value]) => `
        <td width="25%" style="padding:12px 8px;background:${SUNKEN};border-radius:8px;text-align:center">
          <div style="font-size:11px;color:${MUTED};margin-bottom:4px">${esc(label ?? "")}</div>
          <div style="font-size:18px;font-weight:600;color:${INK}">${esc(value ?? "")}</div>
        </td>
        <td width="8"></td>`,
          )
          .join("")}
      </tr>
    </table>`;

  if (!showLeaderboard) return stats;

  const rows = leaders
    .map(
      (row) => `
      <tr style="${row.isYou ? `background:#eef3ff;` : ""}">
        <td style="padding:10px 12px;border-bottom:1px solid ${BORDER};font-size:14px;color:${INK};white-space:nowrap">${medal(row.rank)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid ${BORDER};font-size:14px;color:${INK};font-weight:${row.isYou ? 600 : 400}">
          ${esc(row.name)}${row.isYou ? ' <span style="font-size:11px;color:' + ACCENT + '">(you)</span>' : ""}
        </td>
        <td align="right" style="padding:10px 12px;border-bottom:1px solid ${BORDER};font-size:14px;font-weight:600;color:${tone(row.totalReturnPpm)}">${formatPpm(row.totalReturnPpm)}</td>
        <td align="right" style="padding:10px 12px;border-bottom:1px solid ${BORDER};font-size:14px;color:${tone(row.weeklyReturnPpm)}">${formatPpm(row.weeklyReturnPpm)}</td>
        <td align="right" style="padding:10px 12px;border-bottom:1px solid ${BORDER};font-size:14px;color:${INK};white-space:nowrap">${money(row.valueCents, summary.currency)}</td>
      </tr>`,
    )
    .join("");

  return `${stats}
    <h2 style="margin:0 0 12px;font-size:16px;font-weight:600;color:${INK};font-family:${FONT}">🏆 Weekly leaderboard</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 24px;font-family:${FONT}">
      <tr>
        <th align="left" style="padding:0 12px 8px;font-size:11px;font-weight:500;color:${MUTED}">#</th>
        <th align="left" style="padding:0 12px 8px;font-size:11px;font-weight:500;color:${MUTED}">Participant</th>
        <th align="right" style="padding:0 12px 8px;font-size:11px;font-weight:500;color:${MUTED}">Total</th>
        <th align="right" style="padding:0 12px 8px;font-size:11px;font-weight:500;color:${MUTED}">This week</th>
        <th align="right" style="padding:0 12px 8px;font-size:11px;font-weight:500;color:${MUTED}">Value</th>
      </tr>
      ${rows}
    </table>`;
}

/** The personalised section plus the shared block, assembled into one email. */
export function renderEmail(args: {
  summary: ReportSummary;
  personal: ReportPersonal | null;
  sharedHtml: string;
  introMessage: string | null;
  appUrl: string;
  showIndividual: boolean;
}): { html: string; text: string } {
  const { summary, personal, sharedHtml, introMessage, appUrl, showIndividual } = args;

  const movement =
    personal?.rankChange == null
      ? ""
      : personal.rankChange > 0
        ? `, up ${personal.rankChange} place${personal.rankChange === 1 ? "" : "s"} from last week`
        : personal.rankChange < 0
          ? `, down ${Math.abs(personal.rankChange)} place${personal.rankChange === -1 ? "" : "s"} from last week`
          : ", unchanged from last week";

  const personalBlock =
    showIndividual && personal
      ? personal.isRanked
        ? `
      <div style="padding:20px;background:${SUNKEN};border-radius:10px;margin:0 0 24px;font-family:${FONT}">
        <p style="margin:0 0 12px;font-size:15px;color:${INK}">Hi ${esc(personal.firstName)},</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:${INK}">
          This week your portfolio
          <strong style="color:${tone(personal.weeklyReturnPpm)}">${personal.weeklyReturnPpm >= 0 ? "gained" : "lost"} ${formatPpm(Math.abs(personal.weeklyReturnPpm))}</strong>,
          bringing your total competition return to
          <strong style="color:${tone(personal.totalReturnPpm)}">${formatPpm(personal.totalReturnPpm)}</strong>.
          You are currently ranked <strong>#${personal.rank}</strong>${movement}.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td width="50%" style="padding:8px 0"><span style="font-size:12px;color:${MUTED}">Portfolio value</span><br>
              <strong style="font-size:16px;color:${INK}">${money(personal.valueCents, summary.currency)}</strong></td>
            <td width="50%" style="padding:8px 0"><span style="font-size:12px;color:${MUTED}">This week</span><br>
              <strong style="font-size:16px;color:${tone(personal.weeklyReturnPpm)}">${money(personal.weeklyPnlCents, summary.currency)}</strong></td>
          </tr>
          ${
            personal.best || personal.worst
              ? `<tr>
            <td style="padding:8px 0"><span style="font-size:12px;color:${MUTED}">Best holding</span><br>
              ${
                personal.best
                  ? `<strong style="font-size:15px;color:${INK}">${esc(personal.best.symbol)}</strong>
                     <span style="color:${tone(personal.best.returnPpm)};font-size:14px">${formatPpm(personal.best.returnPpm)}</span>`
                  : `<span style="color:${MUTED}">—</span>`
              }</td>
            <td style="padding:8px 0"><span style="font-size:12px;color:${MUTED}">Worst holding</span><br>
              ${
                personal.worst
                  ? `<strong style="font-size:15px;color:${INK}">${esc(personal.worst.symbol)}</strong>
                     <span style="color:${tone(personal.worst.returnPpm)};font-size:14px">${formatPpm(personal.worst.returnPpm)}</span>`
                  : `<span style="color:${MUTED}">—</span>`
              }</td>
          </tr>`
              : ""
          }
        </table>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0 0">
          <tr><td style="background:${ACCENT};border-radius:8px">
            <a href="${esc(appUrl)}/dashboard" style="display:inline-block;padding:11px 20px;font-size:14px;font-weight:500;color:#ffffff;text-decoration:none">View my portfolio</a>
          </td></tr>
        </table>
      </div>`
        : `
      <div style="padding:20px;background:${SUNKEN};border-radius:10px;margin:0 0 24px;font-family:${FONT}">
        <p style="margin:0 0 12px;font-size:15px;color:${INK}">Hi ${esc(personal.firstName)},</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:${INK}">
          You have not built your portfolio yet, so you are not on the leaderboard — an uninvested
          portfolio is exactly flat, and ranking that mid-table would put it ahead of everyone who
          is down. There are <strong>${summary.daysRemaining} days</strong> left to join in.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr><td style="background:${ACCENT};border-radius:8px">
            <a href="${esc(appUrl)}/portfolio/allocate" style="display:inline-block;padding:11px 20px;font-size:14px;font-weight:500;color:#ffffff;text-decoration:none">Build my portfolio</a>
          </td></tr>
        </table>
      </div>`
      : "";

  const html = `<div style="margin:0;padding:0;background:${SUNKEN};font-family:${FONT}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SUNKEN};padding:24px 12px;font-family:${FONT}">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:${SURFACE};border-radius:14px;border:1px solid ${BORDER};font-family:${FONT}">
        <tr><td style="padding:28px 28px 0;font-family:${FONT}">
          <p style="margin:0;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${ACCENT}">${esc(summary.companyName)} Stock Challenge</p>
          <h1 style="margin:6px 0 4px;font-size:22px;font-weight:600;color:${INK}">${esc(summary.weekLabel)}</h1>
          <p style="margin:0 0 20px;font-size:13px;color:${MUTED}">${esc(summary.periodStart)} to ${esc(summary.periodEnd)} · ${esc(summary.competitionName)}</p>
          ${introMessage ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:${INK}">${esc(introMessage)}</p>` : ""}
          ${personalBlock}
          ${sharedHtml}
        </td></tr>
        <tr><td style="padding:0 28px 28px;font-family:${FONT}">
          <p style="margin:0;padding-top:16px;border-top:1px solid ${BORDER};font-size:12px;line-height:1.5;color:${MUTED}">
            Every euro in this competition is virtual. Nothing is bought, nothing is sold, and
            nothing here is investment advice.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</div>`;

  const text = [
    `${summary.companyName} Stock Challenge — ${summary.weekLabel}`,
    `${summary.periodStart} to ${summary.periodEnd}`,
    "",
    ...(personal && showIndividual
      ? personal.isRanked
        ? [
            `Hi ${personal.firstName},`,
            `This week your portfolio ${personal.weeklyReturnPpm >= 0 ? "gained" : "lost"} ${formatPpm(Math.abs(personal.weeklyReturnPpm))}, bringing your total return to ${formatPpm(personal.totalReturnPpm)}.`,
            `You are ranked #${personal.rank}${movement}.`,
            `Portfolio value: ${money(personal.valueCents, summary.currency)}`,
            "",
          ]
        : [
            `Hi ${personal.firstName},`,
            `You have not built your portfolio yet. ${summary.daysRemaining} days left to join in.`,
            "",
          ]
      : []),
    `Leader: ${summary.leaderName}`,
    `Average return: ${formatPpm(summary.averageReturnPpm)}`,
    `Participants: ${summary.participantCount}`,
    "",
    `View your portfolio: ${appUrl}/dashboard`,
    "",
    "Virtual capital only. Nothing here is investment advice.",
  ].join("\n");

  return { html, text };
}
