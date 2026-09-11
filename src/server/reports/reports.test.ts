import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, seedCompetition, seedParticipant } from "@/test/db";
import { commitRebalance } from "@/server/portfolio/commit";
import { snapshotLeaderboard } from "@/server/jobs/leaderboard";
import { snapshotValuations } from "@/server/jobs/valuations";
import { buildWeeklyReport, ReportError } from "./generate";
import { sendWeeklyReport } from "./send";

let db: PrismaClient;
let cleanup: () => Promise<void>;
let competitionId: string;
let alice: Awaited<ReturnType<typeof seedParticipant>>;

const DAY_ONE = "2026-07-24";
const DAY_TWO = "2026-07-31";
const ctx = () => ({ db, runKey: "test", log: () => {} });

beforeAll(async () => {
  // EMAIL_PROVIDER and EMAIL_OUTBOX_DIR come from vitest.config.mts — env.ts
  // parses process.env at import, so setting them here would be too late.
  const t = await createTestDb();
  db = t.db;
  cleanup = t.cleanup;

  const competition = await seedCompetition(db);
  competitionId = competition.id;
  await db.competitionSettings.create({
    data: { competitionId, revision: 1, maxPositionPpm: 1_000_000 },
  });

  const stock = await db.stock.create({ data: { symbol: "AAPL", name: "Apple" } });
  await db.competitionStock.create({ data: { competitionId, stockId: stock.id } });
  await db.priceHistory.createMany({
    data: [
      { stockId: stock.id, tradeDate: DAY_ONE, closeCents: 20_000n, revision: 1 },
      { stockId: stock.id, tradeDate: DAY_TWO, closeCents: 24_000n, revision: 1 },
    ],
  });

  alice = await seedParticipant(db, competitionId, "alice@example.com");
  await seedParticipant(db, competitionId, "idle@example.com");

  await commitRebalance(db, {
    portfolioId: alice.portfolio.id,
    targets: [{ stockId: stock.id, weightPpm: 1_000_000 }],
    idempotencyKey: "alice-report",
    periodKey: null,
    asOfDate: DAY_ONE,
  });

  for (const day of [DAY_ONE, DAY_TWO]) {
    await snapshotValuations(ctx(), { competitionId, asOfDate: day });
    await snapshotLeaderboard(ctx(), { competitionId, asOfDate: day, kind: "WEEKLY" });
  }
}, 90_000);

afterAll(async () => {
  await cleanup();
});

