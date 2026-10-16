import type { Metadata } from "next";
import Link from "next/link";
import {
  applySurveyAdjustmentAction,
  createQuestionAction,
  previewSurveyAdjustmentAction,
  updateQuestionAction,
} from "@/app/actions/questions";
import {
  CreateQuestionForm,
  QuestionEditor,
  SurveyAdjustmentForm,
} from "@/components/admin-controls";
import { Alert, Card, EmptyState } from "@/components/ui";
import { requireAdmin } from "@/server/auth/guard";
import { db } from "@/server/db";
import { formatCents } from "@/server/money";
import { questionStats } from "@/server/survey/questions";

export const metadata: Metadata = { title: "Questions" };
export const dynamic = "force-dynamic";
// Applying a bonus or malus books every affected participant's ledger in one
// transaction, which can outlast a default serverless invocation.
export const maxDuration = 300;

function pct(n: number, of: number): string {
  return of === 0 ? "0%" : `${Math.round((n / of) * 100)}%`;
}

function returnText(ppm: number | null): string {
  if (ppm === null) return "—";
  return `${ppm > 0 ? "+" : ""}${(ppm / 10_000).toFixed(2)}%`;
}

async function load(competitionId: string) {
  try {
    const [stats, adjustments] = await Promise.all([
      questionStats(db, competitionId),
      db.surveyAdjustment.findMany({
        where: { competitionId },
        orderBy: { createdAt: "desc" },
        include: { question: { select: { prompt: true, yesLabel: true, noLabel: true } } },
      }),
    ]);
    return { stats, adjustments };
  } catch {
    // The tables come from a migration. Until it runs, say so rather than
    // failing the whole admin area.
    return null;
  }
}

export default async function AdminQuestionsPage() {
  await requireAdmin();

  const competition = await db.competition.findFirst({
    where: { deletedAt: null },
    orderBy: { startsAt: "desc" },
    select: { id: true, name: true, currency: true },
  });
  if (!competition) return <EmptyState title="No competition" body="Create one first." />;

  const data = await load(competition.id);
  if (!data) {
    return (
      <Alert>
        The questions tables do not exist yet. They are created by the database migration that runs
        with the next production deploy; reload this page once it has finished.
      </Alert>
    );
  }
  const { stats, adjustments } = data;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Questions</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Yes/no questions participants answer when they sign in. Answers are kept per person and
            are final unless you open a question for change. They are included in every backup.
          </p>
        </div>
        <Link
          href="/api/admin/answers.csv"
          className="rounded-lg border border-[var(--border)] px-4 py-2.5 text-sm font-medium whitespace-nowrap hover:bg-[var(--surface-sunken)]"
        >
          Download answers (CSV)
        </Link>
      </div>

      {stats.length === 0 ? (
        <EmptyState
          title="No questions yet"
          body="Add one below. Everyone is asked it the next time they open the app."
        />
      ) : null}

      {stats.map((q) => {
        const answered = q.yes + q.no;
        const total = answered + q.unanswered;
        return (
          <Card key={q.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-medium">{q.prompt}</h2>
              <span className="text-xs text-[var(--text-muted)]">
                {q.isActive ? "asked at sign-in" : "not being asked"} ·{" "}
                {q.allowChange ? "answers can be changed" : "answers are final"}
              </span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {[
                { label: q.yesLabel, n: q.yes, ret: q.yesMeanReturnPpm },
                { label: q.noLabel, n: q.no, ret: q.noMeanReturnPpm },
              ].map((g) => (
                <div key={g.label} className="rounded-lg border border-[var(--border)] p-3">
                  <div className="text-xs text-[var(--text-muted)]">{g.label}</div>
                  <div className="tnum mt-1 text-xl font-semibold">
                    {g.n}{" "}
                    <span className="text-sm font-normal text-[var(--text-muted)]">
                      {pct(g.n, answered)}
                    </span>
                  </div>
                  <div className="tnum mt-1 text-xs text-[var(--text-muted)]">
                    mean return {returnText(g.ret)}
                  </div>
                </div>
              ))}
              <div className="rounded-lg border border-[var(--border)] p-3">
                <div className="text-xs text-[var(--text-muted)]">Not answered yet</div>
                <div className="tnum mt-1 text-xl font-semibold">
                  {q.unanswered}{" "}
                  <span className="text-sm font-normal text-[var(--text-muted)]">
                    of {total} participants
                  </span>
                </div>
              </div>
            </div>

            <div
              className="mt-3 flex h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]"
              role="img"
              aria-label={`${q.yes} ${q.yesLabel}, ${q.no} ${q.noLabel}, ${q.unanswered} not answered`}
            >
              <div className="bg-accent-600" style={{ width: pct(q.yes, total) }} />
              <div className="bg-accent-300" style={{ width: pct(q.no, total) }} />
            </div>

            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-[var(--text-muted)]">
                Settings
              </summary>
              <div className="mt-3">
                <QuestionEditor
                  question={{
                    id: q.id,
                    prompt: q.prompt,
                    yesLabel: q.yesLabel,
                    noLabel: q.noLabel,
                    isActive: q.isActive,
                    allowChange: q.allowChange,
                    answerCount: answered,
                  }}
                  save={updateQuestionAction}
                />
              </div>
            </details>
          </Card>
        );
      })}

      <Card>
        <h2 className="mb-4 text-sm font-medium">Add a question</h2>
        <CreateQuestionForm create={createQuestionAction} />
      </Card>

      {stats.length > 0 ? (
        <Card>
          <h2 className="text-sm font-medium">Bonus or malus by answer</h2>
          <p className="mt-1 mb-4 text-xs text-[var(--text-muted)]">
            Applies to everyone in {competition.name} who gave the chosen answer, except anyone
            withdrawn or disqualified. Preview it first; nothing is booked until you apply it.
          </p>
          <SurveyAdjustmentForm
            competitionId={competition.id}
            questions={stats.map((q) => ({
              id: q.id,
              prompt: q.prompt,
              yesLabel: q.yesLabel,
              noLabel: q.noLabel,
            }))}
            preview={previewSurveyAdjustmentAction}
            apply={applySurveyAdjustmentAction}
          />
        </Card>
      ) : null}

      {adjustments.length > 0 ? (
        <Card className="overflow-hidden p-0">
          <h2 className="px-5 pt-4 pb-2 text-sm font-medium">Applied so far</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
                  <th className="px-5 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Question and answer</th>
                  <th className="px-3 py-2 text-right font-medium">Rate</th>
                  <th className="px-3 py-2 text-right font-medium">People</th>
                  <th className="px-5 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {adjustments.map((a) => (
                  <tr key={a.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="tnum px-5 py-2.5 whitespace-nowrap text-[var(--text-muted)]">
                      {a.asOfDate}
                    </td>
                    <td className="px-3 py-2.5">
                      {a.question.prompt}{" "}
                      <span className="font-medium">
                        → {a.answer ? a.question.yesLabel : a.question.noLabel}
                      </span>
                      {a.note ? (
                        <span className="block text-xs text-[var(--text-muted)]">{a.note}</span>
                      ) : null}
                    </td>
                    <td className="tnum px-3 py-2.5 text-right">
                      {returnText(a.ratePpm)}
                      <span className="block text-xs text-[var(--text-muted)]">
                        {a.base === "STARTING_CAPITAL" ? "of starting capital" : "of current value"}
                      </span>
                    </td>
                    <td className="tnum px-3 py-2.5 text-right">{a.participantCount}</td>
                    <td className="tnum px-5 py-2.5 text-right">
                      {formatCents(a.totalCents, competition.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
