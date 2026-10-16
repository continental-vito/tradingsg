import type { PrismaClient } from "@/generated/prisma/client";
import type { DateKey } from "@/lib/dates";
import type { SurveyAdjustmentBase } from "@/lib/enums";
import {
  divRound,
  marketValue,
  proRataCeil,
  rateAdjustment,
  sharesToRaise,
  type Cents,
} from "@/server/money";
import { assertPortfolioInvariants } from "@/server/portfolio/invariant";
import { buildPriceBook } from "@/server/portfolio/prices";
import { valuePortfolio } from "@/server/portfolio/value";

/**
 * A bonus or malus for everyone who gave a particular answer to a login
 * question.
 *
 * Unlike an administrator's correction (src/server/portfolio/adjust.ts), this
 * is meant to move the ranking — so it is booked as PERFORMANCE, not as an
 * external flow. A BONUS row adds cash and the same amount of realised P/L; a
 * MALUS takes both away. That keeps the identity
 * `value − initialCapital − netFlow = realised + unrealised` exact, and the
 * return, the time-weighted return and the leaderboard all pick it up with no
 * special case anywhere.
 *
 * A malus can be larger than the cash a fully invested portfolio holds, and
 * cash may not go negative. The shortfall is raised by selling every long
 * position pro rata at its last close, without a fee — nobody chose that trade
 * — exactly as a delisted stock is liquidated. Each sale is an ordinary
 * LIQUIDATION_SELL row, so the reconciliation invariants apply to it as to any
 * other.
 *
 * The whole application is one database transaction: everyone gets it or
 * nobody does. Kept out of the server action so it can be tested.
 */

export interface SurveyAdjustmentArgs {
  competitionId: string;
  questionId: string;
  /** Who gets it: everyone who answered yes (true) or no (false). */
  answer: boolean;
  /** Signed: +20_000 is a 2% bonus, -15_000 a 1.5% malus. */
  ratePpm: number;
  base: SurveyAdjustmentBase;
  asOfDate: DateKey;
  note?: string;
}

export interface PlannedAdjustment {
  participantId: string;
  portfolioId: string;
  displayName: string;
  baseCents: Cents;
  amountCents: Cents;
}

async function recipients(db: PrismaClient, args: SurveyAdjustmentArgs) {
  return db.participant.findMany({
    where: {
      competitionId: args.competitionId,
      deletedAt: null,
      // Someone out of the competition is not owed, or charged, anything.
      status: { notIn: ["WITHDRAWN", "DISQUALIFIED"] },
      portfolio: { isNot: null },
      user: { surveyAnswers: { some: { questionId: args.questionId, answer: args.answer } } },
    },
    orderBy: { displayName: "asc" },
    include: { portfolio: { include: { holdings: { include: { stock: true } } } } },
  });
}

/** Who would get what. The admin page shows this before anything is applied. */
export async function planSurveyAdjustment(
  db: PrismaClient,
  args: SurveyAdjustmentArgs,
): Promise<PlannedAdjustment[]> {
  const people = await recipients(db, args);
  const planned: PlannedAdjustment[] = [];
  for (const p of people) {
    const portfolio = p.portfolio;
    if (!portfolio) continue;
    let baseCents = portfolio.initialCapitalCents;
    if (args.base === "CURRENT_VALUE") {
      const book = await buildPriceBook(
        db,
        portfolio.holdings.map((h) => h.stockId),
        args.asOfDate,
      );
      baseCents = valuePortfolio(
        {
          cashCents: portfolio.cashCents,
          initialCapitalCents: portfolio.initialCapitalCents,
          netFlowCents: portfolio.netFlowCents,
          realizedPnlCents: portfolio.realizedPnlCents,
          holdings: portfolio.holdings.map((h) => ({
            stockId: h.stockId,
            symbol: h.stock.symbol,
            microShares: h.microShares,
            costBasisCents: h.costBasisCents,
          })),
        },
        book,
      ).totalValueCents;
      if (baseCents < 0n) baseCents = 0n;
    }
    const amountCents = rateAdjustment(baseCents, args.ratePpm);
    if (amountCents === 0n) continue;
    planned.push({
      participantId: p.id,
      portfolioId: portfolio.id,
      displayName: p.displayName,
      baseCents,
      amountCents,
    });
  }
  return planned;
}

