import type { Metadata } from "next";
import { generateBackupAction } from "@/app/actions/backups";
import { GenerateBackupButton } from "@/components/backup-controls";
import { Alert, Card, EmptyState } from "@/components/ui";
import { requireAdmin } from "@/server/auth/guard";
import { db } from "@/server/db";
import { EXPORT_KINDS } from "@/server/backup/export";

export const metadata: Metadata = { title: "Backups" };
export const dynamic = "force-dynamic";

const WHAT: Record<string, string> = {
  participants: "Who is playing, what they started with, and where their cash is.",
  holdings: "What each participant holds right now.",
  transactions: "The full append-only ledger — the authoritative record.",
  prices: "Every close used to value anything.",
};

function kb(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(0)} KB`;
}

export default async function BackupsPage() {
  await requireAdmin();

  const competition = await db.competition.findFirst({
    where: { deletedAt: null },
    orderBy: { startsAt: "desc" },
  });
  if (!competition) return <EmptyState title="No competition" body="Create one first." />;

  const exports = await db.dataExport.findMany({
    where: { competitionId: competition.id },
    orderBy: [{ asOfDate: "desc" }, { kind: "asc" }],
    select: {
      id: true,
      asOfDate: true,
      kind: true,
      filename: true,
      rowCount: true,
      byteSize: true,
      triggeredBy: true,
      createdAt: true,
    },
  });

  // Grouped by day, because a day's four files are one backup.
  const byDate = new Map<string, typeof exports>();
  for (const file of exports) {
    byDate.set(file.asOfDate, [...(byDate.get(file.asOfDate) ?? []), file]);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Backups</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {byDate.size} day{byDate.size === 1 ? "" : "s"} kept · written nightly at 23:45 and
            pruned after 90 days
          </p>
        </div>
        <GenerateBackupButton competitionId={competition.id} generate={generateBackupAction} />
      </div>

      <Alert tone="info">
        <strong>These four files can rebuild the competition from nothing.</strong>{" "}
        <code>transactions</code> and <code>prices</code> are sufficient on their own — holdings and
        every valuation are derivable from the ledger. <code>participants</code> and{" "}
        <code>holdings</code> are included so a rebuild can be checked against what was there, since
        a recovery you cannot eyeball is one you cannot trust. Everyone is keyed by{" "}
        <strong>email</strong>, not by database id, because ids are regenerated when rows are
        recreated and an email address survives.
      </Alert>

      {byDate.size === 0 ? (
        <EmptyState
          title="No backups yet"
          body="The nightly job has not run. Use “Back up now” above, or run make job NAME=export-backup."
        />
      ) : (
        <div className="space-y-4">
          {[...byDate.entries()].map(([date, files]) => {
            const total = files.reduce((sum, f) => sum + f.byteSize, 0);
            const missing = EXPORT_KINDS.filter((k) => !files.some((f) => f.kind === k));
            return (
              <Card key={date} className="overflow-hidden p-0">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-5 py-3">
                  <div>
                    <span className="tnum font-medium">{date}</span>
                    <span className="ml-3 text-xs text-[var(--text-muted)]">
                      {files.length} files · {kb(total)} ·{" "}
                      {files[0]?.triggeredBy === "ADMIN" ? "on demand" : "nightly"}
                    </span>
                  </div>
                  {missing.length > 0 ? (
                    <span className="text-xs text-down-600">
                      incomplete — missing {missing.join(", ")}
                    </span>
                  ) : null}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-sm">
                    <tbody>
                      {files.map((file) => (
                        <tr key={file.id} className="border-b border-[var(--border)] last:border-0">
                          <td className="px-5 py-2.5">
                            <div className="font-medium">{file.kind}</div>
                            <div className="text-xs text-[var(--text-muted)]">
                              {WHAT[file.kind] ?? ""}
                            </div>
                          </td>
                          <td className="tnum px-3 py-2.5 text-right whitespace-nowrap">
                            {file.rowCount} rows
                          </td>
                          <td className="tnum px-3 py-2.5 text-right whitespace-nowrap text-[var(--text-muted)]">
                            {kb(file.byteSize)}
                          </td>
                          <td className="px-5 py-2.5 text-right">
                            <a
                              href={`/api/admin/backups/${file.id}`}
                              className="text-sm font-medium text-accent-600 hover:text-accent-700"
                            >
                              Download
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <h2 className="text-sm font-medium">Why these live in the database</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Not on disk. The platforms this deploys to have an ephemeral filesystem, so a file written
          beside the app disappears on the next deployment — and a backup that vanishes exactly when
          you need it is not a backup. A day of exports for a hundred people is a few hundred
          kilobytes of text, which costs nothing next to losing them.
        </p>
      </Card>
    </div>
  );
}
