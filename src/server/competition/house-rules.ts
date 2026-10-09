/**
 * The rules this competition runs under unless an administrator changes them:
 * a 1% transaction cost on every order, and one rebalance per week.
 *
 * The schema's column defaults are deliberately left at "no fee, trade any
 * time" — they are what the test suite's bare settings rows rely on, and a
 * default that changes underneath a test is a test that now proves something
 * else. These are applied explicitly wherever a real competition gets its
 * rules: a new competition, the demo seed, and the relaunch.
 *
 * The fee is charged on each order's gross amount and ceils (see feeFor in
 * src/server/money.ts), so a round trip costs about 2% and can never be free.
 * The weekly token resets on the competition's week start — Monday — in its
 * timezone, and is counted from the ledger rather than stored (see
 * src/server/portfolio/access.ts).
 */
export const HOUSE_RULES = {
  feeModel: "PERCENT",
  feeBps: 100, // 1.00% of each order
  feeFlatCents: 0n,
  feeMinCents: 0n,
  feeMaxCents: null,
  tradingMode: "ONCE_PER_PERIOD",
  periodUnit: "WEEK",
  maxChangesPerPeriod: 1,
} as const;
