import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { DateKey } from "@/lib/dates";
import { toCsv } from "./csv";

/**
 * The daily backup.
 *
 * Four files that together are enough to rebuild the competition from nothing:
 *
 *   participants  who is playing, what they started with, where their cash is
 *   holdings      what each of them holds right now
 *   transactions  the full append-only ledger — the authoritative record
 *   prices        every close used to value anything
 *
 * `transactions` and `prices` alone are sufficient: holdings and valuations are
 * both derivable from them. The other two are included because a recovery you
 * cannot eyeball is a recovery you cannot trust, and because comparing a
 * rebuilt holding against the exported one is how you know the rebuild worked.
 *
 * Everybody is keyed by email rather than by id. Ids are regenerated when rows
 * are recreated; an email address survives, which is what makes the files
 * useful for reconstruction rather than merely for reading.
 */

export type ExportKind = "participants" | "holdings" | "transactions" | "prices";

export const EXPORT_KINDS: readonly ExportKind[] = [
  "participants",
  "holdings",
  "transactions",
  "prices",
];

export interface BuiltExport {
  kind: ExportKind;
  filename: string;
  content: string;
  rowCount: number;
  byteSize: number;
  checksum: string;
}

function finish(
  kind: ExportKind,
  asOfDate: DateKey,
  slug: string,
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
): BuiltExport {
  const content = toCsv(headers, rows);
  return {
    kind,
    filename: `${slug}-${kind}-${asOfDate}.csv`,
    content,
    rowCount: rows.length,
    byteSize: Buffer.byteLength(content, "utf8"),
    // Stored so a downloaded file can be verified against what was generated.
    checksum: createHash("sha256").update(content).digest("hex"),
  };
}

export async function buildExports(
  db: PrismaClient,
  competitionId: string,
  asOfDate: DateKey,
): Promise<BuiltExport[]> {
  const competition = await db.competition.findUniqueOrThrow({
    where: { id: competitionId },
    select: { slug: true },
  });
  const slug = competition.slug;

  const participants = await db.participant.findMany({
    where: { competitionId, deletedAt: null },
    include: {
      user: true,
      portfolio: { include: { holdings: { include: { stock: true } } } },
    },
    orderBy: { displayName: "asc" },
  });

  const participantRows = participants.map((p) => [
    p.user.email,
    p.user.firstName,
    p.user.lastName,
    p.user.department ?? "",
    p.displayName,
    p.user.role,
    p.status,
    p.user.isDisabled,
    p.isDemo,
    p.initialCapitalCents,
    p.portfolio?.cashCents ?? 0n,
    p.portfolio?.costBasisCents ?? 0n,
    p.portfolio?.realizedPnlCents ?? 0n,
    p.portfolio?.totalFeesCents ?? 0n,
    p.portfolio?.netFlowCents ?? 0n,
    p.portfolio?.transactionSeq ?? 0,
    p.adjustedByAdmin,
    p.joinedAt,
    p.activatedAt,
    p.portfolio?.setupCompletedAt ?? null,
  ]);

  const holdingRows = participants.flatMap((p) =>
    (p.portfolio?.holdings ?? [])
      .filter((h) => h.microShares > 0n)
      .map((h) => [
        p.user.email,
        h.stock.symbol,
        h.stock.name,
        h.microShares,
        h.costBasisCents,
        h.realizedPnlCents,
        h.firstBoughtAt,
        h.lastTradedAt,
      ]),
  );

  const transactions = await db.transaction.findMany({
    where: { participant: { competitionId } },
    include: {
      stock: { select: { symbol: true } },
      participant: { select: { user: { select: { email: true } } } },
    },
    orderBy: [{ participantId: "asc" }, { sequence: "asc" }],
  });

  const transactionRows = transactions.map((t) => [
    t.participant.user.email,
    t.sequence,
    t.type,
    t.tradeDate,
    t.executedAt,
    t.stock?.symbol ?? "",
    t.microShareDelta,
    t.priceCents,
    t.grossCents,
    t.feeCents,
    t.cashDeltaCents,
    t.costAddedCents,
    t.costRemovedCents,
    t.realizedPnlCents,
    t.cashAfterCents,
    t.microSharesAfter,
    t.isExternalFlow,
    t.note ?? "",
  ]);

  const prices = await db.priceHistory.findMany({
    where: { supersededAt: null, stock: { competitions: { some: { competitionId } } } },
    include: { stock: { select: { symbol: true, providerSymbol: true } } },
    orderBy: [{ tradeDate: "asc" }, { stockId: "asc" }],
  });

  const priceRows = prices.map((p) => [
    p.stock.symbol,
    p.stock.providerSymbol ?? "",
    p.tradeDate,
    p.closeCents,
    p.prevCloseCents,
    p.source,
    p.isSynthetic,
    p.revision,
  ]);

  return [
    finish(
      "participants",
      asOfDate,
      slug,
      [
        "email",
        "first_name",
        "last_name",
        "department",
        "display_name",
        "role",
        "status",
        "account_disabled",
        "is_demo",
        "initial_capital_cents",
        "cash_cents",
        "cost_basis_cents",
        "realized_pnl_cents",
        "total_fees_cents",
        "net_flow_cents",
        "transaction_seq",
        "adjusted_by_admin",
        "joined_at",
        "activated_at",
        "setup_completed_at",
      ],
      participantRows,
    ),
    finish(
      "holdings",
      asOfDate,
      slug,
      [
        "email",
        "symbol",
        "name",
        "micro_shares",
        "cost_basis_cents",
        "realized_pnl_cents",
        "first_bought_at",
        "last_traded_at",
      ],
      holdingRows,
    ),
    finish(
      "transactions",
      asOfDate,
      slug,
      [
        "email",
        "sequence",
        "type",
        "trade_date",
        "executed_at",
        "symbol",
        "micro_share_delta",
        "price_cents",
        "gross_cents",
        "fee_cents",
        "cash_delta_cents",
        "cost_added_cents",
        "cost_removed_cents",
        "realized_pnl_cents",
        "cash_after_cents",
        "micro_shares_after",
        "is_external_flow",
        "note",
      ],
      transactionRows,
    ),
    finish(
      "prices",
      asOfDate,
      slug,
      [
        "symbol",
        "provider_symbol",
        "trade_date",
        "close_cents",
        "prev_close_cents",
        "source",
        "is_synthetic",
        "revision",
      ],
      priceRows,
    ),
  ];
}

/** Writes (or rewrites) the day's exports. Idempotent on the unique key. */
export async function storeExports(
  db: PrismaClient,
  competitionId: string,
  asOfDate: DateKey,
  triggeredBy: "CRON" | "ADMIN",
): Promise<BuiltExport[]> {
  const built = await buildExports(db, competitionId, asOfDate);

  for (const file of built) {
    const data = {
      filename: file.filename,
      content: file.content,
      rowCount: file.rowCount,
      byteSize: file.byteSize,
      checksum: file.checksum,
      triggeredBy,
    };
    await db.dataExport.upsert({
      where: { competitionId_asOfDate_kind: { competitionId, asOfDate, kind: file.kind } },
      update: data,
      create: { competitionId, asOfDate, kind: file.kind, ...data },
    });
  }

  return built;
}

/**
 * Drops exports older than `keepDays`. A backup nobody will ever open still
 * costs storage, and the useful window for "undo what happened" is weeks.
 */
export async function pruneExports(
  db: PrismaClient,
  competitionId: string,
  olderThan: DateKey,
): Promise<number> {
  const result = await db.dataExport.deleteMany({
    where: { competitionId, asOfDate: { lt: olderThan } },
  });
  return result.count;
}
