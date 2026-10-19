import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, seedCompetition, seedParticipant } from "@/test/db";
import { commitRebalance } from "@/server/portfolio/commit";
import { EXPORT_KINDS, buildExports, storeExports, thinExports } from "./export";
import { csvCell, toCsv } from "./csv";

let db: PrismaClient;
let cleanup: () => Promise<void>;
let competitionId: string;
let stockId: string;

/** Parses a CSV back, honouring quotes and escaped quotes. */
function parseCsv(text: string): string[][] {
  const body = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inQuotes) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r") {
      /* skip */
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  cleanup = t.cleanup;

  const competition = await seedCompetition(db);
  competitionId = competition.id;
  await db.competitionSettings.create({
    data: { competitionId, revision: 1, maxPositionPpm: 1_000_000 },
  });

  // A name and a department containing the characters that break naive CSV.
  const stock = await db.stock.create({
    data: { symbol: "OR", name: 'L\'Oréal "Paris", SA', providerSymbol: "OR.PA" },
  });
  stockId = stock.id;
  await db.competitionStock.create({ data: { competitionId, stockId } });
  await db.priceHistory.createMany({
    data: [
      { stockId, tradeDate: "2026-07-24", closeCents: 38_170n, revision: 1 },
      { stockId, tradeDate: "2026-07-27", closeCents: 39_000n, revision: 1 },
    ],
  });

  const alice = await seedParticipant(db, competitionId, "o'brien@example.com");
  await db.user.update({
    where: { id: alice.user.id },
    data: { department: "Sales, EMEA" },
  });
  await commitRebalance(db, {
    portfolioId: alice.portfolio.id,
    targets: [{ stockId, weightPpm: 800_000 }],
    idempotencyKey: "export-test",
    periodKey: null,
    asOfDate: "2026-07-24",
  });
}, 90_000);

afterAll(async () => {
  await cleanup();
});

describe("csv writing", () => {
  it("quotes every field and doubles embedded quotes", () => {
    // A department with a comma, or a company with quotes in its name, must not
    // shift the columns of the file meant to rebuild the competition.
    expect(csvCell("Sales, EMEA")).toBe('"Sales, EMEA"');
    expect(csvCell('L\'Oréal "Paris"')).toBe('"L\'Oréal ""Paris"""');
    expect(csvCell(null)).toBe('""');
  });

  it("writes BigInt as a decimal string, never as a float", () => {
    // 2^53 + 1 — a Number would round it, and this is money.
    expect(csvCell(9_007_199_254_740_993n)).toBe('"9007199254740993"');
  });

  it("opens with a byte-order mark so Excel reads it as UTF-8", () => {
    // Without it, "L'Oréal" arrives as mojibake.
    expect(toCsv(["a"], [["L'Oréal"]]).startsWith("﻿")).toBe(true);
  });
});

