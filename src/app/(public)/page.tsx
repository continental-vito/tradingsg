import Link from "next/link";
import { db } from "@/server/db";
import { env } from "@/lib/env";
import { formatCents, formatPpm } from "@/server/money";
import { formatRemaining } from "@/lib/dates";
import { Card } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * The landing page reads the live competition rather than a fixture: a
 * countdown that is right and a leader who is real is the entire argument for
 * signing up, and a placeholder undermines it.
 */
export default async function LandingPage() {
  const competition = await db.competition.findFirst({
    where: { deletedAt: null, status: { in: ["REGISTRATION", "RUNNING", "PAUSED"] } },
    orderBy: { startsAt: "desc" },
  });

  const participantCount = competition
    ? await db.participant.count({ where: { competitionId: competition.id, deletedAt: null } })
    : 0;

  // The leader comes from the last committed snapshot, not from a live
  // recomputation, so two visitors ten seconds apart see the same name.
  const snapshot = competition
    ? await db.leaderboardSnapshot.findFirst({
        where: { competitionId: competition.id },
        orderBy: { asOfDate: "desc" },
        include: {
          entries: {
            where: { rank: 1 },
            take: 1,
            include: { participant: { select: { displayName: true } } },
          },
        },
      })
    : null;
  const leader = snapshot?.entries[0] ?? null;

  return (
    <div className="mx-auto max-w-6xl px-5">
      <section className="py-16 sm:py-24">
        <p className="text-sm font-medium tracking-wide text-accent-600 uppercase">
          {competition?.name ?? "Coming soon"}
        </p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          {env.COMPANY_NAME} Stock Challenge
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-[var(--text-muted)]">
          Who has the best investment strategy? Take{" "}
          {formatCents(competition?.startingCapitalCents ?? 10_000_000n)} of virtual capital, build
          a portfolio, and find out.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/register"
            className="rounded-lg bg-accent-600 px-5 py-3 text-sm font-medium text-white hover:bg-accent-700"
          >
            Join the competition
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-[var(--border)] px-5 py-3 text-sm font-medium hover:bg-[var(--surface-sunken)]"
          >
            Log in
          </Link>
        </div>

        <dl className="mt-12 grid gap-4 sm:grid-cols-3">
          <Card>
            <dt className="text-sm text-[var(--text-muted)]">Time remaining</dt>
            <dd className="tnum mt-1 text-2xl font-semibold">
              {competition ? formatRemaining(competition.endsAt) : "—"}
            </dd>
          </Card>
          <Card>
            <dt className="text-sm text-[var(--text-muted)]">Participants</dt>
            <dd className="tnum mt-1 text-2xl font-semibold">{participantCount}</dd>
          </Card>
          <Card>
            <dt className="text-sm text-[var(--text-muted)]">Current leader</dt>
            <dd className="mt-1 truncate text-2xl font-semibold">
              {leader ? (
                <>
                  {leader.participant.displayName}{" "}
                  <span className="tnum text-base font-medium text-up-600">
                    {formatPpm(leader.totalReturnPpm)}
                  </span>
                </>
              ) : (
                <span className="text-[var(--text-muted)]">Not yet decided</span>
              )}
            </dd>
          </Card>
        </dl>
      </section>

      <section className="border-t border-[var(--border)] py-16">
        <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
        <ol className="mt-8 grid gap-6 sm:grid-cols-3">
          {[
            {
              step: "1",
              title: "Sign up",
              body: "Register with your work email. It takes about a minute.",
            },
            {
              step: "2",
              title: "Build your portfolio",
              body: `Split ${formatCents(competition?.startingCapitalCents ?? 10_000_000n)} across the competition's stocks. Slide, type, or hold cash.`,
            },
            {
              step: "3",
              title: "Compete",
              body: "Track your performance, adjust your positions, and climb the leaderboard.",
            },
          ].map((s) => (
            <li key={s.step}>
              <span className="flex size-9 items-center justify-center rounded-full bg-accent-50 text-sm font-semibold text-accent-700">
                {s.step}
              </span>
              <h3 className="mt-3 font-medium">{s.title}</h3>
              <p className="mt-1 text-sm text-[var(--text-muted)]">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t border-[var(--border)] py-16">
        <h2 className="text-2xl font-semibold tracking-tight">The rules</h2>
        <ul className="mt-6 grid gap-3 text-sm text-[var(--text-muted)] sm:grid-cols-2">
          <li>
            Everyone starts with the same{" "}
            {formatCents(competition?.startingCapitalCents ?? 10_000_000n)} of virtual capital.
          </li>
          <li>Allocations must add up to exactly 100%, cash included.</li>
          <li>Portfolios are valued at the official closing price, the same for everyone.</li>
          <li>Ranking is by percentage return, so the size of your book cannot flatter it.</li>
          <li>No real money is involved and nothing here is investment advice.</li>
          <li>The full, current rules are on the rules page once you are signed in.</li>
        </ul>
      </section>
    </div>
  );
}
