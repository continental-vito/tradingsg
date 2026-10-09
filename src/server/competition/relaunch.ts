import type { PrismaClient } from "@/generated/prisma/client";
import { assertPortfolioInvariants } from "@/server/portfolio/invariant";
import { HOUSE_RULES } from "./house-rules";
import { UNIVERSE, type UniverseEntry } from "./universe";

/**
 * Relaunching a competition: a new tradable universe, every portfolio back to
 * its starting capital in cash, and the house rules (1% fee, one rebalance a
 * week) as a new settings revision.
 *
 * This is the one operation in the codebase that deletes ledger rows, and it is
 * only for a competition whose trading so far was a trial run. Everything it
 * touches goes in one transaction: a half-relaunched competition — some
 * portfolios reset, others still holding stocks that are no longer tradable —
 * is worse than either state.
 *
 * What it keeps:
 *   - initialCapitalCents, on the participant and the portfolio. Every return
 *     is measured against it, and nothing ever rewrites it.
 *   - Users, participants, sessions, the audit trail and the backups.
 *   - Price history, which is a fact about the market, not about anyone's play.
 *
 * What it removes, for this competition only:
 *   - Transactions, holdings and rebalance requests — replaced by a single
 *     INITIAL_FUNDING row, exactly as on the day someone joins.
 *   - Valuations, leaderboard snapshots and weekly reports. They describe
 *     portfolios that no longer exist, and the return chain would otherwise
 *     read the reset as a loss or a gain that nobody traded for.
 *   - The job-run records for those three jobs, so the next nightly run
 *     rebuilds them from the reset ledger instead of skipping dates it
 *     believes are done.
 *
 * Kept out of the server action so it can be tested; the action adds the
 * authorisation, the confirmation and the audit entry.
 */

export interface RelaunchResult {
  stocksTradable: number;
  stocksAdded: number;
  stocksRemoved: number;
  portfoliosReset: number;
  settingsRevision: number;
  /** Stocks that need a price before anyone can buy them. */
  unpricedSymbols: string[];
}

const HISTORY_JOBS = ["snapshot-valuations", "snapshot-leaderboard", "build-weekly-report"];

