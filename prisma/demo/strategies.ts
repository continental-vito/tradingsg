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
    label: "French luxury",
    weights: { MC: 300_000, RMS: 300_000, KER: 200_000, OR: 200_000 },
  },
  {
    label: "Index hugger",
    weights: { SXR8: 300_000, SU: 150_000, TTE: 150_000, MC: 150_000, SAN: 150_000, AI: 100_000 },
  },
  {
    label: "Aerospace and defence",
    weights: { AIR: 300_000, SAF: 300_000, HO: 250_000, EN: 150_000 },
  },
  {
    label: "Crypto conviction",
    weights: { BTC: 300_000, SXR8: 300_000, STMPA: 200_000, CAP: 200_000 },
  },
  {
    label: "Defensive",
    weights: { BN: 250_000, ORA: 200_000, SAN: 200_000, VIE: 150_000, ENGI: 200_000 },
  },
  { label: "Half in cash", weights: { SXR8: 200_000, TTE: 150_000, AI: 150_000 } },
  {
    label: "French banks",
    weights: { BNP: 300_000, GLE: 250_000, ACA: 250_000, CS: 200_000 },
  },
  {
    label: "High conviction Bitcoin",
    weights: { BTC: 300_000, ENX: 250_000, GLE: 250_000, STLAP: 200_000 },
  },
  {
    label: "Balanced",
    weights: {
      SXR8: 150_000,
      MC: 150_000,
      TTE: 150_000,
      SU: 150_000,
      AIR: 100_000,
      BNP: 100_000,
      SAN: 100_000,
      DG: 100_000,
    },
  },
  {
    label: "Healthcare tilt",
    weights: { SAN: 300_000, EL: 250_000, ERF: 250_000, AI: 200_000 },
  },
  {
    label: "Infrastructure",
    weights: { DG: 250_000, FGR: 250_000, SGO: 250_000, LR: 250_000 },
  },
  {
    label: "Energy and value",
    weights: { TTE: 300_000, ENGI: 250_000, MT: 250_000, CA: 200_000 },
  },
  {
    label: "Momentum chaser",
    weights: { BTC: 300_000, SAF: 300_000, HO: 200_000, ENX: 200_000 },
  },
  { label: "Contrarian", weights: { KER: 250_000, STLAP: 250_000, RNO: 250_000, DSY: 250_000 } },
  {
    label: "Cautious index",
    weights: {
      SXR8: 300_000,
      AI: 100_000,
      SU: 100_000,
      OR: 100_000,
      SAN: 100_000,
      TTE: 100_000,
      BN: 100_000,
      CS: 100_000,
    },
  },
];
