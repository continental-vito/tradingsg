import type { Metadata } from "next";
import { updateSettingsAction } from "@/app/actions/admin";
import { CompetitionSettingsForm } from "@/components/admin-controls";
import { Card, EmptyState } from "@/components/ui";
import { requireAdmin } from "@/server/auth/guard";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Competition settings" };
export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  await requireAdmin();

  const competition = await db.competition.findFirst({
    where: { deletedAt: null },
    orderBy: { startsAt: "desc" },
    include: { settings: { orderBy: { revision: "desc" } } },
  });
  if (!competition) return <EmptyState title="No competition" body="Create one first." />;

  const current = competition.settings.find((s) => s.supersededAt === null);
  if (!current) {
    return <EmptyState title="No rules configured" body="This competition has no settings row." />;
  }
  const history = competition.settings.filter((s) => s.supersededAt !== null);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Competition rules</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Revision {current.revision}, in force since{" "}
          {current.effectiveFrom.toISOString().slice(0, 10)}. Participants see these on the rules
          page, read from this same row.
        </p>
      </div>

      <Card>
        <CompetitionSettingsForm
          competitionId={competition.id}
          initial={{
            tradingMode: current.tradingMode,
            maxChangesPerPeriod: current.maxChangesPerPeriod,
            maxPositionPct: current.maxPositionPpm / 10_000,
            minPositionPct: current.minPositionPpm / 10_000,
            allowCash: current.allowCash,
            allowFractionalShares: current.allowFractionalShares,
            feeBps: current.feeBps,
            revision: current.revision,
          }}
          save={updateSettingsAction}
        />
      </Card>

      {history.length > 0 ? (
        <Card>
          <h2 className="text-sm font-medium">Previous revisions</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Kept so a rebalance made under older rules can still be checked against them.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {history.map((s) => (
              <li key={s.id} className="flex justify-between gap-3 text-[var(--text-muted)]">
                <span>Revision {s.revision}</span>
                <span className="tnum text-xs">
                  {s.effectiveFrom.toISOString().slice(0, 10)} →{" "}
                  {s.supersededAt?.toISOString().slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
