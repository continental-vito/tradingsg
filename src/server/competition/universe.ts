/**
 * The tradable universe: the 40 members of the CAC 40, Bitcoin, and one S&P 500
 * ETF.
 *
 * CAC 40 membership as of October 2026 — Eiffage joined in December 2025 in
 * place of Edenred, and Euronext in September 2025 in place of Teleperformance;
 * the September 2026 review made no change. Euronext reviews the index
 * quarterly, so this list is a snapshot: when a name enters or leaves, edit it
 * here and run the relaunch again, or add and remove the one stock from the
 * admin Stocks page.
 *
 * `symbol` is the Euronext Paris mnemonic, which is what a French participant
 * recognises. `providerSymbol` is the listing the market-data job fetches, and
 * every one is quoted in EUR: the engine does no currency conversion, and a
 * listing in any other currency is refused rather than booked at the wrong
 * scale. That is why:
 *
 * - ArcelorMittal is fetched from its Amsterdam line (MT.AS), in EUR.
 * - Bitcoin is the BTC-EUR pair, not BTC-USD.
 * - The S&P 500 ETF is the iShares Core S&P 500 UCITS ETF, USD (Acc) share
 *   class — the fund is denominated in dollars and accumulates its dividends —
 *   fetched from its XETRA line SXR8.DE, which trades in EUR.
 */
export interface UniverseEntry {
  symbol: string;
  providerSymbol: string;
  name: string;
  exchange: string;
  sector: string;
}

