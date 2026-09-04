import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, seedCompetition, seedParticipant } from "@/test/db";
import { findOwnParticipation, findOwnedPortfolio } from "./ownership";

let db: PrismaClient;
let cleanup: () => Promise<void>;

let alice: Awaited<ReturnType<typeof seedParticipant>>;
let bob: Awaited<ReturnType<typeof seedParticipant>>;
let competitionId: string;

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  cleanup = t.cleanup;

  const competition = await seedCompetition(db);
  competitionId = competition.id;
  alice = await seedParticipant(db, competitionId, "alice@example.com");
  bob = await seedParticipant(db, competitionId, "bob@example.com");
}, 60_000);

afterAll(async () => {
  await cleanup();
});

describe("findOwnedPortfolio", () => {
  it("returns a participant's own portfolio", async () => {
    const found = await findOwnedPortfolio(db, {
      userId: alice.user.id,
      role: "PARTICIPANT",
      portfolioId: alice.portfolio.id,
    });
    expect(found?.id).toBe(alice.portfolio.id);
  });

  // §17 of the brief, stated as an absolute: a participant may reach only their
  // own portfolio. The guard turns this null into a 404 — never a 403, because
  // a 403 would confirm the id exists.
  it("one participant cannot reach another's portfolio by changing the id", async () => {
    const found = await findOwnedPortfolio(db, {
      userId: alice.user.id,
      role: "PARTICIPANT",
      portfolioId: bob.portfolio.id,
    });
    expect(found).toBeNull();
  });

  it("returns null for a portfolio that does not exist, exactly as for one that is not yours", async () => {
    const missing = await findOwnedPortfolio(db, {
      userId: alice.user.id,
      role: "PARTICIPANT",
      portfolioId: "does-not-exist",
    });
    const notMine = await findOwnedPortfolio(db, {
      userId: alice.user.id,
      role: "PARTICIPANT",
      portfolioId: bob.portfolio.id,
    });
    expect(missing).toEqual(notMine);
  });

  it("lets an admin reach any portfolio", async () => {
    const found = await findOwnedPortfolio(db, {
      userId: alice.user.id,
      role: "ADMIN",
      portfolioId: bob.portfolio.id,
    });
    expect(found?.id).toBe(bob.portfolio.id);
  });

  it("stops resolving a soft-deleted participant's portfolio", async () => {
    // A removed participant keeps their rows for audit, but must lose access.
    await db.participant.update({
      where: { id: alice.participant.id },
      data: { deletedAt: new Date() },
    });
    const found = await findOwnedPortfolio(db, {
      userId: alice.user.id,
      role: "PARTICIPANT",
      portfolioId: alice.portfolio.id,
    });
    expect(found).toBeNull();

    await db.participant.update({
      where: { id: alice.participant.id },
      data: { deletedAt: null },
    });
  });
});

describe("findOwnParticipation", () => {
  it("resolves the caller's own participation and portfolio id", async () => {
    const found = await findOwnParticipation(db, {
      userId: bob.user.id,
      competitionId,
    });
    expect(found?.id).toBe(bob.participant.id);
    expect(found?.portfolioId).toBe(bob.portfolio.id);
  });

  it("returns null for a competition the caller has not joined", async () => {
    const other = await seedCompetition(db, "other-cup");
    const found = await findOwnParticipation(db, {
      userId: bob.user.id,
      competitionId: other.id,
    });
    expect(found).toBeNull();
  });
});

describe("database-enforced invariants", () => {
  // Application-level "check then insert" loses this race regularly. The unique
  // index is what actually stops a participant joining a competition twice.
  it("refuses a second participation in the same competition", async () => {
    await expect(
      db.participant.create({
        data: {
          userId: bob.user.id,
          competitionId,
          displayName: "Bob again",
          initialCapitalCents: 10_000_000n,
        },
      }),
    ).rejects.toThrow();
  });

  it("refuses two ledger rows with the same sequence for one portfolio", async () => {
    await expect(
      db.transaction.create({
        data: {
          portfolioId: bob.portfolio.id,
          participantId: bob.participant.id,
          sequence: 1,
          type: "BUY",
          tradeDate: "2026-08-01",
          cashDeltaCents: -100n,
          cashAfterCents: 9_999_900n,
        },
      }),
    ).rejects.toThrow();
  });
});
