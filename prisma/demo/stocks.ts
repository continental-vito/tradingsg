/**
 * The demo stock universe: the real one, from src/server/competition/universe.ts,
 * with the anchors the synthetic price generator needs. Prices are generated
 * by the mock market-data provider, not hard-coded here — a price in a fixture
 * goes stale the moment it is written, and the generator needs an anchor rather
 * than a snapshot.
 *
 * `anchorCents` is roughly where the name traded when this file was written,
 * used as the starting point of the synthetic series. `driftBps` and `volBps`
 * are the annualised drift and daily volatility the generator applies, chosen
 * so the demo leaderboard has a believable spread of winners and losers rather
 * than thirty participants clustered at ±0.4%.
 */
import { UNIVERSE, type UniverseEntry } from "../../src/server/competition/universe";

export interface DemoStock extends UniverseEntry {
  currency: string;
  anchorCents: bigint;
  driftBps: number;
  volBps: number;
}

/** [anchor in cents, annual drift in bps, daily volatility in bps] */
const PROFILES: Record<string, [bigint, number, number]> = {
  AC: [4_550n, 900, 170],
  AI: [17_400n, 600, 95],
  AIR: [19_800n, 1_100, 150],
  MT: [2_950n, 300, 210],
  CS: [3_980n, 700, 115],
  BNP: [7_600n, 800, 150],
  EN: [3_900n, 400, 120],
  BVI: [2_820n, 300, 110],
  CAP: [14_800n, -500, 190],
  CA: [1_340n, -200, 140],
  ACA: [1_620n, 700, 145],
  BN: [7_250n, 500, 90],
  DSY: [2_790n, -900, 200],
  FGR: [12_100n, 1_300, 125],
  ENGI: [1_850n, 900, 105],
  EL: [26_400n, 800, 120],
  ERF: [6_450n, 200, 185],
  ENX: [13_300n, 1_200, 130],
  RMS: [219_000n, 400, 150],
  KER: [24_800n, -600, 260],
  OR: [37_800n, -200, 112],
  LR: [12_200n, 900, 120],
  MC: [62_300n, 200, 158],
  ML: [3_180n, -100, 135],
  ORA: [1_420n, 1_000, 95],
  RI: [8_900n, -800, 160],
  PUB: [8_850n, 100, 140],
  RNO: [4_050n, -300, 215],
  SAF: [28_600n, 1_500, 140],
  SGO: [9_600n, 700, 150],
  SAN: [8_420n, -400, 125],
  SU: [23_100n, 1_000, 150],
  GLE: [5_480n, 1_400, 190],
  STLAP: [880n, -900, 260],
  STMPA: [2_250n, 300, 280],
  HO: [24_900n, 1_600, 170],
  TTE: [5_380n, 200, 125],
  URW: [8_640n, 500, 175],
  VIE: [2_980n, 500, 105],
  DG: [11_950n, 600, 110],
  BTC: [9_450_000n, 2_000, 320],
  SXR8: [57_800n, 900, 95],
};

export const DEMO_STOCKS: DemoStock[] = UNIVERSE.map((entry) => {
  const profile = PROFILES[entry.symbol];
  if (!profile) throw new Error(`prisma/demo/stocks.ts has no price profile for ${entry.symbol}.`);
  const [anchorCents, driftBps, volBps] = profile;
  return { ...entry, currency: "EUR", anchorCents, driftBps, volBps };
});
