import type { PrismaClient } from "@/generated/prisma/client";
import { dateKeyOf, nextPeriodStart, periodKeyFor, type DateKey } from "@/lib/dates";
import { evaluateTradingWindow, openWindow, type WindowDecision } from "./window";

/**
 * Whether a portfolio may be rebalanced right now, and how many of its
 * rebalance tokens are left this period.
 *
 * One loader for every caller — the allocation page, the preview and commit
 * actions, and the AI investor — so a person and the AI are held to exactly
 * the same check. A rule enforced in one place and merely displayed in
 * another is how the page ends up saying "you can trade" while the commit
 * refuses.
 *
 * The token count is derived from the ledger rather than stored as a counter.
 * A stored counter needs a job to reset it every Monday, and the week that job
 * fails is the week nobody can trade; counting this period's committed
 * rebalances cannot drift from what actually happened.
 */

export interface RebalanceTokens {
  /** Rebalances allowed per period. */
  allowance: number;
  used: number;
  remaining: number;
  periodUnit: "DAY" | "WEEK" | "MONTH";
  /** When a used token comes back: next Monday, for a weekly allowance. */
  refillsOn: DateKey;
  /**
   * The last day a token can be used this period, when changes are limited to
   * the first days of it (the 7th, for a monthly window of 7). Null otherwise.
   */
  usableUntil: DateKey | null;
  /** The window has closed with the token unused: it is gone until refillsOn. */
  expired: boolean;
}

export interface TradingAccess {
  decision: WindowDecision;
  /** Null when trading is not limited per period. */
  tokens: RebalanceTokens | null;
  today: DateKey;
}

export async function loadTradingAccess(
  db: PrismaClient,
  portfolioId: string,
  now: Date = new Date(),
): Promise<TradingAccess | null> {
  const portfolio = await db.portfolio.findUnique({
    where: { id: portfolioId },
    select: {
      competition: {
        select: {
          status: true,
          startsAt: true,
          endsAt: true,
          timezone: true,
          weekStartsOn: true,
          settings: { where: { supersededAt: null }, orderBy: { revision: "desc" }, take: 1 },
          tradingWindows: {
            where: { isActive: true },
            select: { opensAt: true, closesAt: true, label: true },
          },
        },
      },
    },
  });
  const competition = portfolio?.competition;
  const settings = competition?.settings[0];
  if (!competition || !settings) return null;

  const today = dateKeyOf(now, competition.timezone);
  const periodUnit = settings.periodUnit as "DAY" | "WEEK" | "MONTH";
  const limited = settings.tradingMode === "ONCE_PER_PERIOD";

  // Only THIS period's commits count. Counting every committed rebalance that
  // ever had a period key would spend next week's token on last week's trade.
  // Rejected attempts carry a null key, so they never consume a token.
  const used = limited
    ? await db.rebalanceRequest.count({
        where: {
          portfolioId,
          status: "COMMITTED",
          periodKey: periodKeyFor(today, periodUnit, competition.weekStartsOn),
        },
      })
    : 0;

  const decision = evaluateTradingWindow({
    rules: {
      tradingMode: settings.tradingMode,
      periodUnit,
      maxChangesPerPeriod: settings.maxChangesPerPeriod,
      periodOpenDays: settings.periodOpenDays,
      lockAfterDate: settings.lockAfterDate,
      allowTradingBeforeStart: settings.allowTradingBeforeStart,
      timezone: competition.timezone,
      weekStartsOn: competition.weekStartsOn,
    },
    competition: {
      status: competition.status,
      startsAt: competition.startsAt,
      endsAt: competition.endsAt,
    },
    openWindows: competition.tradingWindows,
    changesThisPeriod: used,
    now,
  });

  const window = openWindow(today, {
    periodUnit,
    periodOpenDays: settings.periodOpenDays,
    weekStartsOn: competition.weekStartsOn,
  });
  const expired = window !== null && today > window.closesOn;

  return {
    decision,
    today,
    tokens: limited
      ? {
          allowance: settings.maxChangesPerPeriod,
          used,
          remaining: expired ? 0 : Math.max(0, settings.maxChangesPerPeriod - used),
          periodUnit,
          refillsOn: nextPeriodStart(today, periodUnit, competition.weekStartsOn),
          usableUntil: window?.closesOn ?? null,
          expired,
        }
      : null,
  };
}
