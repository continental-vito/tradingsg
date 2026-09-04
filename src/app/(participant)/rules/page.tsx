import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { requireUser } from "@/server/auth/guard";
import { db } from "@/server/db";
import { formatCents } from "@/server/money";

export const metadata: Metadata = { title: "Rules" };
export const dynamic = "force-dynamic";

const TRADING_MODE: Record<string, string> = {
  ANYTIME: "You may change your portfolio whenever you like.",
  ONCE_PER_PERIOD: "You may change your portfolio a limited number of times per period.",
  WINDOWS: "You may change your portfolio only during scheduled trading windows.",
  LOCKED: "Portfolios are locked. Your initial allocation runs to the end.",
};

const PRICE_MODE: Record<string, string> = {
  LAST_CLOSE:
    "Portfolios are valued at the official closing price, using the same price for everyone.",
  LIVE: "Your own headline figure uses the latest available quote; the leaderboard still uses the close.",
};

/**
 * The rules page reads the live CompetitionSettings row rather than restating
 * anything in prose. The brief is explicit that the rules are configurable
 * rather than hard-coded, and a rules page that can disagree with the engine is
 * worse than none.
 */
export default async function RulesPage() {
  const user = await requireUser();

  const participant = await db.participant.findFirst({
    where: { userId: user.id, deletedAt: null },
    orderBy: { joinedAt: "desc" },
    include: {
      competition: {
        include: {
          settings: { where: { supersededAt: null }, orderBy: { revision: "desc" }, take: 1 },
          _count: { select: { stocks: true } },
        },
      },
    },
  });
  if (!participant) notFound();

  const competition = participant.competition;
  const s = competition.settings[0];
  const currency = competition.currency;

  const pct = (ppm: number) => `${(ppm / 10_000).toFixed(ppm % 10_000 === 0 ? 0 : 1)}%`;

  const groups: { title: string; rules: { label: string; value: string; note?: string }[] }[] = s
    ? [
        {
          title: "Capital and the stock universe",
          rules: [
            {
              label: "Starting capital",
              value: formatCents(competition.startingCapitalCents, currency),
              note: "Identical for every participant, granted once. Nothing is ever added, which is what makes comparing returns fair.",
            },
            {
              label: "Stocks available",
              value: `${competition._count.stocks} stocks`,
              note: "Chosen by the administrator. You may only hold names from this list.",
            },
            {
              label: "Fractional shares",
              value: s.allowFractionalShares ? "Allowed" : "Whole shares only",
              note: s.allowFractionalShares
                ? "Your allocation is filled exactly, to six decimal places of a share."
                : "Amounts round down to whole shares, and the remainder stays in cash.",
            },
          ],
        },
        {
          title: "Position limits",
          rules: [
            {
              label: "Largest single position",
              value: pct(s.maxPositionPpm),
              note: "Measured on what you would actually hold after rounding, not on what you typed.",
            },
            ...(s.minPositionPpm > 0
              ? [{ label: "Smallest position", value: pct(s.minPositionPpm) }]
              : []),
            ...(s.minPositions > 0
              ? [{ label: "Minimum number of stocks", value: String(s.minPositions) }]
              : []),
            ...(s.maxPositions !== null
              ? [{ label: "Maximum number of stocks", value: String(s.maxPositions) }]
              : []),
            {
              label: "Holding cash",
              value: s.allowCash
                ? s.maxCashPpm >= 1_000_000
                  ? "Allowed, without limit"
                  : `Allowed, up to ${pct(s.maxCashPpm)}`
                : "Not allowed — you must invest everything",
            },
          ],
        },
        {
          title: "Trading",
          rules: [
            {
              label: "When you may trade",
              value: TRADING_MODE[s.tradingMode] ?? s.tradingMode,
              note:
                s.tradingMode === "ONCE_PER_PERIOD"
                  ? `${s.maxChangesPerPeriod} change${s.maxChangesPerPeriod === 1 ? "" : "s"} per ${s.periodUnit.toLowerCase()}.`
                  : undefined,
            },
            ...(s.lockAfterDate
              ? [
                  {
                    label: "Portfolios lock on",
                    value: s.lockAfterDate,
                    note: "After this date the competition runs to the end with the positions you hold.",
                  },
                ]
              : []),
            {
              label: "Transaction fees",
              value:
                s.feeModel === "NONE"
                  ? "None"
                  : s.feeModel === "FLAT"
                    ? `${formatCents(s.feeFlatCents, currency)} per order`
                    : `${(s.feeBps / 100).toFixed(2)}% of each order`,
              note:
                s.feeModel === "NONE"
                  ? undefined
                  : "Fees come out of your portfolio, so trading often costs you return.",
            },
            {
              label: "Smallest trade",
              value: formatCents(s.minTradeValueCents, currency),
              note: "Smaller changes are skipped rather than generating an order for nothing.",
            },
            { label: "Short selling", value: s.allowShort ? "Allowed" : "Not allowed" },
          ],
        },
        {
          title: "How performance is measured",
          rules: [
            {
              label: "Valuation",
              value: PRICE_MODE[s.priceMode] ?? s.priceMode,
            },
            {
              label: "Ranking",
              value: "By percentage return",
              note: "Not by euros gained. Everyone started with the same amount, so the ranking measures decisions and nothing else.",
            },
            {
              label: "Ties",
              value: "Share a rank",
              note: "Two identical returns genuinely share a place. Where a row order is needed, fewer trades wins.",
            },
            {
              label: "Participants who have not invested",
              value: "Listed separately, not ranked",
              note: "An uninvested portfolio is exactly flat, and ranking that mid-table would reward not playing.",
            },
          ],
        },
      ]
    : [];

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Competition rules</h1>
        <p className="mt-1.5 text-sm text-[var(--text-muted)]">
          These are the rules currently in force for {competition.name}, read straight from the
          competition&rsquo;s settings. If an administrator changes one, this page changes with it.
        </p>
      </div>

      {!s ? (
        <Card>
          <p className="text-sm text-[var(--text-muted)]">
            No rules have been configured for this competition yet.
          </p>
        </Card>
      ) : (
        groups.map((group) => (
          <Card key={group.title}>
            <h2 className="text-sm font-medium">{group.title}</h2>
            <dl className="mt-3 divide-y divide-[var(--border)]">
              {group.rules.map((rule) => (
                <div key={rule.label} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <dt className="text-sm text-[var(--text-muted)]">{rule.label}</dt>
                    <dd className="text-sm font-medium">{rule.value}</dd>
                  </div>
                  {rule.note ? (
                    <p className="mt-1 text-xs text-[var(--text-muted)]">{rule.note}</p>
                  ) : null}
                </div>
              ))}
            </dl>
          </Card>
        ))
      )}

      <Card>
        <h2 className="text-sm font-medium">No real money</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Every euro in this competition is virtual. Nothing is bought, nothing is sold, no account
          is opened anywhere, and nothing here is investment advice.
        </p>
      </Card>
    </div>
  );
}