export async function relaunchCompetition(
  db: PrismaClient,
  args: { competitionId: string; universe?: readonly UniverseEntry[]; now?: Date },
): Promise<RelaunchResult> {
  const universe = args.universe ?? UNIVERSE;
  const now = args.now ?? new Date();

  const competition = await db.competition.findUniqueOrThrow({
    where: { id: args.competitionId },
    select: { id: true, slug: true, startDate: true, currency: true },
  });

  return db.$transaction(
    async (tx) => {
      // ── Universe ──────────────────────────────────────────────────────────
      const before = await tx.competitionStock.findMany({
        where: { competitionId: competition.id, removedAt: null },
        select: { stockId: true },
      });
      const wasTradable = new Set(before.map((b) => b.stockId));

      const keep = new Set<string>();
      let added = 0;
      for (const [sortOrder, entry] of universe.entries()) {
        const fields = {
          providerSymbol: entry.providerSymbol,
          name: entry.name,
          exchange: entry.exchange,
          sector: entry.sector,
          currency: competition.currency,
          isActive: true,
          deletedAt: null,
          // The real universe now, so `make db-clear-demo` must not delete it
          // even where the seed created the row first.
          isDemo: false,
        };
        const stock = await tx.stock.upsert({
          where: { symbol: entry.symbol },
          update: fields,
          create: { symbol: entry.symbol, ...fields },
        });
        keep.add(stock.id);
        if (!wasTradable.has(stock.id)) added++;

        await tx.competitionStock.upsert({
          where: { competitionId_stockId: { competitionId: competition.id, stockId: stock.id } },
          update: { removedAt: null, isTradable: true, sortOrder },
          create: { competitionId: competition.id, stockId: stock.id, sortOrder },
        });
      }

      const dropped = await tx.competitionStock.updateMany({
        where: { competitionId: competition.id, removedAt: null, stockId: { notIn: [...keep] } },
        data: { removedAt: now, isTradable: false },
      });

      // ── Portfolios ────────────────────────────────────────────────────────
      await tx.weeklyReport.deleteMany({ where: { competitionId: competition.id } });
      await tx.leaderboardSnapshot.deleteMany({ where: { competitionId: competition.id } });
      await tx.portfolioValuation.deleteMany({ where: { competitionId: competition.id } });
      await tx.jobRun.deleteMany({
        where: { jobName: { in: HISTORY_JOBS }, runKey: { startsWith: `${competition.slug}:` } },
      });

      const portfolios = await tx.portfolio.findMany({
        where: { competitionId: competition.id },
        select: {
          id: true,
          participantId: true,
          initialCapitalCents: true,
          participant: { select: { isDemo: true } },
        },
      });

      for (const portfolio of portfolios) {
        const capital = portfolio.initialCapitalCents;
        await tx.transaction.deleteMany({ where: { portfolioId: portfolio.id } });
        await tx.holding.deleteMany({ where: { portfolioId: portfolio.id } });
        await tx.rebalanceRequest.deleteMany({ where: { portfolioId: portfolio.id } });

        await tx.transaction.create({
          data: {
            portfolioId: portfolio.id,
            participantId: portfolio.participantId,
            sequence: 1,
            type: "INITIAL_FUNDING",
            tradeDate: competition.startDate,
            executedAt: now,
            cashDeltaCents: capital,
            cashAfterCents: capital,
            isExternalFlow: true,
            note: "Starting virtual capital (portfolios reset for the relaunch)",
            isDemo: portfolio.participant.isDemo,
          },
        });

        await tx.portfolio.update({
          where: { id: portfolio.id },
          data: {
            status: "DRAFT",
            cashCents: capital,
            costBasisCents: 0n,
            realizedPnlCents: 0n,
            totalFeesCents: 0n,
            netFlowCents: 0n,
            transactionSeq: 1,
            rebalanceCount: 0,
            setupCompletedAt: null,
            lastRebalancedAt: null,
            version: { increment: 1 },
          },
        });

        // Back to the state of someone who has joined and not yet invested. A
        // withdrawn or disqualified participant stays that way: a relaunch
        // resets money, not an administrator's decision about a person.
        await tx.participant.updateMany({
          where: { id: portfolio.participantId, status: "ACTIVE" },
          data: { status: "REGISTERED" },
        });
        await tx.participant.update({
          where: { id: portfolio.participantId },
          data: { activatedAt: null, adjustedByAdmin: false },
        });

        await assertPortfolioInvariants(tx as unknown as PrismaClient, portfolio.id);
      }

      // Stocks that left every universe and that nobody holds stop being
      // priced, so the nightly job does not fetch forty names nobody can buy.
      // Soft-deleted only: their history stays, and adding one back from the
      // Stocks page clears the flag.
      const orphaned = await tx.stock.findMany({
        where: {
          deletedAt: null,
          id: { notIn: [...keep] },
          competitions: { none: { removedAt: null } },
          holdings: { none: { microShares: { not: 0n } } },
        },
        select: { id: true },
      });
      if (orphaned.length > 0) {
        await tx.stock.updateMany({
          where: { id: { in: orphaned.map((s) => s.id) } },
          data: { deletedAt: now, isActive: false },
        });
      }

      // ── Rules ─────────────────────────────────────────────────────────────
      const current = await tx.competitionSettings.findFirst({
        where: { competitionId: competition.id, supersededAt: null },
        orderBy: { revision: "desc" },
      });
      let revision = 1;
      if (current) {
        await tx.competitionSettings.update({
          where: { id: current.id },
          data: { supersededAt: now },
        });
        const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = current;
        revision = current.revision + 1;
        await tx.competitionSettings.create({
          data: { ...rest, ...HOUSE_RULES, revision, effectiveFrom: now, supersededAt: null },
        });
      } else {
        await tx.competitionSettings.create({
          data: { competitionId: competition.id, revision, ...HOUSE_RULES },
        });
      }

      const unpriced = await tx.stock.findMany({
        where: { id: { in: [...keep] }, lastPriceCents: null },
        select: { symbol: true },
        orderBy: { symbol: "asc" },
      });

      return {
        stocksTradable: keep.size,
        stocksAdded: added,
        stocksRemoved: dropped.count,
        portfoliosReset: portfolios.length,
        settingsRevision: revision,
        unpricedSymbols: unpriced.map((s) => s.symbol),
      };
    },
    // Dozens of portfolios over a pooled serverless connection do not fit in
    // the default five seconds, and a timeout here rolls the whole thing back.
    { timeout: 120_000, maxWait: 15_000 },
  );
}
