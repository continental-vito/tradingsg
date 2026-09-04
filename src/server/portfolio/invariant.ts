import type { PrismaClient } from "@/generated/prisma/client";
import type { Cents } from "@/server/money";

/**
 * The reconciliation invariants.
 *
 * Every one of these is an exact integer identity, not an approximation, so a
 * violation is always a bug and never rounding. They run inside every write
 * transaction; a violation throws and rolls the whole rebalance back. A bug in
 * the rebalancer may corrupt a preview — it must never corrupt the ledger.
 *
 * The identity that does the most work is (E). Given that a buy records
 * `costAdded = gross + fee` and removes exactly that from cash, and a sell
 * records `proceedsNet` and adds exactly that:
 *
 *     cash        = V0 + Σ cashDelta = V0 − Σ costAdded + Σ proceedsNet
 *     Σ costBasis =                    Σ costAdded − Σ costRemoved
 *     ⇒ cash + Σ costBasis = V0 + Σ(proceedsNet − costRemoved) = V0 + realized
 *     ⇒ V − V0 = realized + unrealized,  for ANY trade history.
 *
 * That is what makes rebalancing unable to change the reported return: no
 * sequence of trades can break an identity that holds by construction.
 */

export interface InvariantViolation {
  code: string;
  portfolioId: string;
  expected: bigint;
  actual: bigint;
  detail?: string;
}

export class InvariantError extends Error {
  constructor(readonly violations: InvariantViolation[]) {
    super(
      `Portfolio invariants violated: ${violations
        .map(
          (v) =>
            `${v.code} (expected ${v.expected}, got ${v.actual}${v.detail ? `, ${v.detail}` : ""})`,
        )
        .join("; ")}`,
    );
    this.name = "InvariantError";
  }
}

type Tx = Pick<PrismaClient, "portfolio" | "holding" | "transaction">;

