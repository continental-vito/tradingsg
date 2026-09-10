import type { DateKey } from "@/lib/dates";
import { dateKeyOf, periodKeyFor } from "@/lib/dates";

/**
 * Whether this participant may trade right now, and which period bucket the
 * change would count against.
 *
 * Checked in the server action before anything is priced, and re-checked inside
 * the commit transaction. Hiding the button is not enforcement: a server action
 * is reachable by POST without the page ever rendering.
 */

export interface WindowRules {
  tradingMode: string;
  periodUnit: "DAY" | "WEEK" | "MONTH";
  maxChangesPerPeriod: number;
  lockAfterDate: string | null;
  allowTradingBeforeStart: boolean;
  timezone: string;
  weekStartsOn: number;
}

export interface CompetitionWindow {
  status: string;
  startsAt: Date;
  endsAt: Date;
}

export interface WindowDecision {
  allowed: boolean;
  /** Null when trading is unlimited — nothing to count against. */
  periodKey: string | null;
  reason?: { code: string; message: string };
}

export function evaluateTradingWindow(args: {
  rules: WindowRules;
  competition: CompetitionWindow;
  openWindows: { opensAt: Date; closesAt: Date; label: string }[];
  changesThisPeriod: number;
  now: Date;
}): WindowDecision {
  const { rules, competition, openWindows, changesThisPeriod, now } = args;
  const today: DateKey = dateKeyOf(now, rules.timezone);

  const deny = (code: string, message: string): WindowDecision => ({
    allowed: false,
    periodKey: null,
    reason: { code, message },
  });

  if (competition.status === "ENDED" || now >= competition.endsAt) {
    return deny(
      "COMPETITION_ENDED",
      `This competition ended on ${competition.endsAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}. Portfolios can no longer be changed.`,
    );
  }
  if (competition.status === "PAUSED") {
    return deny(
      "COMPETITION_PAUSED",
      "The competition is paused. Trading reopens when an administrator resumes it.",
    );
  }
  if (competition.status === "DRAFT") {
    return deny("COMPETITION_NOT_RUNNING", "This competition has not opened yet.");
  }
  if (now < competition.startsAt && !rules.allowTradingBeforeStart) {
    return deny(
      "COMPETITION_NOT_RUNNING",
      `Trading opens on ${competition.startsAt.toLocaleDateString("en-GB", { day: "numeric", month: "long" })} at ${competition.startsAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.`,
    );
  }
  if (rules.lockAfterDate && today >= rules.lockAfterDate) {
    return deny(
      "TRADING_LOCKED",
      `Portfolios were locked on ${rules.lockAfterDate}. The competition runs to the end with the positions you hold now.`,
    );
  }

  switch (rules.tradingMode) {
    case "LOCKED":
      return deny(
        "TRADING_LOCKED",
        "Portfolios are locked for this competition. Your initial allocation runs to the end.",
      );

    case "WINDOWS": {
      const open = openWindows.find((w) => w.opensAt <= now && now < w.closesAt);
      if (!open) {
        const next = openWindows
          .filter((w) => w.opensAt > now)
          .sort((a, b) => a.opensAt.getTime() - b.opensAt.getTime())[0];
        return deny(
          "OUTSIDE_TRADING_WINDOW",
          next
            ? `Trading is only open during scheduled windows. The next one opens ${next.opensAt.toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}.`
            : "Trading is only open during scheduled windows, and none are scheduled. Ask the competition administrator.",
        );
      }
      return { allowed: true, periodKey: `win:${open.label}:${open.opensAt.toISOString()}` };
    }

    case "ONCE_PER_PERIOD": {
      const periodKey = periodKeyFor(today, rules.periodUnit, rules.weekStartsOn);
      if (changesThisPeriod >= rules.maxChangesPerPeriod) {
        const unit =
          rules.periodUnit === "WEEK" ? "week" : rules.periodUnit === "MONTH" ? "month" : "day";
        return deny(
          "PERIOD_LIMIT_REACHED",
          `You have already made your ${rules.maxChangesPerPeriod === 1 ? "one allowed change" : `${rules.maxChangesPerPeriod} allowed changes`} this ${unit}. You can rebalance again next ${unit}.`,
        );
      }
      return { allowed: true, periodKey };
    }

    default:
      return { allowed: true, periodKey: null };
  }
}
