import type { Metadata } from "next";
import {
  createAiInvestorAction,
  runAiInvestorNowAction,
  updateAiInvestorAction,
} from "@/app/actions/ai";
import { AiInvestorControls, CreateAiInvestorForm } from "@/components/admin-controls";
import { Alert, Card, EmptyState } from "@/components/ui";
import { requireAdmin } from "@/server/auth/guard";
import { db } from "@/server/db";
import { AI_MODELS, DEFAULT_AI_MODEL, advisorConfigured } from "@/server/ai";
import { formatCents, toPpm } from "@/server/money";

export const metadata: Metadata = { title: "AI investor" };
export const dynamic = "force-dynamic";
// "Run now" waits for the model, which can take well over a default
// serverless invocation's limit.
export const maxDuration = 300;

const DEFAULT_STRATEGY =
  "Beat the other participants on total return over the competition, without " +
  "taking risks you could not explain. Prefer a diversified portfolio of 6 to 10 " +
  "names, size positions by conviction, and remember every trade costs a fee — " +
  "only change what you have a reason to change.";

const STATUS_TONE: Record<string, string> = {
  TRADED: "text-up-600",
  SKIPPED: "text-[var(--text-muted)]",
  REJECTED: "text-down-600",
  FAILED: "text-down-600",
};

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
              include: { portfolio: true, competition: { select: { currency: true } } },
            },
          },
        },
        runs: { orderBy: { createdAt: "desc" }, take: 12 },
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
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI investor</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          A participant whose allocation is chosen by a language model. It plays by exactly the same
          rules as everyone else — the same weekly rebalance token, the same position limits, the
          same 1% transaction cost — because its decisions go through the same checks a
          person&rsquo;s &ldquo;Confirm&rdquo; button does. It decides every Monday morning.
        </p>
      </div>

      {investors === null ? (
        <Alert>
          The AI investor&rsquo;s tables do not exist yet. Apply the database migration with{" "}
          <code>npx prisma migrate deploy</code> (using the direct, non-pooled database URL), then
          reload this page.
        </Alert>
      ) : null}

      {!advisorConfigured() ? (
        <Alert>
          <code>ANTHROPIC_API_KEY</code> is not set, so the AI investor cannot decide anything. Add
          it to the environment variables and redeploy. You can still create and configure it.
        </Alert>
      ) : null}

      {investors?.map((investor) => {
        const participant = investor.user.participants[0];
        const portfolio = participant?.portfolio;
        const currency = participant?.competition.currency ?? "EUR";
        return (
          <Card key={investor.id}>
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-medium">
                {participant?.displayName ?? investor.user.firstName}
              </h2>
              <span className="text-xs text-[var(--text-muted)]">
                {investor.isEnabled ? "trading on its own" : "paused"} ·{" "}
                {portfolio
                  ? `${formatCents(portfolio.cashCents, currency)} cash · ${portfolio.rebalanceCount} rebalance${portfolio.rebalanceCount === 1 ? "" : "s"}`
                  : "not enrolled"}
                {investor.lastRunAt
                  ? ` · last run ${investor.lastRunAt.toISOString().slice(0, 16).replace("T", " ")} UTC`
                  : ""}
              </span>
            </div>

            <AiInvestorControls
              investor={{
                id: investor.id,
                model: investor.model,
                strategy: investor.strategy,
                isEnabled: investor.isEnabled,
              }}
              models={AI_MODELS}
              save={updateAiInvestorAction}
              runNow={runAiInvestorNowAction}
            />

            <h3 className="mt-6 mb-2 text-sm font-medium">Recent decisions</h3>
            {investor.runs.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No decisions yet.</p>
            ) : (
              <ul className="divide-y divide-[var(--border)] text-sm">
                {investor.runs.map((run) => {
                  const targets = run.targetsJson
                    ? (JSON.parse(run.targetsJson) as { symbol: string; weightPpm: number }[])
                    : [];
                  return (
                    <li key={run.id} className="py-3">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="tnum text-xs text-[var(--text-muted)]">
                          {run.asOfDate}
                        </span>
                        <span className={`text-xs font-medium ${STATUS_TONE[run.status] ?? ""}`}>
                          {run.status.toLowerCase()}
                        </span>
                        <span className="text-xs text-[var(--text-muted)]">
                          {run.triggeredBy === "ADMIN" ? "run by an admin" : "scheduled"}
                          {run.model ? ` · ${run.model}` : ""}
                        </span>
                      </div>
                      <p className="mt-1">{run.summary}</p>
                      {run.rationale ? (
                        <p className="mt-1 text-[var(--text-muted)]">{run.rationale}</p>
                      ) : null}
                      {targets.length > 0 ? (
                        <p className="tnum mt-1 text-xs text-[var(--text-muted)]">
                          {targets
                            .map((t) => `${t.symbol} ${(t.weightPpm / 10_000).toFixed(1)}%`)
                            .join(" · ")}
                          {" · cash "}
                          {(
                            (1_000_000 - targets.reduce((sum, t) => sum + t.weightPpm, 0)) /
                            10_000
                          ).toFixed(1)}
                          %
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {portfolio && portfolio.initialCapitalCents > 0n ? (
              <p className="mt-3 text-xs text-[var(--text-muted)]">
                Fees paid so far: {formatCents(portfolio.totalFeesCents, currency)} (
                {(toPpm(portfolio.totalFeesCents, portfolio.initialCapitalCents) / 10_000).toFixed(
                  2,
                )}
                % of its starting capital).
              </p>
            ) : null}
          </Card>
        );
      })}

      {investors !== null && competition ? (
        <Card>
          <h2 className="text-sm font-medium">
            {investors.length === 0 ? "Create the AI investor" : "Add another AI investor"}
          </h2>
          <p className="mt-1 mb-4 text-xs text-[var(--text-muted)]">
            It joins {competition.name} with the same starting capital as everyone and appears on
            the leaderboard. Its account cannot be signed in to.
          </p>
          <CreateAiInvestorForm
            competitionId={competition.id}
            models={AI_MODELS}
            defaultModel={DEFAULT_AI_MODEL}
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
