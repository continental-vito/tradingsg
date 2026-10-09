import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import {
  AdvisorError,
  type AdvisorInput,
  type AdvisorProposal,
  type AllocationAdvisor,
} from "./advisor";

/**
 * The Claude-backed advisor. The only file in the codebase that knows which
 * provider sits behind the AI investor.
 *
 * One structured-output request per decision: the response is parsed against a
 * schema by the SDK, so there is no free text to scrape weights out of.
 */

const Proposal = z.object({
  rationale: z
    .string()
    .describe("Two to five sentences explaining the allocation, in plain English."),
  allocations: z
    .array(
      z.object({
        symbol: z.string().describe("A ticker from the provided universe, exactly as given."),
        weightPercent: z
          .number()
          .describe("Target share of total portfolio value, in percent, e.g. 12.5."),
      }),
    )
    .describe("The complete target portfolio. Anything not listed is sold to cash."),
});

const SYSTEM = `You manage one portfolio in an internal virtual stock-trading competition. Participants are ranked by total return on virtual capital; no real money is involved.

Each time you are called you set the complete target allocation for the portfolio: every position you want to hold, as a percentage of total portfolio value. Anything you leave out is sold. Whatever you do not allocate stays in cash. Weights are long-only (no negatives) and must add up to at most 100.

Every order costs a transaction fee, so turnover has a real cost: only change a position when you expect the move to be worth more than the fee. Keeping the current allocation is a legitimate decision — return the same weights.

Follow the administrator's strategy. Use only the tickers in the universe you are given, spelled exactly as given. Respect every rule listed; a proposal that breaks one is refused and the week's rebalance is lost.`;

function pct(ppm: number): string {
  return `${(ppm / 10_000).toFixed(2)}%`;
}

function euros(cents: bigint, currency: string): string {
  return `${(Number(cents) / 100).toFixed(2)} ${currency}`;
}

export function renderPrompt(input: AdvisorInput): string {
  const r = input.rules;
  const rules = [
    `Largest single position: ${pct(r.maxPositionPpm)}.`,
    r.minPositionPpm > 0 ? `Smallest position you may hold: ${pct(r.minPositionPpm)}.` : null,
    r.minPositions > 0 ? `Hold at least ${r.minPositions} different stocks.` : null,
    r.maxPositions !== null ? `Hold at most ${r.maxPositions} different stocks.` : null,
    r.allowCash
      ? `Cash must stay between ${pct(r.minCashPpm)} and ${pct(r.maxCashPpm)} of the portfolio.`
      : "Cash is not allowed: weights must add up to 100.",
    r.feeModel === "NONE"
      ? "There is no transaction fee."
      : `Transaction fee: ${(r.feeBps / 100).toFixed(2)}% of every buy and every sell.`,
    r.rebalancesPerPeriod !== null
      ? `You may rebalance ${r.rebalancesPerPeriod === 1 ? "once" : `${r.rebalancesPerPeriod} times`} per ${r.periodUnit.toLowerCase()}, so this allocation is likely to be held until the next ${r.periodUnit.toLowerCase()}.`
      : null,
  ].filter(Boolean);

  const rows = input.stocks.map((s) =>
    [
      s.symbol,
      s.name,
      s.sector ?? "",
      euros(s.priceCents, input.currency),
      s.change5dPpm === null ? "n/a" : pct(s.change5dPpm),
      s.change20dPpm === null ? "n/a" : pct(s.change20dPpm),
      pct(s.currentWeightPpm),
    ].join(" | "),
  );

  return [
    `Today is ${input.asOfDate}.`,
    "",
    "## Administrator's strategy",
    input.strategy.trim(),
    "",
    "## Rules",
    ...rules.map((line) => `- ${line}`),
    "",
    "## Portfolio",
    `Total value: ${euros(input.totalValueCents, input.currency)}; cash: ${euros(input.cashCents, input.currency)}; return so far: ${pct(input.totalReturnPpm)}.`,
    "",
    "## Universe",
    "ticker | name | sector | last close | 5-day change | 20-day change | current weight",
    ...rows,
    ...(input.previousErrors && input.previousErrors.length > 0
      ? [
          "",
          "## Your previous proposal was refused",
          ...input.previousErrors.map((e) => `- ${e}`),
          "Correct these and propose again.",
        ]
      : []),
  ].join("\n");
}

export class ClaudeAdvisor implements AllocationAdvisor {
  readonly name = "claude";
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async propose(input: AdvisorInput): Promise<AdvisorProposal> {
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: input.model,
        max_tokens: 16_000,
        // If the model declines, the API retries on a fallback model inside
        // the same call rather than costing the AI its week.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM,
        output_config: { effort: "high", format: betaZodOutputFormat(Proposal) },
        messages: [{ role: "user", content: renderPrompt(input) }],
      });
    } catch (error: unknown) {
      if (error instanceof Anthropic.AuthenticationError) {
        throw new AdvisorError(
          "The AI provider rejected the API key. Check the key set in the environment.",
          "AUTH",
        );
      }
      if (error instanceof Anthropic.RateLimitError) {
        throw new AdvisorError(
          "The AI provider is rate-limiting requests. Try again later.",
          "RATE_LIMIT",
        );
      }
      if (error instanceof Anthropic.APIError) {
        throw new AdvisorError(
          `The AI provider returned an error (${error.status ?? "no status"}): ${error.message}`,
          "API",
        );
      }
      throw error;
    }

    if (response.stop_reason === "refusal") {
      throw new AdvisorError("The model declined to propose an allocation.", "REFUSAL");
    }
    if (response.stop_reason === "max_tokens") {
      throw new AdvisorError("The model ran out of room before finishing its answer.", "TRUNCATED");
    }
    const parsed = response.parsed_output;
    if (!parsed) {
      throw new AdvisorError(
        "The model's answer could not be read as an allocation.",
        "UNPARSEABLE",
      );
    }

    return {
      allocations: parsed.allocations,
      rationale: parsed.rationale,
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}
