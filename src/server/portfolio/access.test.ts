import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, seedCompetition, seedParticipant } from "@/test/db";
import { HOUSE_RULES } from "@/server/competition/house-rules";
import { loadTradingAccess } from "./access";
import { commitRebalance } from "./commit";
import { checkPortfolioInvariants } from "./invariant";

let db: PrismaClient;
let cleanup: () => Promise<void>;
let competitionId: string;
let stockId: string;
let alice: Awaited<ReturnType<typeof seedParticipant>>;

// 2026-08-05 is a Wednesday; the week's token comes back on Monday 10 August.
const WEDNESDAY = new Date("2026-08-05T10:00:00Z");
const NEXT_MONDAY = new Date("2026-08-10T10:00:00Z");

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  cleanup = t.cleanup;
  competitionId = (await seedCompetition(db)).id;
  await db.competitionSettings.create({
    data: { competitionId, revision: 1, ...HOUSE_RULES, maxPositionPpm: 1_000_000 },
  });
  const stock = await db.stock.create({ data: { symbol: "MC", name: "LVMH" } });
  stockId = stock.id;
  await db.competitionStock.create({ data: { competitionId, stockId } });
  await db.priceHistory.createMany({
    data: [
      { stockId, tradeDate: "2026-08-04", closeCents: 50_000n },
      { stockId, tradeDate: "2026-08-07", closeCents: 50_000n },
    ],
  });
  alice = await seedParticipant(db, competitionId, "alice@example.com");
}, 60_000);

afterAll(async () => {
  await cleanup();
});

describe("the weekly rebalance token", () => {
  it("is available before the week's first rebalance", async () => {
    const access = await loadTradingAccess(db, alice.portfolio.id, WEDNESDAY);
    expect(access?.decision.allowed).toBe(true);
    expect(access?.tokens).toMatchObject({ allowance: 1, used: 0, remaining: 1 });
    expect(access?.tokens?.refillsOn).toBe("2026-08-10");
  });

  it("is spent by a rebalance, and the banner says when it comes back", async () => {
    const before = await loadTradingAccess(db, alice.portfolio.id, WEDNESDAY);
    const result = await commitRebalance(db, {
      portfolioId: alice.portfolio.id,
      targets: [{ stockId, weightPpm: 500_000 }],
      idempotencyKey: "alice-week-32",
      periodKey: before?.decision.periodKey ?? null,
      asOfDate: "2026-08-05",
      executedAt: WEDNESDAY,
    });
    expect(result.ok).toBe(true);

    const after = await loadTradingAccess(db, alice.portfolio.id, WEDNESDAY);
    expect(after?.decision.allowed).toBe(false);
    expect(after?.decision.reason?.code).toBe("PERIOD_LIMIT_REACHED");
    expect(after?.decision.reason?.message).toContain("weekly rebalance token");
    expect(after?.decision.reason?.message).toContain("Monday 10 August");
    expect(after?.tokens?.remaining).toBe(0);
  });

  it("comes back on Monday — last week's rebalance does not count against this one", async () => {
    // The bug this guards: the count used to include every committed rebalance
    // that had ever had a period key, so after week one nobody could trade again.
    const access = await loadTradingAccess(db, alice.portfolio.id, NEXT_MONDAY);
    expect(access?.decision.allowed).toBe(true);
    expect(access?.tokens?.remaining).toBe(1);
  });
});

describe("the 1% transaction cost", () => {
  it("charges 1% of the order on top of the purchase, and the ledger still reconciles", async () => {
    const portfolio = await db.portfolio.findUniqueOrThrow({
      where: { id: alice.portfolio.id },
      include: { transactions: { where: { type: "BUY" } } },
    });
    const buy = portfolio.transactions[0];
    expect(buy).toBeDefined();
    if (!buy) return;
    // 1% of the order, rounded up to the cent, and capitalised into the cost.
    expect(buy.feeCents).toBe((buy.grossCents + 99n) / 100n);
    expect(buy.cashDeltaCents).toBe(-(buy.grossCents + buy.feeCents));
    expect(portfolio.totalFeesCents).toBe(buy.feeCents);
    // The 50% is 50% of what is left AFTER the fee: €49,751 of LVMH out of
    // €99,502.49, not €50,000 out of €99,500.
    const after = 10_000_000n - buy.feeCents;
    expect(Number((buy.grossCents * 1_000_000n) / after)).toBeGreaterThanOrEqual(499_990);
    expect(Number((buy.grossCents * 1_000_000n) / after)).toBeLessThanOrEqual(500_000);
    expect(await checkPortfolioInvariants(db, alice.portfolio.id)).toEqual([]);
  });
});