export async function checkPortfolioInvariants(
  tx: Tx,
  portfolioId: string,
): Promise<InvariantViolation[]> {
  const violations: InvariantViolation[] = [];

  const portfolio = await tx.portfolio.findUnique({ where: { id: portfolioId } });
  if (!portfolio) {
    return [{ code: "PORTFOLIO_MISSING", portfolioId, expected: 1n, actual: 0n }];
  }

  const [transactions, holdings] = await Promise.all([
    tx.transaction.findMany({
      where: { portfolioId },
      orderBy: { sequence: "asc" },
      select: {
        sequence: true,
        stockId: true,
        microShareDelta: true,
        cashDeltaCents: true,
        costAddedCents: true,
        costRemovedCents: true,
        feeCents: true,
        realizedPnlCents: true,
        cashAfterCents: true,
      },
    }),
    tx.holding.findMany({ where: { portfolioId } }),
  ]);

  const add = (code: string, expected: Cents, actual: Cents, detail?: string) => {
    if (expected !== actual) violations.push({ code, portfolioId, expected, actual, detail });
  };

  // (A) No money created or destroyed. Pure integer sum over the ledger.
  const ledgerCash = transactions.reduce((sum, t) => sum + t.cashDeltaCents, 0n);
  add("CASH_LEDGER_MISMATCH", ledgerCash, portfolio.cashCents);

  // (B) Share counts agree with the ledger, per stock.
  const sharesByStock = new Map<string, bigint>();
  for (const t of transactions) {
    if (!t.stockId) continue;
    sharesByStock.set(t.stockId, (sharesByStock.get(t.stockId) ?? 0n) + t.microShareDelta);
  }
  for (const holding of holdings) {
    add(
      "SHARE_LEDGER_MISMATCH",
      sharesByStock.get(holding.stockId) ?? 0n,
      holding.microShares,
      `stock ${holding.stockId}`,
    );
  }

  // (C) The running balance on the last row is the current balance. O(1) at the
  //     tail, which is what makes the nightly audit cheap enough to always run.
  const last = transactions[transactions.length - 1];
  if (last) add("RUNNING_BALANCE_MISMATCH", last.cashAfterCents, portfolio.cashCents);

  // (D) Cost basis agrees with what was added and removed.
  const basisByStock = new Map<string, bigint>();
  for (const t of transactions) {
    if (!t.stockId) continue;
    basisByStock.set(
      t.stockId,
      (basisByStock.get(t.stockId) ?? 0n) + t.costAddedCents - t.costRemovedCents,
    );
  }
  let holdingBasisTotal = 0n;
  for (const holding of holdings) {
    add(
      "COST_BASIS_MISMATCH",
      basisByStock.get(holding.stockId) ?? 0n,
      holding.costBasisCents,
      `stock ${holding.stockId}`,
    );
    holdingBasisTotal += holding.costBasisCents;
  }
  add("PORTFOLIO_COST_BASIS_MISMATCH", holdingBasisTotal, portfolio.costBasisCents);

  // (F) A closed position carries no residual basis. Without the full-liquidation
  //     short-circuit in the sell path, pro-rata rounding leaves ±1 cent here,
  //     which then reads as infinite unrealised P/L on zero shares.
  for (const holding of holdings) {
    if (holding.microShares === 0n && holding.costBasisCents !== 0n) {
      violations.push({
        code: "ZERO_POSITION_RESIDUAL_BASIS",
        portfolioId,
        expected: 0n,
        actual: holding.costBasisCents,
        detail: `stock ${holding.stockId}`,
      });
    }
  }

  // (G) and (H): no shorting, no overdraft, unless deliberately configured.
  if (portfolio.cashCents < 0n) {
    violations.push({
      code: "NEGATIVE_CASH",
      portfolioId,
      expected: 0n,
      actual: portfolio.cashCents,
    });
  }
  for (const holding of holdings) {
    if (holding.microShares < 0n) {
      violations.push({
        code: "NEGATIVE_SHARES",
        portfolioId,
        expected: 0n,
        actual: holding.microShares,
        detail: `stock ${holding.stockId}`,
      });
    }
  }

  // (I) The ledger has no gaps. Sequences run 1..n with nothing missing.
  const expectedSeq = transactions.length;
  const maxSeq = last?.sequence ?? 0;
  if (expectedSeq !== maxSeq) {
    violations.push({
      code: "SEQUENCE_GAP",
      portfolioId,
      expected: BigInt(expectedSeq),
      actual: BigInt(maxSeq),
    });
  }

  // (K) Fees are accounted for.
  const ledgerFees = transactions.reduce((sum, t) => sum + t.feeCents, 0n);
  add("FEE_LEDGER_MISMATCH", ledgerFees, portfolio.totalFeesCents);

  // Realised P/L agrees with the ledger.
  const ledgerRealized = transactions.reduce((sum, t) => sum + t.realizedPnlCents, 0n);
  add("REALIZED_PNL_MISMATCH", ledgerRealized, portfolio.realizedPnlCents);

  return violations;
}

/** Throws, so the enclosing database transaction rolls back. */
export async function assertPortfolioInvariants(tx: Tx, portfolioId: string): Promise<void> {
  const violations = await checkPortfolioInvariants(tx, portfolioId);
  if (violations.length > 0) throw new InvariantError(violations);
}

/**
 * (E), the P/L identity, checked against a computed valuation rather than the
 * ledger alone — it is the one invariant that needs a price book.
 */
export function assertPnlIdentity(
  portfolioId: string,
  args: {
    totalValueCents: Cents;
    initialCapitalCents: Cents;
    netFlowCents: Cents;
    realizedPnlCents: Cents;
    unrealizedPnlCents: Cents;
  },
): void {
  const left = args.totalValueCents - args.initialCapitalCents - args.netFlowCents;
  const right = args.realizedPnlCents + args.unrealizedPnlCents;
  if (left !== right) {
    throw new InvariantError([
      { code: "PNL_IDENTITY_MISMATCH", portfolioId, expected: left, actual: right },
    ]);
  }
}
