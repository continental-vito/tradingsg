import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, seedCompetition, seedParticipant } from "@/test/db";
import { commitRebalance } from "@/server/portfolio/commit";
import { checkPortfolioInvariants } from "@/server/portfolio/invariant";
import { snapshotValuations } from "@/server/jobs/valuations";
import { buildWeeklyReport } from "@/server/reports/generate";
import { buildPriceBook } from "@/server/portfolio/prices";

/**
 * Settings that the engine reads.
 *
 * Every one of these was declared in the schema and ignored by the code — some
 * of them while being described to participants on the rules page, which made
 * that page a list of rules nobody was enforcing.
 */

let db: PrismaClient;
let cleanup: () => Promise<void>;
let competitionId: string;
let stockId: string;
let alice: Awaited<ReturnType<typeof seedParticipant>>;

const DAY_ONE = "2026-07-24";
const LATER = "2026-08-20";

async function setSetting(data: Record<string, unknown>) {
  const current = await db.competitionSettings.findFirstOrThrow({
    where: { competitionId, supersededAt: null },
  });
  await db.competitionSettings.update({ where: { id: current.id }, data });
}

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  cleanup = t.cleanup;

  const competition = await seedCompetition(db);
  competitionId = competition.id;
  await db.competitionSettings.create({
    data: { competitionId, revision: 1, maxPositionPpm: 1_000_000 },
  });

  const stock = await db.stock.create({ data: { symbol: "SAP", name: "SAP" } });
  stockId = stock.id;
  await db.competitionStock.create({ data: { competitionId, stockId } });
  await db.priceHistory.create({
    data: { stockId, tradeDate: DAY_ONE, closeCents: 10_000n, revision: 1 },
  });

  alice = await seedParticipant(db, competitionId, "alice@example.com");
  await commitRebalance(db, {
    portfolioId: alice.portfolio.id,
    targets: [{ stockId, weightPpm: 1_000_000 }],
    idempotencyKey: "settings-test",
    periodKey: null,
    asOfDate: DAY_ONE,
  });
}, 90_000);

afterAll(async () => {
  await cleanup();
});

describe("maxPriceStalenessDays", () => {
  it("is read rather than assumed to be seven", async () => {
    // The price is 27 days old by LATER. A limit of 30 accepts it; a limit of 5
    // flags the valuation as degraded. The ladder used to hardcode 7 and ignore
    // the setting entirely.
    const generous = await buildPriceBook(db, [stockId], LATER, { maxStalenessDays: 30 });
    expect(generous.quality).toBe("OK");
    expect(generous.staleCount).toBe(0);

    const strict = await buildPriceBook(db, [stockId], LATER, { maxStalenessDays: 5 });
    expect(strict.quality).toBe("DEGRADED");
    expect(strict.staleCount).toBe(1);

    // Either way the position is priced — never dropped, never zero.
    expect(strict.get(stockId)?.priceCents).toBe(10_000n);
  });

  it("is taken from the competition's settings by the valuation job", async () => {
    await setSetting({ maxPriceStalenessDays: 3 });
    await snapshotValuations(
      { db, runKey: "t", log: () => {} },
      { competitionId, asOfDate: LATER },
    );
    const valuation = await db.portfolioValuation.findFirstOrThrow({
      where: { portfolioId: alice.portfolio.id, asOfDate: LATER },
    });
    expect(valuation.priceQuality).toBe("DEGRADED");

    await setSetting({ maxPriceStalenessDays: 60 });
    await snapshotValuations(
      { db, runKey: "t", log: () => {} },
      { competitionId, asOfDate: LATER },
    );
    const relaxed = await db.portfolioValuation.findFirstOrThrow({
      where: { portfolioId: alice.portfolio.id, asOfDate: LATER },
    });
    expect(relaxed.priceQuality).toBe("OK");
  });
});

describe("allowNegativeCash and allowShort", () => {
  it("are read by the invariant checker rather than hardcoded", async () => {
    // Force the portfolio negative behind the engine's back.
    const before = await db.portfolio.findUniqueOrThrow({ where: { id: alice.portfolio.id } });
    await db.portfolio.update({
      where: { id: alice.portfolio.id },
      data: { cashCents: -1_000n },
    });

    await setSetting({ allowNegativeCash: false });
    const strict = await checkPortfolioInvariants(db, alice.portfolio.id);
    expect(strict.map((v) => v.code)).toContain("NEGATIVE_CASH");

    // With it allowed, the same state is no longer a violation — which is the
    // whole point of the setting existing.
    await setSetting({ allowNegativeCash: true });
    const permissive = await checkPortfolioInvariants(db, alice.portfolio.id);
    expect(permissive.map((v) => v.code)).not.toContain("NEGATIVE_CASH");

    await db.portfolio.update({
      where: { id: alice.portfolio.id },
      data: { cashCents: before.cashCents },
    });
    await setSetting({ allowNegativeCash: false });
  });
});

describe("weeklyReportEnabled", () => {
  it("refuses to build a report when reports are turned off", async () => {
    await db.leaderboardSnapshot.create({
      data: {
        competitionId,
        asOfDate: DAY_ONE,
        asOfAt: new Date(`${DAY_ONE}T00:00:00Z`),
        kind: "WEEKLY",
        participantCount: 1,
        rankedCount: 1,
        totalAumCents: 10_000_000n,
        medianReturnPpm: 0,
        bestReturnPpm: 0,
        worstReturnPpm: 0,
      },
    });

    await setSetting({ weeklyReportEnabled: false });
    await expect(buildWeeklyReport(db, { competitionId, asOfDate: DAY_ONE })).rejects.toThrow(
      /turned off/,
    );

    // ...and builds again once it is back on.
    await setSetting({ weeklyReportEnabled: true });
    const report = await buildWeeklyReport(db, { competitionId, asOfDate: DAY_ONE });
    expect(report.status).toBe("READY");
  });
});