export const CAC40_UNIVERSE: readonly UniverseEntry[] = [
  {
    symbol: "AC",
    providerSymbol: "AC.PA",
    name: "Accor",
    exchange: "EPA",
    sector: "Consumer Discretionary",
  },
  {
    symbol: "AI",
    providerSymbol: "AI.PA",
    name: "Air Liquide",
    exchange: "EPA",
    sector: "Materials",
  },
  {
    symbol: "AIR",
    providerSymbol: "AIR.PA",
    name: "Airbus",
    exchange: "EPA",
    sector: "Industrials",
  },
  {
    symbol: "MT",
    providerSymbol: "MT.AS",
    name: "ArcelorMittal",
    exchange: "AMS",
    sector: "Materials",
  },
  { symbol: "CS", providerSymbol: "CS.PA", name: "AXA", exchange: "EPA", sector: "Financials" },
  {
    symbol: "BNP",
    providerSymbol: "BNP.PA",
    name: "BNP Paribas",
    exchange: "EPA",
    sector: "Financials",
  },
  {
    symbol: "EN",
    providerSymbol: "EN.PA",
    name: "Bouygues",
    exchange: "EPA",
    sector: "Industrials",
  },
  {
    symbol: "BVI",
    providerSymbol: "BVI.PA",
    name: "Bureau Veritas",
    exchange: "EPA",
    sector: "Industrials",
  },
  {
    symbol: "CAP",
    providerSymbol: "CAP.PA",
    name: "Capgemini",
    exchange: "EPA",
    sector: "Technology",
  },
  {
    symbol: "CA",
    providerSymbol: "CA.PA",
    name: "Carrefour",
    exchange: "EPA",
    sector: "Consumer Staples",
  },
  {
    symbol: "ACA",
    providerSymbol: "ACA.PA",
    name: "Crédit Agricole",
    exchange: "EPA",
    sector: "Financials",
  },
  {
    symbol: "BN",
    providerSymbol: "BN.PA",
    name: "Danone",
    exchange: "EPA",
    sector: "Consumer Staples",
  },
  {
    symbol: "DSY",
    providerSymbol: "DSY.PA",
    name: "Dassault Systèmes",
    exchange: "EPA",
    sector: "Technology",
  },
  {
    symbol: "FGR",
    providerSymbol: "FGR.PA",
    name: "Eiffage",
    exchange: "EPA",
    sector: "Industrials",
  },
  {
    symbol: "ENGI",
    providerSymbol: "ENGI.PA",
    name: "Engie",
    exchange: "EPA",
    sector: "Utilities",
  },
  {
    symbol: "EL",
    providerSymbol: "EL.PA",
    name: "EssilorLuxottica",
    exchange: "EPA",
    sector: "Healthcare",
  },
  {
    symbol: "ERF",
    providerSymbol: "ERF.PA",
    name: "Eurofins Scientific",
    exchange: "EPA",
    sector: "Healthcare",
  },
  {
    symbol: "ENX",
    providerSymbol: "ENX.PA",
    name: "Euronext",
    exchange: "EPA",
    sector: "Financials",
  },
  {
    symbol: "RMS",
    providerSymbol: "RMS.PA",
    name: "Hermès",
    exchange: "EPA",
    sector: "Consumer Discretionary",
  },
  {
    symbol: "KER",
    providerSymbol: "KER.PA",
    name: "Kering",
    exchange: "EPA",
    sector: "Consumer Discretionary",
  },
  {
    symbol: "OR",
    providerSymbol: "OR.PA",
    name: "L'Oréal",
    exchange: "EPA",
    sector: "Consumer Staples",
  },
  {
    symbol: "LR",
    providerSymbol: "LR.PA",
    name: "Legrand",
    exchange: "EPA",
    sector: "Industrials",
  },
  {
    symbol: "MC",
    providerSymbol: "MC.PA",
    name: "LVMH",
    exchange: "EPA",
    sector: "Consumer Discretionary",
  },
  {
    symbol: "ML",
    providerSymbol: "ML.PA",
    name: "Michelin",
    exchange: "EPA",
    sector: "Automotive",
  },
  {
    symbol: "ORA",
    providerSymbol: "ORA.PA",
    name: "Orange",
    exchange: "EPA",
    sector: "Communication Services",
  },
  {
    symbol: "RI",
    providerSymbol: "RI.PA",
    name: "Pernod Ricard",
    exchange: "EPA",
    sector: "Consumer Staples",
  },
  {
    symbol: "PUB",
    providerSymbol: "PUB.PA",
    name: "Publicis",
    exchange: "EPA",
    sector: "Communication Services",
  },
  {
    symbol: "RNO",
    providerSymbol: "RNO.PA",
    name: "Renault",
    exchange: "EPA",
    sector: "Automotive",
  },
  {
    symbol: "SAF",
    providerSymbol: "SAF.PA",
    name: "Safran",
    exchange: "EPA",
    sector: "Industrials",
  },
  {
    symbol: "SGO",
    providerSymbol: "SGO.PA",
    name: "Saint-Gobain",
    exchange: "EPA",
    sector: "Industrials",
  },
  {
    symbol: "SAN",
    providerSymbol: "SAN.PA",
    name: "Sanofi",
    exchange: "EPA",
    sector: "Healthcare",
  },
  {
    symbol: "SU",
    providerSymbol: "SU.PA",
    name: "Schneider Electric",
    exchange: "EPA",
    sector: "Industrials",
  },
  {
    symbol: "GLE",
    providerSymbol: "GLE.PA",
    name: "Société Générale",
    exchange: "EPA",
    sector: "Financials",
  },
  {
    symbol: "STLAP",
    providerSymbol: "STLAP.PA",
    name: "Stellantis",
    exchange: "EPA",
    sector: "Automotive",
  },
  {
    symbol: "STMPA",
    providerSymbol: "STMPA.PA",
    name: "STMicroelectronics",
    exchange: "EPA",
    sector: "Semiconductors",
  },
  { symbol: "HO", providerSymbol: "HO.PA", name: "Thales", exchange: "EPA", sector: "Industrials" },
  {
    symbol: "TTE",
    providerSymbol: "TTE.PA",
    name: "TotalEnergies",
    exchange: "EPA",
    sector: "Energy",
  },
  {
    symbol: "URW",
    providerSymbol: "URW.PA",
    name: "Unibail-Rodamco-Westfield",
    exchange: "EPA",
    sector: "Real Estate",
  },
  { symbol: "VIE", providerSymbol: "VIE.PA", name: "Veolia", exchange: "EPA", sector: "Utilities" },
  { symbol: "DG", providerSymbol: "DG.PA", name: "Vinci", exchange: "EPA", sector: "Industrials" },
];

export const EXTRA_UNIVERSE: readonly UniverseEntry[] = [
  {
    symbol: "BTC",
    providerSymbol: "BTC-EUR",
    name: "Bitcoin",
    exchange: "CRYPTO",
    sector: "Crypto",
  },
  {
    symbol: "SXR8",
    providerSymbol: "SXR8.DE",
    name: "iShares Core S&P 500 UCITS ETF USD (Acc)",
    exchange: "XETRA",
    sector: "ETF",
  },
];

/** Everything tradable, in display order. */
export const UNIVERSE: readonly UniverseEntry[] = [...CAC40_UNIVERSE, ...EXTRA_UNIVERSE];
