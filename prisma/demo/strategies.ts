/**
 * Allocation strategies for the demo participants.
 *
 * Hand-written rather than random, for one reason: a leaderboard where everyone
 * holds a slightly different random basket converges on the same return and
 * ranks people by noise. Real participants cluster into recognisable
 * strategies — the concentrated tech bet, the index-hugger, the one who stayed
 * half in cash — and it is the SPREAD between those that makes a leaderboard
 * worth looking at.
 *
 * Weights are in ppm and must total at most 1_000_000; the remainder is cash.
 */
export interface DemoStrategy {
  label: string;
  weights: Record<string, number>;
}

export const DEMO_STRATEGIES: DemoStrategy[] = [
  {
    label: "Concentrated tech",
    weights: { NVDA: 300_000, MSFT: 250_000, AAPL: 250_000, GOOGL: 200_000 },
  },
  {
    label: "Big tech, evenly",
    weights: { AAPL: 200_000, MSFT: 200_000, GOOGL: 200_000, AMZN: 200_000, META: 200_000 },
  },
  {
    label: "European industrials",
    weights: { SAP: 250_000, SIE: 250_000, AIR: 250_000, ALV: 250_000 },
  },
  {
    label: "Semiconductors",
    weights: { NVDA: 300_000, ASML: 300_000, MSFT: 200_000, AAPL: 200_000 },
  },
  {
    label: "Defensive",
    weights: { NESN: 250_000, OR: 200_000, ALV: 200_000, SHEL: 150_000, SAP: 200_000 },
  },
  { label: "Half in cash", weights: { AAPL: 200_000, MSFT: 150_000, SAP: 150_000 } },
  {
    label: "Luxury and consumer",
    weights: { MC: 300_000, OR: 250_000, NESN: 250_000, AMZN: 200_000 },
  },
  {
    label: "High conviction Nvidia",
    weights: { NVDA: 300_000, ASML: 250_000, TSLA: 250_000, META: 200_000 },
  },
  {
    label: "Balanced global",
    weights: {
      AAPL: 150_000,
      MSFT: 150_000,
      SAP: 150_000,
      NESN: 150_000,
      SHEL: 100_000,
      ALV: 100_000,
      AIR: 100_000,
      MC: 100_000,
    },
  },
  {
    label: "Healthcare tilt",
    weights: { NOVO: 300_000, NESN: 250_000, SAP: 250_000, ALV: 200_000 },
  },
  {
    label: "Payments and platforms",
    weights: { ADYEN: 250_000, AMZN: 250_000, GOOGL: 250_000, META: 250_000 },
  },
  {
    label: "Energy and value",
    weights: { SHEL: 300_000, ALV: 250_000, SIE: 250_000, OR: 200_000 },
  },
  {
    label: "Momentum chaser",
    weights: { NVDA: 300_000, TSLA: 300_000, META: 200_000, ADYEN: 200_000 },
  },
  { label: "Contrarian", weights: { TSLA: 250_000, NOVO: 250_000, SHEL: 250_000, MC: 250_000 } },
  {
    label: "Cautious index",
    weights: {
      AAPL: 120_000,
      MSFT: 120_000,
      GOOGL: 120_000,
      AMZN: 120_000,
      SAP: 120_000,
      NESN: 100_000,
      ALV: 100_000,
      SIE: 100_000,
    },
  },
];
