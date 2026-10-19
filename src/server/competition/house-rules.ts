/**
 * The rules this competition runs under unless an administrator changes them:
 * a 1% transaction cost on every order, and one rebalance per month, open only
 * on the 1st to the 7th — a token not used by the 7th expires until next month.
 *
 * The schema's column defaults are deliberately left at "no fee, trade any
 * time" — they are what the test suite's bare settings rows rely on, and a
 * default that changes underneath a test is a test that now proves something
 * else. These are applied explicitly wherever a real competition gets its
 * rules: a new competition, the demo seed, and the relaunch.
 *
 * The fee is charged on each order's gross amount and ceils (see feeFor in
 * src/server/money.ts), so a round trip costs about 2% and can never be free.
 * The token is counted from the ledger rather than stored (see
 * src/server/portfolio/access.ts), and the window is the first seven calendar
 * days of each month in the competition's timezone — always five trading days.
 */
export const HOUSE_RULES = {
  feeModel: "PERCENT",
  feeBps: 100, // 1.00% of each order
  feeFlatCents: 0n,
  feeMinCents: 0n,
  feeMaxCents: null,
  tradingMode: "ONCE_PER_PERIOD",
  periodUnit: "MONTH",
  maxChangesPerPeriod: 1,
  periodOpenDays: 7,
} as const;
