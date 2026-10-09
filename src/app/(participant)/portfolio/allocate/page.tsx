import type { Metadata } from "next";
import Link from "next/link";
import { joinCompetitionAction } from "@/app/actions/join";
import { JoinPrompt } from "@/components/join-prompt";
import { loadJoinable } from "@/server/dto/participation";
import { previewRebalanceAction, submitRebalanceAction } from "@/app/actions/portfolio";
import { AllocationEditor, type AllocatableStock } from "@/components/allocation-editor";
import { Alert } from "@/components/ui";
import { dateKeyOf } from "@/lib/dates";
import { requirePlayer } from "@/server/auth/guard";
import { db } from "@/server/db";
import { formatCents, toPpm } from "@/server/money";
import { buildPriceBook } from "@/server/portfolio/prices";
import { marketValue } from "@/server/money";
import { loadTradingAccess } from "@/server/portfolio/access";
import { TokenBanner } from "@/components/rebalance-token";

export const metadata: Metadata = { title: "Build your portfolio" };
export const dynamic = "force-dynamic";

export default async function AllocatePage() {
  const user = await requirePlayer();

  const participant = await db.participant.findFirst({
    where: { userId: user.id, deletedAt: null },
    orderBy: { joinedAt: "desc" },
    include: {
      competition: {
        include: {
          settings: { where: { supersededAt: null }, orderBy: { revision: "desc" }, take: 1 },
        },
      },
      portfolio: { include: { holdings: true } },
    },
  });
  // Not a 404. The page exists — this person simply has no participation yet,
  // which used to be every newly registered user and is still any admin.
  if (!participant?.portfolio) {
    const joinable = await loadJoinable();
    return <JoinPrompt {...joinable} join={joinCompetitionAction} />;
  }

  const { competition, portfolio } = participant;
  const settings = competition.settings[0];
  if (!settings) {
    return (
      <Alert>
        This competition has no rules configured yet, so allocations cannot be validated. Ask the
        competition administrator to finish setting it up.
      </Alert>
    );
  }

  const asOfDate = dateKeyOf(new Date(), competition.timezone);

  // Checked before anything is priced. A participant whose weekly token is
  // spent gets the banner instead of an editor they could fill in and only
  // then be refused — the commit re-checks regardless, so this is courtesy,
  // not the boundary.
  const access = await loadTradingAccess(db, portfolio.id);
  if (access && !access.decision.allowed) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Manage your portfolio</h1>
        </div>
        <TokenBanner
          tokens={access.tokens}
          reason={access.decision.reason?.message ?? "Trading is closed right now."}
        />
        <Link
          href="/portfolio"
          className="inline-block rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-medium hover:bg-[var(--surface-sunken)]"
        >
          Back to your portfolio
        </Link>
      </div>
    );
  }

  const universe = await db.competitionStock.findMany({
    where: { competitionId: competition.id, removedAt: null },
    orderBy: { sortOrder: "asc" },
    include: { stock: true },
  });

  const book = await buildPriceBook(
    db,
    universe.map((u) => u.stockId),
    asOfDate,
  );

  // Everything is valued at the same close the rebalance will execute at, so
  // the estimates on this page and the orders on the next one agree.
  let holdingsValue = 0n;
  for (const holding of portfolio.holdings) {
    const price = book.get(holding.stockId)?.priceCents ?? 0n;
    holdingsValue += marketValue(holding.microShares, price);
  }
  const totalValueCents = portfolio.cashCents + holdingsValue;

  const heldBy = new Map(portfolio.holdings.map((h) => [h.stockId, h]));

  const stocks: AllocatableStock[] = universe
    .filter((u) => u.isTradable && book.get(u.stockId))
    .map((u) => {
      const price = book.get(u.stockId)?.priceCents ?? 0n;
      const holding = heldBy.get(u.stockId);
      return {
        id: u.stockId,
        symbol: u.stock.symbol,
        name: u.stock.name,
        sector: u.stock.sector,
        priceText: formatCents(price, competition.currency),
        priceCents: price.toString(),
        currentWeightPpm: holding
          ? toPpm(marketValue(holding.microShares, price), totalValueCents)
          : 0,
      };
    });

  const isFirstTime = portfolio.setupCompletedAt === null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {isFirstTime ? "Build your portfolio" : "Manage your portfolio"}
        </h1>
        <p className="mt-1.5 text-sm text-[var(--text-muted)]">
          Choose what percentage of {formatCents(totalValueCents, competition.currency)} goes into
          each stock. Nothing is saved until you preview the changes and confirm them.
        </p>
      </div>

      {access?.tokens ? <TokenBanner tokens={access.tokens} /> : null}

      {stocks.length === 0 ? (
        <Alert>
          No stock in this competition has a price yet, so nothing can be allocated. Prices are
          written by the market-data job — ask the administrator to run it.
        </Alert>
      ) : (
        <AllocationEditor
          portfolioId={portfolio.id}
          stocks={stocks}
          currency={competition.currency}
          totalValueCents={totalValueCents.toString()}
          totalValueText={formatCents(totalValueCents, competition.currency)}
          maxPositionPpm={settings.maxPositionPpm}
          allowCash={settings.allowCash}
          allowShort={settings.allowShort}
          maxShortPositionPpm={settings.maxShortPositionPpm}
          maxGrossExposurePpm={settings.maxGrossExposurePpm}
          preview={previewRebalanceAction}
          submit={submitRebalanceAction}
        />
      )}
    </div>
  );
}