describe("buildExports", () => {
  it("produces the four files a rebuild needs, plus the login answers", async () => {
    const files = await buildExports(db, competitionId, "2026-07-27");
    expect(files.map((f) => f.kind).sort()).toEqual([
      "answers",
      "holdings",
      "participants",
      "prices",
      "transactions",
    ]);
    for (const file of files) {
      expect(file.checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(file.byteSize).toBeGreaterThan(0);
      expect(file.filename).toContain("2026-07-27");
    }
  });

  it("survives a comma and a quote in the data, with columns intact", async () => {
    const files = await buildExports(db, competitionId, "2026-07-27");
    const participants = files.find((f) => f.kind === "participants");
    const rows = parseCsv(participants?.content ?? "");
    const header = rows[0] ?? [];
    const row = rows[1] ?? [];
    // The row must have exactly as many cells as the header, despite the comma
    // inside the department.
    expect(row.length).toBe(header.length);
    expect(row[header.indexOf("department")]).toBe("Sales, EMEA");
    expect(row[header.indexOf("email")]).toBe("o'brien@example.com");
  });

  // The point of the whole feature: the ledger in these files is enough to
  // reconstruct what each participant holds.
  it("carries a ledger that reconstructs the holdings exactly", async () => {
    const files = await buildExports(db, competitionId, "2026-07-27");
    const tx = parseCsv(files.find((f) => f.kind === "transactions")?.content ?? "");
    const header = tx[0] ?? [];
    const col = (name: string) => header.indexOf(name);

    // Rebuild shares and cash from the exported ledger alone.
    let shares = 0n;
    let cash = 0n;
    for (const row of tx.slice(1)) {
      shares += BigInt(row[col("micro_share_delta")] ?? "0");
      cash += BigInt(row[col("cash_delta_cents")] ?? "0");
    }

    const holdings = parseCsv(files.find((f) => f.kind === "holdings")?.content ?? "");
    const hHeader = holdings[0] ?? [];
    const exportedShares = BigInt(holdings[1]?.[hHeader.indexOf("micro_shares")] ?? "0");

    const portfolio = await db.portfolio.findFirstOrThrow({ where: { competitionId } });
    expect(shares).toBe(exportedShares);
    expect(shares).toBe(
      (await db.holding.findFirstOrThrow({ where: { portfolioId: portfolio.id } })).microShares,
    );
    expect(cash).toBe(portfolio.cashCents);
  });

  it("exports every price used to value anything", async () => {
    const files = await buildExports(db, competitionId, "2026-07-27");
    const rows = parseCsv(files.find((f) => f.kind === "prices")?.content ?? "");
    expect(rows.length - 1).toBe(2);
    const header = rows[0] ?? [];
    expect(rows[1]?.[header.indexOf("provider_symbol")]).toBe("OR.PA");
  });
});

describe("storeExports", () => {
  it("is idempotent — running twice rewrites rather than duplicates", async () => {
    await storeExports(db, competitionId, "2026-07-27", "CRON");
    const first = await db.dataExport.count({ where: { competitionId } });
    await storeExports(db, competitionId, "2026-07-27", "ADMIN");
    expect(await db.dataExport.count({ where: { competitionId } })).toBe(first);

    // ...and the second run's provenance replaces the first's.
    const row = await db.dataExport.findFirstOrThrow({
      where: { competitionId, asOfDate: "2026-07-27", kind: "participants" },
    });
    expect(row.triggeredBy).toBe("ADMIN");
  });

  it("keeps every Friday and the days since the last one, and thins the rest", async () => {
    // Fri 2 Oct, the whole week of 5 Oct (Mon–Sun), and Mon 12 Oct.
    const days = [
      "2026-10-02",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
    ];
    for (const day of days) await storeExports(db, competitionId, day, "CRON");

    await thinExports(db, competitionId);
    const kept = (
      await db.dataExport.findMany({
        where: { competitionId, asOfDate: { gte: "2026-10-01" } },
        distinct: ["asOfDate"],
        select: { asOfDate: true },
        orderBy: { asOfDate: "asc" },
      })
    ).map((d) => d.asOfDate);
    // Both Fridays survive; Mon–Thu of that week go; the weekend and Monday
    // after the last Friday are still this week's daily restore points.
    expect(kept).toEqual(["2026-10-02", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"]);
    // Every file of a kept day is still there.
    expect(await db.dataExport.count({ where: { competitionId, asOfDate: "2026-10-09" } })).toBe(
      EXPORT_KINDS.length,
    );
  });

  it("keeps the last backup of a week whose Friday is missing", async () => {
    // Week of 19 Oct: Mon–Thu written, Friday's run failed; then Fri 30 Oct.
    for (const day of ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-30"]) {
      await storeExports(db, competitionId, day, "CRON");
    }
    await thinExports(db, competitionId);
    const kept = (
      await db.dataExport.findMany({
        where: { competitionId, asOfDate: { gte: "2026-10-19" } },
        distinct: ["asOfDate"],
        select: { asOfDate: true },
        orderBy: { asOfDate: "asc" },
      })
    ).map((d) => d.asOfDate);
    expect(kept).toEqual(["2026-10-22", "2026-10-30"]);
  });
});
