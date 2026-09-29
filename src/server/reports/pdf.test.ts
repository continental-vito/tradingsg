import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { renderReportPdf, type ReportPdfInput } from "./pdf";

const summary: ReportPdfInput["summary"] = {
  competitionName: "Autumn 2026 Stock Challenge",
  companyName: "Example AG",
  weekLabel: "Week 40 results",
  periodStart: "2026-09-25",
  periodEnd: "2026-10-02",
  participantCount: 120,
  rankedCount: 118,
  leaderName: "Łukasz Wiśniewski",
  averageReturnPpm: 12_345,
  bestReturnPpm: 98_765,
  worstReturnPpm: -54_321,
  aumCents: "1200000000",
  daysRemaining: 42,
  currency: "EUR",
};

function input(names: string[]): ReportPdfInput {
  return {
    summary,
    isoWeek: "2026-W40",
    revision: 1,
    introMessage: "A strong week — well done → everyone.",
    showLeaderboard: true,
    showIndividual: true,
    leaderboardSize: 10,
    rows: names.map((name, i) => ({
      rank: i === names.length - 1 ? null : i + 1,
      name,
      totalValueCents: 10_000_000n - BigInt(i) * 1_000n,
      weeklyReturnPpm: 5_000 - i * 100,
      totalReturnPpm: 20_000 - i * 300,
      bestSymbol: i % 3 === 0 ? null : "SAP",
      worstSymbol: "BMW",
    })),
  };
}

describe("renderReportPdf", () => {
  it("does not fail on names the standard PDF fonts cannot encode", async () => {
    // Helvetica only encodes WinAnsi and pdf-lib throws on anything else, so
    // a single Polish, Greek or Chinese name would make every download fail.
    const pdf = await renderReportPdf(
      input(["Łukasz Wiśniewski", "王伟", "Γιώργος", "Zoë O'Brien", "Emoji 🚀 Fan"]),
    );
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
  });

  it("breaks a long participant list across pages instead of running off the bottom", async () => {
    // Drawing below the margin raises no error, it silently loses rows — so
    // the only proof every participant is printed is that pages were added.
    const names = Array.from({ length: 120 }, (_, i) => `Participant ${i + 1}`);
    const pdf = await renderReportPdf(input(names));
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(3);
  });
});
