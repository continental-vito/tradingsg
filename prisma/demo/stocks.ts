/**
 * The default stock universe. Prices are seeded by the mock market-data
 * provider, not hard-coded here — a price in a fixture goes stale the moment
 * it is written, and the generator needs an anchor rather than a snapshot.
 *
 * `anchorCents` is that anchor: roughly where the name traded when this file was
 * written, used as the starting point of the synthetic series. `driftBps` and
 * `volBps` are the annualised drift and daily volatility the generator applies,
 * chosen so the demo leaderboard has a believable spread of winners and losers
 * rather than thirty participants clustered at ±0.4%.
 */
export interface DemoStock {
  symbol: string;
  /**
   * The listing to fetch from a real provider. Every one is EUR-quoted and
   * was verified against Yahoo before being written here: the US names use
   * their XETRA lines (Apple as APC.DE, not AAPL) because this competition
   * values everything in euro and the engine does not convert currencies.
   * Nestlé, Novo Nordisk and Shell use their EUR listings for the same
   * reason — their home lines quote in CHF, DKK and pence, and pence would
   * be a hundredfold error.
   */
  providerSymbol: string;
  name: string;
  exchange: string;
  currency: string;
  sector: string;
  anchorCents: bigint;
  driftBps: number;
  volBps: number;
}

export const DEMO_STOCKS: DemoStock[] = [
  {
    symbol: "AAPL",
    providerSymbol: "APC.DE",
    name: "Apple",
    exchange: "NASDAQ",
    currency: "EUR",
    sector: "Technology",
    anchorCents: 21_450n,
    driftBps: 900,
    volBps: 145,
  },
  {
    symbol: "MSFT",
    providerSymbol: "MSF.DE",
    name: "Microsoft",
    exchange: "NASDAQ",
    currency: "EUR",
    sector: "Technology",
    anchorCents: 38_900n,
    driftBps: 1100,
    volBps: 132,
  },
  {
    symbol: "NVDA",
    providerSymbol: "NVD.DE",
    name: "Nvidia",
    exchange: "NASDAQ",
    currency: "EUR",
    sector: "Semiconductors",
    anchorCents: 11_280n,
    driftBps: 2600,
    volBps: 310,
  },
  {
    symbol: "AMZN",
    providerSymbol: "AMZ.DE",
    name: "Amazon",
    exchange: "NASDAQ",
    currency: "EUR",
    sector: "Consumer Discretionary",
    anchorCents: 17_640n,
    driftBps: 1200,
    volBps: 178,
  },
  {
    symbol: "GOOGL",
    providerSymbol: "ABEA.DE",
    name: "Alphabet",
    exchange: "NASDAQ",
    currency: "EUR",
    sector: "Communication Services",
    anchorCents: 16_310n,
    driftBps: 1000,
    volBps: 165,
  },
  {
    symbol: "TSLA",
    providerSymbol: "TL0.DE",
    name: "Tesla",
    exchange: "NASDAQ",
    currency: "EUR",
    sector: "Automotive",
    anchorCents: 22_070n,
    driftBps: -400,
    volBps: 395,
  },
  {
    symbol: "META",
    providerSymbol: "FB2A.DE",
    name: "Meta Platforms",
    exchange: "NASDAQ",
    currency: "EUR",
    sector: "Communication Services",
    anchorCents: 52_400n,
    driftBps: 1400,
    volBps: 205,
  },
  {
    symbol: "SAP",
    providerSymbol: "SAP.DE",
    name: "SAP",
    exchange: "XETRA",
    currency: "EUR",
    sector: "Technology",
    anchorCents: 22_980n,
    driftBps: 800,
    volBps: 118,
  },
  {
    symbol: "ASML",
    providerSymbol: "ASML.AS",
    name: "ASML Holding",
    exchange: "AMS",
    currency: "EUR",
    sector: "Semiconductors",
    anchorCents: 68_500n,
    driftBps: 1500,
    volBps: 232,
  },
  {
    symbol: "SIE",
    providerSymbol: "SIE.DE",
    name: "Siemens",
    exchange: "XETRA",
    currency: "EUR",
    sector: "Industrials",
    anchorCents: 19_120n,
    driftBps: 600,
    volBps: 124,
  },
  {
    symbol: "MC",
    providerSymbol: "MC.PA",
    name: "LVMH",
    exchange: "EPA",
    currency: "EUR",
    sector: "Consumer Discretionary",
    anchorCents: 62_300n,
    driftBps: 200,
    volBps: 158,
  },
  {
    symbol: "NESN",
    providerSymbol: "NESR.DE",
    name: "Nestlé",
    exchange: "SIX",
    currency: "EUR",
    sector: "Consumer Staples",
    anchorCents: 8_640n,
    driftBps: 150,
    volBps: 78,
  },
  {
    symbol: "NOVO",
    providerSymbol: "NOV.DE",
    name: "Novo Nordisk",
    exchange: "CPH",
    currency: "EUR",
    sector: "Healthcare",
    anchorCents: 9_820n,
    driftBps: -600,
    volBps: 245,
  },
  {
    symbol: "AIR",
    providerSymbol: "AIR.PA",
    name: "Airbus",
    exchange: "EPA",
    currency: "EUR",
    sector: "Industrials",
    anchorCents: 16_450n,
    driftBps: 700,
    volBps: 142,
  },
  {
    symbol: "SHEL",
    providerSymbol: "SHELL.AS",
    name: "Shell",
    exchange: "LSE",
    currency: "EUR",
    sector: "Energy",
    anchorCents: 3_190n,
    driftBps: 300,
    volBps: 156,
  },
  {
    symbol: "ADYEN",
    providerSymbol: "ADYEN.AS",
    name: "Adyen",
    exchange: "AMS",
    currency: "EUR",
    sector: "Financials",
    anchorCents: 148_200n,
    driftBps: 1800,
    volBps: 288,
  },
  {
    symbol: "ALV",
    providerSymbol: "ALV.DE",
    name: "Allianz",
    exchange: "XETRA",
    currency: "EUR",
    sector: "Financials",
    anchorCents: 33_400n,
    driftBps: 500,
    volBps: 96,
  },
  {
    symbol: "OR",
    providerSymbol: "OR.PA",
    name: "L'Oréal",
    exchange: "EPA",
    currency: "EUR",
    sector: "Consumer Staples",
    anchorCents: 37_800n,
    driftBps: -200,
    volBps: 112,
  },
];
