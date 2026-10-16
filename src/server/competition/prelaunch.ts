import type { PrismaClient } from "@/generated/prisma/client";
import { dateKeyOf, type DateKey } from "@/lib/dates";
import { commitRebalance, loadTradingRules } from "@/server/portfolio/commit";
import { enrolInCompetition } from "@/server/portfolio/enrol";
import { buildPriceBook } from "@/server/portfolio/prices";
import {
  planRebalance,
  type RebalanceTarget,
  type ValidationIssue,
} from "@/server/portfolio/rebalance";

/**
 * Pre-launch: a period before a competition starts in which everyone builds
 * the portfolio they want, and nothing trades.
 *
 * A confirmed allocation is QUEUED — a PENDING RebalanceRequest holding the
 * target weights — and can be replaced as often as the participant likes
 * until launch. At launch every queued order executes through the ordinary
 * commit, at the same close, in one pass: nobody gets a better price or a head
 * start for having signed up first, and every rule (position caps, the 1% fee,
 * the ledger invariants) applies exactly as it does to any other trade.
 *
 * Launch happens on its own in the nightly job on the start date, after that
 * day's closes are written and before the first valuation, or earlier from the
 * admin page. Kept out of Next.js so it can be tested.
 */

/** One queued order per portfolio, so replacing it is an upsert on this key. */
const queueKey = (portfolioId: string) => `prelaunch:${portfolioId}`;
const launchKey = (competitionId: string, portfolioId: string) =>
  `launch:${competitionId}:${portfolioId}`;

export function isPreLaunch(competition: { preLaunch: boolean; launchedAt: Date | null }): boolean {
  return competition.preLaunch && competition.launchedAt === null;
}

export async function queuedOrder(
  db: PrismaClient,
  portfolioId: string,
): Promise<RebalanceTarget[] | null> {
  const row = await db.rebalanceRequest.findUnique({
    where: { idempotencyKey: queueKey(portfolioId) },
    select: { status: true, targetsJson: true },
  });
  if (!row || row.status !== "PENDING") return null;
  return JSON.parse(row.targetsJson) as RebalanceTarget[];
}

export type QueueResult = { ok: true } | { ok: false; errors: ValidationIssue[] };

/**
 * Queues (or replaces) a participant's launch allocation. It is checked against
 * today's prices and the current rules first, so a mistake is caught now rather
 * than discovered at launch, when it is too late to fix.
 */
export async function queuePreLaunchOrder(
  db: PrismaClient,
  args: { portfolioId: string; targets: RebalanceTarget[]; asOfDate: DateKey },
): Promise<QueueResult> {
  const portfolio = await db.portfolio.findUniqueOrThrow({
    where: { id: args.portfolioId },
    include: { holdings: { include: { stock: { select: { symbol: true } } } } },
  });
  const { rules } = await loadTradingRules(db, portfolio.competitionId);
  const stockIds = [
    ...new Set([
      ...portfolio.holdings.map((h) => h.stockId),
      ...args.targets.map((t) => t.stockId),
    ]),
  ];
  const book = await buildPriceBook(db, stockIds, args.asOfDate);
  const symbols = new Map(
    (
      await db.stock.findMany({
        where: { id: { in: stockIds } },
        select: { id: true, symbol: true },
      })
    ).map((s) => [s.id, s.symbol]),
  );
  const planned = planRebalance({
    state: {
      cashCents: portfolio.cashCents,
      initialCapitalCents: portfolio.initialCapitalCents,
      netFlowCents: portfolio.netFlowCents,
      realizedPnlCents: portfolio.realizedPnlCents,
      holdings: portfolio.holdings.map((h) => ({
        stockId: h.stockId,
        symbol: h.stock.symbol,
        microShares: h.microShares,
        costBasisCents: h.costBasisCents,
      })),
    },
    targets: args.targets,
    book,
    rules,
    symbolOf: (id) => symbols.get(id) ?? id,
  });
  if (!planned.ok) return { ok: false, errors: planned.errors };

  const data = {
    status: "PENDING",
    periodKey: null,
    targetsJson: JSON.stringify(args.targets),
    quotesJson: "[]",
    errorsJson: null,
    submittedAt: new Date(),
  };
  await db.rebalanceRequest.upsert({
    where: { idempotencyKey: queueKey(args.portfolioId) },
    update: data,
    create: { portfolioId: args.portfolioId, idempotencyKey: queueKey(args.portfolioId), ...data },
  });
  return { ok: true };
}

/**
 * Enrols every participant-role user who is not yet in this competition, with
 * the name they used last time. Without this a new competition is invisible to
 * existing users: every page shows the competition they joined most recently.
 */
