/**
 * Date keys, computed in the competition's timezone.
 *
 * Two kinds of date exist in this system and they are never conflated:
 * `...At` columns are true UTC instants; `tradeDate`, `asOfDate` and
 * `periodStartDate` are "YYYY-MM-DD" strings in the competition's timezone.
 *
 * The string form is not laziness. `new Date().toISOString().slice(0, 10)` is
 * the single most common way a weekly report ends up covering six days: a
 * European close at 22:00 local is the *next* UTC day in summer and the same
 * one in winter. Every bucket boundary in this app goes through this file.
 */

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export type DateKey = string; // "YYYY-MM-DD"
export type IsoWeek = string; // "2026-W36"

export function assertDateKey(value: string): DateKey {
  if (!DATE_KEY.test(value)) {
    throw new Error(`Expected a YYYY-MM-DD date key, got "${value}".`);
  }
  return value;
}

/** The calendar date of an instant, as seen in `timeZone`. */
export function dateKeyOf(instant: Date, timeZone: string): DateKey {
  // en-CA renders ISO-shaped dates, which is what makes this a formatting
  // problem rather than an arithmetic one.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Midnight UTC of a date key. Used only where a DateTime column needs a value. */
export function dateKeyToUtc(key: DateKey): Date {
  return new Date(`${assertDateKey(key)}T00:00:00.000Z`);
}

export function addDays(key: DateKey, days: number): DateKey {
  const d = dateKeyToUtc(key);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: DateKey, to: DateKey): number {
  const ms = dateKeyToUtc(to).getTime() - dateKeyToUtc(from).getTime();
  return Math.round(ms / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday, for the date key itself (no timezone involved). */
export function weekdayOf(key: DateKey): number {
  return dateKeyToUtc(key).getUTCDay();
}

/**
 * Weekends only. Exchange holidays are handled by the price ladder carrying the
 * previous close forward, not by a hard-coded calendar that goes stale.
 */
export function isWeekend(key: DateKey): boolean {
  const d = weekdayOf(key);
  return d === 0 || d === 6;
}

export function eachDate(from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = [];
  for (let k = assertDateKey(from); k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}

export function eachTradingDay(from: DateKey, to: DateKey): DateKey[] {
  return eachDate(from, to).filter((k) => !isWeekend(k));
}

/** The Monday-based (or `weekStartsOn`-based) start of the week containing `key`. */
export function startOfWeek(key: DateKey, weekStartsOn = 1): DateKey {
  const day = weekdayOf(key);
  const delta = (day - weekStartsOn + 7) % 7;
  return addDays(key, -delta);
}

export function endOfWeek(key: DateKey, weekStartsOn = 1): DateKey {
  return addDays(startOfWeek(key, weekStartsOn), 6);
}

/**
 * ISO-8601 week number: week 1 is the one containing the first Thursday of the
 * year, so 1 January can legitimately belong to week 52 or 53 of the previous
 * year. Getting this wrong makes the first report of January overwrite the last
 * report of December.
 */
export function isoWeekOf(key: DateKey): IsoWeek {
  const d = dateKeyToUtc(key);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day + 3); // the Thursday of this week
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/**
 * The bucket key that "one change per period" counts within. Returned as a
 * string so the database's unique constraint — not application logic — is what
 * actually enforces the limit under a concurrent double-submit.
 */
export function periodKeyFor(
  key: DateKey,
  unit: "DAY" | "WEEK" | "MONTH",
  weekStartsOn = 1,
): string {
  switch (unit) {
    case "DAY":
      return key;
    case "WEEK":
      return isoWeekOf(startOfWeek(key, weekStartsOn));
    case "MONTH":
      return key.slice(0, 7);
  }
}

/** "23 days 14 hours remaining", for the competition countdown. */
export function formatRemaining(until: Date, now: Date = new Date()): string {
  const ms = until.getTime() - now.getTime();
  if (ms <= 0) return "Finished";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (days > 0) return `${days} day${days === 1 ? "" : "s"} ${hours} hour${hours === 1 ? "" : "s"}`;
  if (hours > 0) return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} min`;
  return `${minutes} min`;
}