describe("buildWeeklyReport", () => {
  it("builds one frozen email per participant", async () => {
    const report = await buildWeeklyReport(db, { competitionId, asOfDate: DAY_TWO });
    expect(report.status).toBe("READY");
    expect(report.recipientCount).toBe(2);

    const entries = await db.weeklyReportEntry.findMany({ where: { reportId: report.id } });
    expect(entries).toHaveLength(2);
    // Every recipient's complete email is stored, not a template plus data.
    for (const entry of entries) {
      expect(entry.renderedHtml.length).toBeGreaterThan(500);
      expect(entry.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("personalises the greeting and highlights the reader's own row", async () => {
    const entry = await db.weeklyReportEntry.findFirstOrThrow({
      where: { participantId: alice.participant.id },
      orderBy: { createdAt: "desc" },
    });
    expect(entry.renderedHtml).toContain("Hi alice");
    expect(entry.renderedHtml).toContain("(you)");
    // 200 -> 240 is +20%, and the personal section must say so.
    expect(entry.totalReturnPpm).toBe(200_000);
  });

  it("tells an uninvested participant why they are not ranked", async () => {
    const idle = await db.participant.findFirstOrThrow({
      where: { user: { email: "idle@example.com" } },
    });
    const entry = await db.weeklyReportEntry.findFirstOrThrow({
      where: { participantId: idle.id },
      orderBy: { createdAt: "desc" },
    });
    expect(entry.isRanked).toBe(false);
    expect(entry.renderedHtml).toContain("not built your portfolio");
    // ...and does not claim a rank they do not have.
    expect(entry.rank).toBeNull();
  });

  it("refuses to build when the snapshot it would describe does not exist", async () => {
    // A report that invents standings the site does not show is worse than no
    // report, so this fails loudly rather than computing its own.
    const other = await seedCompetition(db, "no-snapshots");
    await expect(
      buildWeeklyReport(db, { competitionId: other.id, asOfDate: DAY_TWO }),
    ).rejects.toThrow(ReportError);
  });
});

describe("sendWeeklyReport", () => {
  it("sends once per recipient and cannot double-send on a re-run", async () => {
    const report = await db.weeklyReport.findFirstOrThrow({ orderBy: { createdAt: "desc" } });

    const first = await sendWeeklyReport(db, report.id);
    expect(first.sent).toBe(2);
    expect(first.failed).toBe(0);

    // The unique dedupeKey is what makes this safe even if sendStatus were
    // left inconsistent by a crash mid-run.
    const second = await sendWeeklyReport(db, report.id);
    expect(second.attempted).toBe(0);
    expect(second.sent).toBe(0);

    expect(await db.emailLog.count({ where: { reportId: report.id, isTest: false } })).toBe(2);
    const after = await db.weeklyReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(after.status).toBe("SENT");
    expect(after.sentCount).toBe(2);
  });

  it("writes an EmailLog row for every attempt, before the send", async () => {
    const logs = await db.emailLog.findMany({ where: { isTest: false } });
    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) {
      expect(log.status).toBe("SENT");
      expect(log.bodyHash).toMatch(/^[0-9a-f]{64}$/);
      // The hash recorded at send must match the one frozen at build — a
      // mismatch would mean the stored email changed between the two.
      const entry = await db.weeklyReportEntry.findFirstOrThrow({
        where: { reportId: log.reportId ?? "", participantId: log.participantId ?? "" },
      });
      expect(log.bodyHash).toBe(entry.contentHash);
    }
  });

  it("refuses to rebuild a report that has already been sent", async () => {
    await expect(buildWeeklyReport(db, { competitionId, asOfDate: DAY_TWO })).rejects.toThrow(
      /already been sent/,
    );
  });

  it("allows a forced rebuild, as a new revision", async () => {
    const rebuilt = await buildWeeklyReport(db, {
      competitionId,
      asOfDate: DAY_TWO,
      force: true,
    });
    expect(rebuilt.revision).toBe(2);
    // The old revision survives for audit rather than being overwritten.
    expect(await db.weeklyReport.count({ where: { competitionId } })).toBeGreaterThan(1);
  });
});

describe("weekly email opt-out", () => {
  // Runs last on purpose: it forces a rebuild, and the tests above assert
  // absolute revision numbers.
  it("skips someone who has turned the weekly email off", async () => {
    // The notifications page offers this choice. Until the report honoured it,
    // opting out silenced the in-app item and the email arrived anyway — which
    // makes a preference a lie rather than a setting.
    await db.notificationPreference.create({
      data: { userId: alice.user.id, type: "WEEKLY_REPORT", channel: "EMAIL", enabled: false },
    });

    const report = await buildWeeklyReport(db, {
      competitionId,
      asOfDate: DAY_TWO,
      force: true,
    });

    const entry = await db.weeklyReportEntry.findFirstOrThrow({
      where: { reportId: report.id, participantId: alice.participant.id },
    });
    expect(entry.sendStatus).toBe("SKIPPED");
    expect(entry.skipReason).toBe("OPTED_OUT");
    // ...but the report is still BUILT for them, so their figures exist on the
    // site even though no email goes out.
    expect(entry.renderedHtml.length).toBeGreaterThan(500);

    // Sending now reaches everyone except them.
    const outcome = await sendWeeklyReport(db, report.id);
    expect(outcome.sent).toBe(report.recipientCount);
    expect(
      await db.emailLog.count({
        where: { reportId: report.id, participantId: alice.participant.id, isTest: false },
      }),
    ).toBe(0);
  });
});