export async function enrolEveryone(
  db: PrismaClient,
  competitionId: string,
): Promise<{ enrolled: number }> {
  const users = await db.user.findMany({
    where: {
      role: "PARTICIPANT",
      isDisabled: false,
      deletedAt: null,
      participants: { none: { competitionId } },
    },
    select: {
      id: true,
      participants: {
        where: { deletedAt: null },
        orderBy: { joinedAt: "desc" },
        take: 1,
        select: { displayName: true },
      },
    },
  });
  let enrolled = 0;
  for (const user of users) {
    const result = await enrolInCompetition(db, {
      userId: user.id,
      competitionId,
      byAdmin: true,
      ...(user.participants[0] ? { displayName: user.participants[0].displayName } : {}),
    });
    if (result.ok && result.created) enrolled++;
  }
  return { enrolled };
}

export interface LaunchResult {
  launched: boolean;
  executed: number;
  rejected: { displayName: string; reason: string }[];
}

/**
 * Executes every queued order at `asOfDate`'s prices and marks the competition
 * launched. Idempotent: an order already executed is replayed by its key, not
 * traded twice, so a launch interrupted halfway can simply be run again.
 */
export async function launchCompetition(
  db: PrismaClient,
  args: { competitionId: string; asOfDate: DateKey; now?: Date },
): Promise<LaunchResult> {
  const now = args.now ?? new Date();
  const competition = await db.competition.findUniqueOrThrow({
    where: { id: args.competitionId },
    select: {
      id: true,
      name: true,
      preLaunch: true,
      launchedAt: true,
      status: true,
      startDate: true,
    },
  });
  if (!isPreLaunch(competition)) return { launched: false, executed: 0, rejected: [] };

  const queued = await db.rebalanceRequest.findMany({
    where: {
      status: "PENDING",
      idempotencyKey: { startsWith: "prelaunch:" },
      portfolio: { competitionId: competition.id },
    },
    include: {
      portfolio: {
        select: {
          id: true,
          participant: { select: { id: true, userId: true, displayName: true, status: true } },
        },
      },
    },
    // Submission order does not affect price — everyone executes at the same
    // close — but a fixed order makes the run reproducible.
    orderBy: { submittedAt: "asc" },
  });

  let executed = 0;
  const rejected: LaunchResult["rejected"] = [];
  for (const order of queued) {
    const participant = order.portfolio.participant;
    if (participant.status === "WITHDRAWN" || participant.status === "DISQUALIFIED") {
      await db.rebalanceRequest.delete({ where: { id: order.id } });
      continue;
    }

    const result = await commitRebalance(db, {
      portfolioId: order.portfolio.id,
      targets: JSON.parse(order.targetsJson) as RebalanceTarget[],
      idempotencyKey: launchKey(competition.id, order.portfolio.id),
      // The launch is the starting line, not a weekly change: it does not use
      // up anyone's rebalance token for the first week.
      periodKey: null,
      asOfDate: args.asOfDate,
      executedAt: now,
    });
    // The queued row goes once its outcome is recorded under the launch key;
    // a crash between the two leaves it to be replayed, never traded twice.
    await db.rebalanceRequest.delete({ where: { id: order.id } });

    if (result.ok) {
      executed++;
    } else {
      rejected.push({
        displayName: participant.displayName,
        reason: result.errors.map((e) => e.message).join(" "),
      });
    }

    await db.notification
      .create({
        data: {
          userId: participant.userId,
          type: "TRADE_EXECUTED",
          severity: result.ok ? "SUCCESS" : "WARNING",
          title: result.ok
            ? `${competition.name} has started — your portfolio is invested`
            : `${competition.name} has started, but your portfolio could not be invested`,
          body: result.ok
            ? "Your queued allocation executed at the launch close, together with everyone else's."
            : `${result.errors[0]?.message ?? "It broke a rule at the launch prices."} Your money is in cash; build your portfolio again from the Portfolio page.`,
          linkUrl: result.ok ? "/portfolio" : "/portfolio/allocate",
          dedupeKey: `launch:${competition.id}:${participant.id}`,
        },
      })
      .catch(() => {
        // Already notified by an earlier, interrupted run of the same launch.
      });
  }

  // A launch brought forward moves the start with it: the first valuation and
  // every return are measured from the day the money was actually invested.
  const startDate = args.asOfDate < competition.startDate ? args.asOfDate : competition.startDate;
  await db.competition.update({
    where: { id: competition.id },
    data: {
      launchedAt: now,
      status:
        competition.status === "PAUSED" || competition.status === "ENDED"
          ? competition.status
          : "RUNNING",
      startDate,
      startsAt: new Date(`${startDate}T08:00:00Z`),
    },
  });

  return { launched: true, executed, rejected };
}

/** Competitions whose launch day has come. Used by the nightly job. */
export async function dueLaunches(db: PrismaClient, now: Date) {
  const candidates = await db.competition.findMany({
    where: {
      deletedAt: null,
      preLaunch: true,
      launchedAt: null,
      status: { in: ["REGISTRATION", "RUNNING"] },
    },
    select: { id: true, slug: true, timezone: true, startDate: true },
  });
  return candidates.filter((c) => dateKeyOf(now, c.timezone) >= c.startDate);
}
