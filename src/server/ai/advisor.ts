/**
 * The seam between the AI investor and the language model that advises it.
 *
 * The advisor only PROPOSES target weights. Everything that makes a trade
 * legal — the weekly token, the position caps, the 1% fee, the cash rules, the
 * ledger invariants — is enforced afterwards by the same planner and commit
 * every participant goes through. A model that ignores an instruction produces
 * a rejected plan, never an illegal trade.
 *
 * One implementation file per provider, like market data and email; nothing
 * outside it may name the provider.
 */

export interface AdvisorStock {
  symbol: string;
  name: string;
  sector: string | null;
  priceCents: bigint;
  /** Price change over the last ~5 and ~20 trading days, in ppm. Null without history. */
  change5dPpm: number | null;
  change20dPpm: number | null;
  /** The share of the portfolio this stock is right now, in ppm. */
  currentWeightPpm: number;
}

export interface AdvisorRules {
  maxPositionPpm: number;
  minPositionPpm: number;
  minPositions: number;
  maxPositions: number | null;
  allowCash: boolean;
  minCashPpm: number;
  maxCashPpm: number;
  feeBps: number;
  feeModel: string;
  rebalancesPerPeriod: number | null;
  periodUnit: string;
}

export interface AdvisorInput {
  model: string;
  /** The administrator's instructions. */
  strategy: string;
  asOfDate: string;
  currency: string;
  totalValueCents: bigint;
  cashCents: bigint;
  totalReturnPpm: number;
  stocks: AdvisorStock[];
  rules: AdvisorRules;
  /** What the planner refused last attempt, so the model can correct itself. */
  previousErrors?: string[];
}

export interface AdvisorProposal {
  allocations: { symbol: string; weightPercent: number }[];
  rationale: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface AllocationAdvisor {
  readonly name: string;
  propose(input: AdvisorInput): Promise<AdvisorProposal>;
}

export class AdvisorError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "AdvisorError";
  }
}

/** The model an AI investor uses unless the administrator picks another. */
export const DEFAULT_AI_MODEL = "claude-opus-5-5";

/** Offered on the admin page. Any valid model id can still be typed. */
export const AI_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;
