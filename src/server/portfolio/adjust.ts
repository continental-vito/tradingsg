import type { PrismaClient } from "@/generated/prisma/client";
import { formatCents, type Cents } from "@/server/money";
import { assertPortfolioInvariants } from "./invariant";

/**
 * A manual correction to a participant's cash.
 *
 * Separated from the server action that calls it, because requireAdmin() only
 * works inside a Next request and this is the most financially sensitive
 * operation an administrator has — it must be provable by a test.
 *
 * Deliberately NOT a way to edit `initialCapitalCents`. Total return is
 * currentValue / initialCapital − 1, and that is only truthful while the
 * denominator cannot move: an admin who could change it could hand somebody a
 * rank. So an adjustment is a real ledger row instead — signed, flagged as an
 * external flow so the time-weighted return excludes it rather than crediting
 * it as performance, and it marks the participant so the leaderboard can badge
 * a portfolio whose return is no longer comparable.
 */

export type AdjustResult =
  { ok: true; cashAfterCents: Cents; sequence: number } | { ok: false; error: string };

export async function applyAdjustment(
  db: PrismaClient,
  args: { portfolioId: string; amountCents: Cents; reason: string; tradeDate: string },
): Promise<AdjustResult> {
  const { portfolioId, amountCents, reason, tradeDate } = args;

  if (amountCents === 0n) {
    return { ok: false, error: "An adjustment of zero would only add noise to the ledger." };
  }
  if (reason.trim().length < 3) {
    return { ok: false, error: "Say why. This is written into the audit trail." };
  }

  const portfolio = await db.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) return { ok: false, error: "That portfolio no longer exists." };

  const cashAfter = portfolio.cashCents + amountCents;
  if (cashAfter < 0n) {
    return {
      ok: false,
      error: `That would leave the portfolio at ${formatCents(cashAfter)}. A debit cannot exceed the ${formatCents(portfolio.cashCents)} held in cash.`,
    };
  }

  const sequence = portfolio.transactionSeq + 1;

  await db.$transaction(async (tx) => {
    await tx.transaction.create({
      data: {
        portfolioId,
        participantId: portfolio.participantId,
        sequence,
        type: amountCents > 0n ? "ADJUSTMENT_CREDIT" : "ADJUSTMENT_DEBIT",
        tradeDate,
        cashDeltaCents: amountCents,
        cashAfterCents: cashAfter,
        // The one flag that keeps this out of the performance figure.
        isExternalFlow: true,
        note: reason.trim(),
      },
    });

    await tx.portfolio.update({
      where: { id: portfolioId },
      data: {
        cashCents: cashAfter,
        // Accumulated so the return maths puts it in the denominator rather
        // than reading it as a gain.
        netFlowCents: { increment: amountCents },
        transactionSeq: sequence,
        version: { increment: 1 },
      },
    });

    await tx.participant.update({
      where: { id: portfolio.participantId },
      data: { adjustedByAdmin: true },
    });

    // Inside the transaction: an adjustment that broke the ledger would be
    // worse than one that was refused.
    await assertPortfolioInvariants(tx as unknown as PrismaClient, portfolioId);
  });

  return { ok: true, cashAfterCents: cashAfter, sequence };
}
