import type { Metadata } from "next";
import {
  createAiInvestorAction,
  previewAiRebalanceAction,
  submitAiRebalanceAction,
  updateAiStrategyAction,
} from "@/app/actions/ai";
import { AiStrategyForm, CreateAiInvestorForm } from "@/components/admin-controls";
import { AllocationEditor } from "@/components/allocation-editor";
import { TokenBanner } from "@/components/rebalance-token";
import { Alert, Card, EmptyState } from "@/components/ui";
import { dateKeyOf } from "@/lib/dates";
import { requireAdmin } from "@/server/auth/guard";
import { db } from "@/server/db";
import { loadAllocatable } from "@/server/dto/allocation";
import { formatCents } from "@/server/money";
import { loadTradingAccess } from "@/server/portfolio/access";

export const metadata: Metadata = { title: "AI investor" };
export const dynamic = "force-dynamic";

const DEFAULT_STRATEGY =
  "Diversified across 6 to 10 names, sized by conviction. Changes only what " +
  "there is a reason to change, because every trade costs 1%.";

async function loadInvestors() {
  try {
    return await db.aiInvestor.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        user: {
          include: {
            participants: {
              where: { deletedAt: null },
              orderBy: { joinedAt: "desc" },
              take: 1,
              include: {
                portfolio: { include: { holdings: { include: { stock: true } } } },
                competition: {
                  include: {
                    settings: {
                      where: { supersededAt: null },
                      orderBy: { revision: "desc" },
                      take: 1,
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  } catch {
    // The table is created by a migration. Until it has been applied this page
    // says so, rather than the whole admin area failing with a database error.
    return null;
  }
}

export default async function AdminAiPage() {
  await requireAdmin();

  const competition = await db.competition.findFirst({
    where: { deletedAt: null },
    orderBy: { startsAt: "desc" },
    select: { id: true, name: true },
  });
  const investors = await loadInvestors();

  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">AI investor</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          A participant whose portfolio you manage from here. It plays by exactly the same rules as
          everyone else — one rebalance per week, the same position limits, the same 1% transaction
          cost — because its changes go through the same preview and confirmation a
          participant&rsquo;s do. Nothing trades it automatically.
        </p>
      </div>

      {investors === null ? (
        <Alert>
          The AI investor&rsquo;s table does not exist yet. Apply the database migrations with{" "}
          <code>npx prisma migrate deploy</code> (using the direct, non-pooled database URL), then
          reload this page.
        </Alert>
      ) : null}

      {await Promise.all(
        (investors ?? []).map(async (investor) => {
          const participant = investor.user.participants[0];
          const portfolio = participant?.portfolio;
          const settings = participant?.competition.settings[0];
          if (!participant || !portfolio || !settings) {
            return (
              <Alert key={investor.id}>
                {investor.user.firstName} is not enrolled in a competition with rules configured.
              </Alert>
            );
          }
          const { competition: comp } = participant;
          const access = await loadTradingAccess(db, portfolio.id);
          const { stocks, totalValueCents } = await loadAllocatable(db, {
            competitionId: comp.id,
            currency: comp.currency,
            asOfDate: dateKeyOf(new Date(), comp.timezone),
            cashCents: portfolio.cashCents,
            holdings: portfolio.holdings,
          });
          const canTrade = access?.decision.allowed ?? false;

          return (
            <div key={investor.id} className="space-y-4">
              <Card className="max-w-3xl">
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-base font-medium">{participant.displayName}</h2>
                  <span className="text-xs text-[var(--text-muted)]">
                    {formatCents(totalValueCents, comp.currency)} ·{" "}
                    {portfolio.holdings.filter((h) => h.microShares !== 0n).length} positions ·{" "}
                    {formatCents(portfolio.totalFeesCents, comp.currency)} paid in fees
                  </span>
                </div>
                <AiStrategyForm
                  aiInvestorId={investor.id}
                  strategy={investor.strategy}
                  save={updateAiStrategyAction}
                />
              </Card>

              {access && !canTrade ? (
                <TokenBanner tokens={access.tokens} reason={access.decision.reason?.message} />
              ) : access?.tokens ? (
                <TokenBanner tokens={access.tokens} />
              ) : null}

              {canTrade && stocks.length > 0 ? (
                <AllocationEditor
                  portfolioId={portfolio.id}
                  stocks={stocks}
                  currency={comp.currency}
                  totalValueCents={totalValueCents.toString()}
                  totalValueText={formatCents(totalValueCents, comp.currency)}
                  maxPositionPpm={settings.maxPositionPpm}
                  allowCash={settings.allowCash}
                  allowShort={settings.allowShort}
                  maxShortPositionPpm={settings.maxShortPositionPpm}
                  maxGrossExposurePpm={settings.maxGrossExposurePpm}
                  preview={previewAiRebalanceAction}
                  submit={submitAiRebalanceAction}
                  afterConfirmHref="/admin/ai"
                />
              ) : canTrade ? (
                <Alert>No stock has a price yet, so nothing can be allocated.</Alert>
              ) : null}
            </div>
          );
        }),
      )}

      {investors !== null && investors.length === 0 && competition ? (
        <Card className="max-w-3xl">
          <h2 className="text-sm font-medium">Create the AI investor</h2>
          <p className="mt-1 mb-4 text-xs text-[var(--text-muted)]">
            It joins {competition.name} with the same starting capital as everyone and appears on
            the leaderboard. Its account cannot be signed in to.
          </p>
          <CreateAiInvestorForm
            competitionId={competition.id}
            defaultStrategy={DEFAULT_STRATEGY}
            create={createAiInvestorAction}
          />
        </Card>
      ) : null}

      {!competition ? (
        <EmptyState
          title="No competition"
          body="Create a competition before adding an AI investor."
        />
      ) : null}
    </div>
  );
}
