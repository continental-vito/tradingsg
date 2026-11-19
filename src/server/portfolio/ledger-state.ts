import type { Cents, MicroShares } from "@/server/money";
import type { PortfolioState } from "./value";

/**
 * A portfolio as it stood at the close of a given day, rebuilt from its ledger.
 *
 * The Portfolio and Holding rows hold the state NOW. Valuing a past day from
 * them — which is what catching up a missed night does — priced that day with
 * trades made after it: a participant who rebalanced on Tuesday had Monday's
 * missed valuation computed with Tuesday's holdings. The ledger is append-only
 * and dated, so the state at any close is simply every row up to that date.
 *
 * Pure: the caller selects the rows (tradeDate <= the day) and passes them in.
 */

export interface LedgerRow {
  type: string;
  stockId: string | null;
  microShareDelta: MicroShares;
  cashDeltaCents: Cents;
  costAddedCents: Cents;
  costRemovedCents: Cents;
  realizedPnlCents: Cents;
  feeCents: Cents;
  isExternalFlow: boolean;
}

export interface StateAt extends PortfolioState {
  netFlowCents: Cents;
  realizedPnlCents: Cents;
  feesCents: Cents;
  /** Whether any trade had happened by then — the ranking ignores the rest. */
  hasTraded: boolean;
}

export function stateFromLedger(
  initialCapitalCents: Cents,
  rows: readonly LedgerRow[],
  symbolOf: (stockId: string) => string,
): StateAt {
  let cash = 0n;
  let netFlow = 0n;
  let realized = 0n;
  let fees = 0n;
  let hasTraded = false;
  const byStock = new Map<string, { micro: bigint; basis: bigint; realized: bigint }>();

  for (const row of rows) {
    cash += row.cashDeltaCents;
    realized += row.realizedPnlCents;
    fees += row.feeCents;
    // The starting grant is the baseline, not a flow: only later capital
    // (an administrator's adjustment) counts, as Portfolio.netFlowCents does.
    if (row.isExternalFlow && row.type !== "INITIAL_FUNDING") netFlow += row.cashDeltaCents;
    if (!row.stockId) continue;
    hasTraded = true;
    const s = byStock.get(row.stockId) ?? { micro: 0n, basis: 0n, realized: 0n };
    s.micro += row.microShareDelta;
    s.basis += row.costAddedCents - row.costRemovedCents;
    s.realized += row.realizedPnlCents;
    byStock.set(row.stockId, s);
  }

  return {
    cashCents: cash,
    initialCapitalCents,
    netFlowCents: netFlow,
    realizedPnlCents: realized,
    feesCents: fees,
    hasTraded,
    holdings: [...byStock.entries()].map(([stockId, s]) => ({
      stockId,
      symbol: symbolOf(stockId),
      microShares: s.micro,
      costBasisCents: s.basis,
      realizedPnlCents: s.realized,
    })),
  };
}
