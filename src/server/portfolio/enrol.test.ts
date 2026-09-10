import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, seedCompetition } from "@/test/db";
import { checkPortfolioInvariants } from "./invariant";
import { enrolInCompetition } from "./enrol";

let db: PrismaClient;
let cleanup: () => Promise<void>;
let competitionId: string;

async function makeUser(email: string) {
  return db.user.create({
    data: { email, passwordHash: "x", firstName: "New", lastName: "Joiner" },
  });
}

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  cleanup = t.cleanup;
  const competition = await seedCompetition(db);
  competitionId = competition.id;
}, 60_000);

afterAll(async () => {
  await cleanup();
});

describe("enrolInCompetition", () => {
  // The bug this guards: registration created a User and nothing else, so a new
  // sign-up had a working login and a 404 on the page onboarding sent them to.
  it("creates a participant, a funded portfolio and the funding row together", async () => {
    const user = await makeUser("first@example.com");
    const result = await enrolInCompetition(db, { userId: user.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(true);

    const portfolio = await db.portfolio.findUniqueOrThrow({
      where: { id: result.portfolioId },
      include: { transactions: true },
    });
    expect(portfolio.cashCents).toBe(10_000_000n);
    expect(portfolio.initialCapitalCents).toBe(10_000_000n);
    expect(portfolio.transactions).toHaveLength(1);
    expect(portfolio.transactions[0]?.type).toBe("INITIAL_FUNDING");
    // A funded portfolio must reconcile from the very first row.
    expect(await checkPortfolioInvariants(db, result.portfolioId)).toEqual([]);
  });

  it("is idempotent — joining twice does not fund twice", async () => {
    const user = await makeUser("twice@example.com");
    const first = await enrolInCompetition(db, { userId: user.id });
    const second = await enrolInCompetition(db, { userId: user.id });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.created).toBe(false);
    expect(second.portfolioId).toBe(first.portfolioId);
    expect(await db.transaction.count({ where: { portfolioId: first.portfolioId } })).toBe(1);
    expect(await db.participant.count({ where: { userId: user.id } })).toBe(1);
  });

  it("names the participant the way the leaderboard does", async () => {
    const user = await makeUser("naming@example.com");
    const result = await enrolInCompetition(db, { userId: user.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const participant = await db.participant.findUniqueOrThrow({
      where: { id: result.participantId },
    });
    expect(participant.displayName).toBe("New J.");
  });

  it("refuses, with a reason, when registration is closed", async () => {
    await db.competition.update({
      where: { id: competitionId },
      data: { registrationOpen: false },
    });
    const user = await makeUser("closed@example.com");
    const result = await enrolInCompetition(db, { userId: user.id });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("REGISTRATION_CLOSED");
    // ...and left nothing half-created behind.
    expect(await db.participant.count({ where: { userId: user.id } })).toBe(0);

    await db.competition.update({
      where: { id: competitionId },
      data: { registrationOpen: true },
    });
  });

  it("refuses a disabled account", async () => {
    const user = await makeUser("disabled@example.com");
    await db.user.update({ where: { id: user.id }, data: { isDisabled: true } });
    const result = await enrolInCompetition(db, { userId: user.id });
    expect(result.ok).toBe(false);
  });

  it("says so plainly when there is no competition to join", async () => {
    await db.competition.update({
      where: { id: competitionId },
      data: { status: "ENDED" },
    });
    const user = await makeUser("nocomp@example.com");
    const result = await enrolInCompetition(db, { userId: user.id });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("NO_COMPETITION");
    expect(result.error).toContain("no competition open");

    await db.competition.update({
      where: { id: competitionId },
      data: { status: "RUNNING" },
    });
  });
});