export type ApplyResult =
  | {
      ok: true;
      adjustmentId: string;
      participantCount: number;
      totalCents: Cents;
      replayed: boolean;
    }
  | { ok: false; error: string };

export async function applySurveyAdjustment(
  db: PrismaClient,
  args: SurveyAdjustmentArgs & {
    idempotencyKey: string;
    appliedByUserId?: string;
    now?: Date;
  },
): Promise<ApplyResult> {
  const existing = await db.surveyAdjustment.findUnique({
    where: { idempotencyKey: args.idempotencyKey },
  });
  if (existing) {
    // A double-click or a retried request: the first application stands.
    return {
      ok: true,
      adjustmentId: existing.id,
      participantCount: existing.participantCount,
      totalCents: existing.totalCents,
      replayed: true,
    };
  }

  if (args.ratePpm === 0) return { ok: false, error: "A bonus or malus of 0% changes nothing." };
  if (Math.abs(args.ratePpm) > 1_000_000) {
    return { ok: false, error: "A bonus or malus cannot be more than 100%." };
  }

  const question = await db.surveyQuestion.findUnique({ where: { id: args.questionId } });
  if (!question) return { ok: false, error: "That question no longer exists." };

  const planned = await planSurveyAdjustment(db, args);
  if (planned.length === 0) {
    return {
      ok: false,
      error: `Nobody in the competition answered “${args.answer ? question.yesLabel : question.noLabel}” to that question, so there is no one to apply it to.`,
    };
  }

  const now = args.now ?? new Date();
  const sign = args.ratePpm > 0 ? "+" : "−";
  const label = args.answer ? question.yesLabel : question.noLabel;
  const reason =
    `${args.ratePpm > 0 ? "Bonus" : "Malus"} ${sign}${(Math.abs(args.ratePpm) / 10_000).toFixed(2)}% ` +
    `for answering “${label}” to “${question.prompt}”` +
    (args.note?.trim() ? ` — ${args.note.trim()}` : "");

  return db.$transaction(
    async (tx) => {
      let total = 0n;
      for (const plan of planned) {
        total += await applyOne(tx as unknown as PrismaClient, plan, args.asOfDate, now, reason);
      }
      const record = await tx.surveyAdjustment.create({
        data: {
          idempotencyKey: args.idempotencyKey,
          questionId: args.questionId,
          competitionId: args.competitionId,
          answer: args.answer,
          ratePpm: args.ratePpm,
          base: args.base,
          note: args.note?.trim() || null,
          participantCount: planned.length,
          totalCents: total,
          asOfDate: args.asOfDate,
          appliedByUserId: args.appliedByUserId ?? null,
        },
      });
      return {
        ok: true as const,
        adjustmentId: record.id,
        participantCount: planned.length,
        totalCents: total,
        replayed: false,
      };
    },
    // Every participant's ledger in one transaction, over a pooled serverless
    // connection: well beyond the default five seconds.
    { timeout: 120_000, maxWait: 15_000 },
  );
}

