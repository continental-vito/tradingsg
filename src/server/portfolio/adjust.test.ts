import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, seedCompetition, seedParticipant } from "@/test/db";
import { snapshotValuations } from "@/server/jobs/valuations";
import { checkPortfolioInvariants } from "./invariant";
import { applyAdjustment } from "./adjust";

let db: PrismaClient;
let cleanup: () => Promise<void>;
let competitionId: string;
let alice: Awaited<ReturnType<typeof seedParticipant>>;

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  cleanup = t.cleanup;
  const competition = await seedCompetition(db);
  competitionId = competition.id;
  await db.competitionSettings.create({ data: { competitionId, revision: 1 } });
  alice = await seedParticipant(db, competitionId, "alice@example.com");
}, 60_000);

afterAll(async () => {
  await cleanup();
});

describe("applyAdjustment", () => {
  it("moves cash and keeps the ledger reconciling", async () => {
    const result = await applyAdjustment(db, {
      portfolioId: alice.portfolio.id,
      amountCents: -50_000n, // −€500
      reason: "Correcting a duplicated fee",
      tradeDate: "2026-08-01",
    });
    expect(result.ok).toBe(true);

    const portfolio = await db.portfolio.findUniqueOrThrow({
      where: { id: alice.portfolio.id },
    });
    expect(portfolio.cashCents).toBe(9_950_000n);
    // Every invariant, checked against the ledger rather than the code that
    // wrote it.
    expect(await checkPortfolioInvariants(db, alice.portfolio.id)).toEqual([]);
  });

  it("never touches the starting capital", async () => {
    // The denominator of every return figure. An admin who could edit it could
    // hand somebody a rank, so an adjustment must move cash and nothing else.
    const participant = await db.participant.findUniqueOrThrow({
      where: { id: alice.participant.id },
    });
    const portfolio = await db.portfolio.findUniqueOrThrow({
      where: { id: alice.portfolio.id },
    });
    expect(participant.initialCapitalCents).toBe(10_000_000n);
    expect(portfolio.initialCapitalCents).toBe(10_000_000n);
  });

  it("records the movement as an external flow and flags the participant", async () => {
    const transaction = await db.transaction.findFirstOrThrow({
      where: { portfolioId: alice.portfolio.id, type: "ADJUSTMENT_DEBIT" },
    });
    // This flag is what keeps the adjustment out of the performance figure.
    expect(transaction.isExternalFlow).toBe(true);
    expect(transaction.note).toBe("Correcting a duplicated fee");

    const participant = await db.participant.findUniqueOrThrow({
      where: { id: alice.participant.id },
    });
    // Badged on the leaderboard, because this return is no longer comparable.
    expect(participant.adjustedByAdmin).toBe(true);
  });

  it("excludes the adjustment from the return rather than counting it as a loss", async () => {
    await snapshotValuations(
      { db, runKey: "test", log: () => {} },
      { competitionId, asOfDate: "2026-08-01" },
    );
    const valuation = await db.portfolioValuation.findFirstOrThrow({
      where: { portfolioId: alice.portfolio.id, asOfDate: "2026-08-01" },
    });

    // The portfolio is €500 lighter, but the participant did not lose €500 —
    // it was taken out. netFlow carries it, so the return stays at zero.
    expect(valuation.totalValueCents).toBe(9_950_000n);
    expect(valuation.netFlowCents).toBe(-50_000n);
    expect(valuation.totalReturnPpm).toBe(0);
    // ...and the P/L identity still holds with the flow in it.
    expect(valuation.totalValueCents - valuation.initialCapitalCents - valuation.netFlowCents).toBe(
      valuation.realizedPnlCents + valuation.unrealizedPnlCents,
    );
  });

  it("refuses a debit larger than the cash held", async () => {
    const result = await applyAdjustment(db, {
      portfolioId: alice.portfolio.id,
      amountCents: -99_000_000n,
      reason: "Impossible debit",
      tradeDate: "2026-08-02",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("cannot exceed");
    // ...and wrote nothing.
    expect(await checkPortfolioInvariants(db, alice.portfolio.id)).toEqual([]);
  });

  it("refuses a zero adjustment and an unexplained one", async () => {
    const zero = await applyAdjustment(db, {
      portfolioId: alice.portfolio.id,
      amountCents: 0n,
      reason: "Nothing to see",
      tradeDate: "2026-08-02",
    });
    expect(zero.ok).toBe(false);

    const unexplained = await applyAdjustment(db, {
      portfolioId: alice.portfolio.id,
      amountCents: 1_000n,
      reason: "x",
      tradeDate: "2026-08-02",
    });
    expect(unexplained.ok).toBe(false);
  });
});
