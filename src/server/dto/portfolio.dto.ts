import "server-only";
import { db } from "@/server/db";
import { notFound } from "next/navigation";
import { toPpm } from "@/server/money";
import { money, ratio, shares, type MoneyDto, type RatioDto, type SharesDto } from "./serialize";

/**
 * Everything the participant dashboard renders, assembled server-side.
 *
 * Read straight from the stored valuations rather than recomputed: the number
 * on the dashboard and the number on the leaderboard must be the same number,
 * and the only way to guarantee that is for both to read one row.
 */

export interface HoldingDto {
  stockId: string;
  symbol: string;
  name: string;
  shares: SharesDto;
  price: MoneyDto;
  value: MoneyDto;
  costBasis: MoneyDto;
  gainLoss: MoneyDto;
  gainLossRatio: RatioDto;
  weightPpm: number;
  weightText: string;
  priceIsStale: boolean;
}

export interface DashboardDto {
  competition: {
    id: string;
    name: string;
    slug: string;
    status: string;
    endsAt: string;
    startDate: string;
    endDate: string;
    currency: string;
  };
  participant: {
    id: string;
    displayName: string;
    portfolioId: string | null;
    hasInvested: boolean;
  };
  headline: {
    initialCapital: MoneyDto;
    currentValue: MoneyDto;
    totalGainLoss: MoneyDto;
    totalReturn: RatioDto;
    todayGainLoss: MoneyDto | null;
    todayReturn: RatioDto | null;
    weekGainLoss: MoneyDto | null;
    weekReturn: RatioDto | null;
    cash: MoneyDto;
    cashWeightPpm: number;
    asOfDate: string | null;
    priceQuality: string;
  };
  best: { symbol: string; name: string; ratio: RatioDto; gain: MoneyDto } | null;
  worst: { symbol: string; name: string; ratio: RatioDto; gain: MoneyDto } | null;
  holdings: HoldingDto[];
  series: { date: string; label: string; valueCents: number }[];
  rank: { position: number | null; of: number; ratio: RatioDto } | null;
}

function labelFor(dateKey: string): string {
  const [, month, day] = dateKey.split("-");
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${day} ${months[Number(month) - 1] ?? ""}`;
}

export async function loadDashboard(userId: string): Promise<DashboardDto | null> {
  const participant = await db.participant.findFirst({
    where: { userId, deletedAt: null },
    orderBy: { joinedAt: "desc" },
    include: {
      competition: true,
      portfolio: { include: { holdings: { include: { stock: true } } } },
    },
  });
  if (!participant) return null;

  const { competition, portfolio } = participant;
  const currency = competition.currency;

  if (!portfolio) notFound();

  const latest = await db.portfolioValuation.findFirst({
    where: { portfolioId: portfolio.id, kind: "EOD" },
    orderBy: { asOfDate: "desc" },
    include: { holdingValuations: { include: { stock: true } } },
  });

  const valuations = await db.portfolioValuation.findMany({
    where: { portfolioId: portfolio.id, kind: "EOD" },
    orderBy: { asOfDate: "asc" },
    select: { asOfDate: true, totalValueCents: true },
  });

  const currentValueCents = latest?.totalValueCents ?? portfolio.cashCents;
  const totalGainLossCents = currentValueCents - portfolio.initialCapitalCents;

  const holdings: HoldingDto[] = (latest?.holdingValuations ?? [])
    .slice()
    .sort((a, b) => (b.marketValueCents > a.marketValueCents ? 1 : -1))
    .map((hv) => ({
      stockId: hv.stockId,
      symbol: hv.stock.symbol,
      name: hv.stock.name,
      shares: shares(hv.microShares),
      price: money(hv.priceCents, currency),
      value: money(hv.marketValueCents, currency),
      costBasis: money(hv.costBasisCents, currency),
      gainLoss: money(hv.unrealizedPnlCents, currency),
      gainLossRatio: ratio(hv.positionReturnPpm),
      weightPpm: hv.weightPpm,
      weightText: `${(hv.weightPpm / 10_000).toFixed(1)}%`,
      // Anything carried forward more than a few days is flagged in the table,
      // rather than shown as a confident current price.
      priceIsStale: hv.priceSource !== "CLOSE" && hv.priceAgeDays > 3,
    }));

  const ranked = [...holdings].sort((a, b) => b.gainLossRatio.ppm - a.gainLossRatio.ppm);
  const bestHolding = ranked[0];
  const worstHolding = ranked[ranked.length - 1];

  const snapshot = await db.leaderboardSnapshot.findFirst({
    where: { competitionId: competition.id, kind: "DAILY" },
    orderBy: { asOfDate: "desc" },
    include: { entries: { where: { participantId: participant.id }, take: 1 } },
  });
  const myEntry = snapshot?.entries[0];

  return {
    competition: {
      id: competition.id,
      name: competition.name,
      slug: competition.slug,
      status: competition.status,
      endsAt: competition.endsAt.toISOString(),
      startDate: competition.startDate,
      endDate: competition.endDate,
      currency,
    },
    participant: {
      id: participant.id,
      displayName: participant.displayName,
      portfolioId: portfolio.id,
      hasInvested: portfolio.setupCompletedAt !== null,
    },
    headline: {
      initialCapital: money(portfolio.initialCapitalCents, currency),
      currentValue: money(currentValueCents, currency),
      totalGainLoss: money(totalGainLossCents, currency),
      totalReturn: ratio(latest?.totalReturnPpm ?? 0),
      todayGainLoss:
        latest?.dailyReturnPpm != null && latest.previousValuationId
          ? money(
              currentValueCents -
                (valuations[valuations.length - 2]?.totalValueCents ?? currentValueCents),
              currency,
            )
          : null,
      todayReturn: latest?.dailyReturnPpm != null ? ratio(latest.dailyReturnPpm) : null,
      weekGainLoss:
        latest?.weeklyReturnPpm != null
          ? money(
              currentValueCents -
                (valuations[Math.max(0, valuations.length - 6)]?.totalValueCents ??
                  currentValueCents),
              currency,
            )
          : null,
      weekReturn: latest?.weeklyReturnPpm != null ? ratio(latest.weeklyReturnPpm) : null,
      cash: money(latest?.cashCents ?? portfolio.cashCents, currency),
      cashWeightPpm: toPpm(latest?.cashCents ?? portfolio.cashCents, currentValueCents),
      asOfDate: latest?.asOfDate ?? null,
      priceQuality: latest?.priceQuality ?? "OK",
    },
    best:
      bestHolding && bestHolding.gainLossRatio.ppm > 0
        ? {
            symbol: bestHolding.symbol,
            name: bestHolding.name,
            ratio: bestHolding.gainLossRatio,
            gain: bestHolding.gainLoss,
          }
        : null,
    worst:
      worstHolding && worstHolding !== bestHolding && worstHolding.gainLossRatio.ppm < 0
        ? {
            symbol: worstHolding.symbol,
            name: worstHolding.name,
            ratio: worstHolding.gainLossRatio,
            gain: worstHolding.gainLoss,
          }
        : null,
    holdings,
    series: valuations.map((v) => ({
      date: v.asOfDate,
      label: labelFor(v.asOfDate),
      valueCents: Number(v.totalValueCents),
    })),
    rank: myEntry
      ? {
          position: myEntry.rank,
          of: snapshot?.rankedCount ?? 0,
          ratio: ratio(myEntry.totalReturnPpm),
        }
      : null,
  };
}