/** Books one participant's bonus or malus. Returns the signed amount booked. */
async function applyOne(
  tx: PrismaClient,
  plan: PlannedAdjustment,
  asOfDate: DateKey,
  now: Date,
  reason: string,
): Promise<Cents> {
  const portfolio = await tx.portfolio.findUniqueOrThrow({
    where: { id: plan.portfolioId },
    include: { holdings: true },
  });

  let sequence = portfolio.transactionSeq;
  let cash = portfolio.cashCents;
  let basisRemoved = 0n;
  let realized = 0n;
  let amount = plan.amountCents;

  if (amount < 0n && cash < -amount) {
    // ── Raise the shortfall from the longs, pro rata, at the last close ──────
    const longs = portfolio.holdings
      .filter((h) => h.microShares > 0n)
      .sort((a, b) => a.stockId.localeCompare(b.stockId));
    const book = await buildPriceBook(
      tx,
      longs.map((h) => h.stockId),
      asOfDate,
    );
    const priced = longs.flatMap((h) => {
      const price = book.get(h.stockId)?.priceCents ?? 0n;
      return price > 0n ? [{ holding: h, price, value: marketValue(h.microShares, price) }] : [];
    });
    const longValue = priced.reduce((sum, p) => sum + p.value, 0n);

    let shortfall = -amount - cash;
    if (shortfall > longValue) {
      // The malus is more than the whole portfolio is worth at its last close:
      // it takes everything there is, and no more.
      amount = -(cash + longValue);
      shortfall = longValue;
    }

    for (const { holding, price, value } of priced) {
      if (shortfall <= 0n) break;
      const share = proRataCeil(shortfall, value, longValue);
      let sold = sharesToRaise(share, price);
      if (sold > holding.microShares) sold = holding.microShares;
      if (sold === 0n) continue;

      const proceeds = marketValue(sold, price);
      const fullExit = sold === holding.microShares;
      // The full-exit short-circuit, as in every other sale: pro-rata rounding
      // would leave a cent of basis on a closed position.
      const costRemoved = fullExit
        ? holding.costBasisCents
        : divRound(holding.costBasisCents * sold, holding.microShares);
      const pnl = proceeds - costRemoved;

      sequence++;
      cash += proceeds;
      basisRemoved += costRemoved;
      realized += pnl;

      await tx.transaction.create({
        data: {
          portfolioId: portfolio.id,
          participantId: portfolio.participantId,
          stockId: holding.stockId,
          sequence,
          type: "LIQUIDATION_SELL",
          tradeDate: asOfDate,
          executedAt: now,
          microShareDelta: -sold,
          priceCents: price,
          grossCents: proceeds,
          // No fee: nobody chose this sale.
          feeCents: 0n,
          cashDeltaCents: proceeds,
          costRemovedCents: costRemoved,
          realizedPnlCents: pnl,
          cashAfterCents: cash,
          microSharesAfter: holding.microShares - sold,
          isExternalFlow: false,
          note: `Sold to cover a malus: ${reason}`,
        },
      });
      await tx.holding.update({
        where: { id: holding.id },
        data: {
          microShares: { decrement: sold },
          costBasisCents: fullExit ? 0n : { decrement: costRemoved },
          realizedPnlCents: { increment: pnl },
          lastTradedAt: now,
        },
      });
    }
    // The ceilings above can raise a fraction more than needed; never less.
    // Should a price be missing, whatever could not be raised is not charged.
    if (cash < -amount) amount = -cash;
  }

  if (amount !== 0n) {
    sequence++;
    cash += amount;
    realized += amount;
    await tx.transaction.create({
      data: {
        portfolioId: portfolio.id,
        participantId: portfolio.participantId,
        sequence,
        type: amount > 0n ? "BONUS" : "MALUS",
        tradeDate: asOfDate,
        executedAt: now,
        cashDeltaCents: amount,
        // Booked as realised P/L so the P/L identity stays exact and the
        // return counts it: this is performance, not a flow of capital.
        realizedPnlCents: amount,
        cashAfterCents: cash,
        isExternalFlow: false,
        note: reason,
      },
    });
  }

  await tx.portfolio.update({
    where: { id: portfolio.id },
    data: {
      cashCents: cash,
      costBasisCents: { decrement: basisRemoved },
      realizedPnlCents: { increment: realized },
      transactionSeq: sequence,
      version: { increment: 1 },
    },
  });

  // Inside the transaction: one broken ledger rolls back every participant's.
  await assertPortfolioInvariants(tx, portfolio.id);
  return amount;
}
