import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { hashPassword } from "@/server/auth/password";
import { enrolInCompetition } from "@/server/portfolio/enrol";

/**
 * The AI investor: a participant account the administrator trades by hand
 * from /admin/ai.
 *
 * It is an ordinary participant in every way the competition can see — a User,
 * a Participant labelled "(AI)" on the leaderboard, a funded Portfolio — and
 * its rebalances go through the same preview and commit a person's do, so the
 * weekly token, the position caps, the 1% fee and the ledger invariants all
 * apply. Nothing trades it automatically.
 *
 * Kept free of Next.js so the access rule below can be tested.
 */

/** Accounts that exist only to be traded from the admin page; nothing is delivered here. */
const AI_EMAIL_DOMAIN = "ai.tradingsg.invalid";

export async function createAiInvestor(
  db: PrismaClient,
  args: { name: string; strategy: string; competitionId: string },
): Promise<{ ok: true; aiInvestorId: string } | { ok: false; error: string }> {
  const name = args.name.trim();
  // A random password nobody is told: the account can never be signed in to,
  // and `.invalid` is reserved, so a reset email cannot reach anyone either.
  const passwordHash = await hashPassword(randomBytes(32).toString("base64url"));
  const user = await db.user.create({
    data: {
      email: `ai-${randomBytes(6).toString("hex")}@${AI_EMAIL_DOMAIN}`,
      passwordHash,
      firstName: name,
      lastName: "AI",
      department: "AI investor",
      role: "PARTICIPANT",
    },
  });

  const enrolled = await enrolInCompetition(db, {
    userId: user.id,
    competitionId: args.competitionId,
    byAdmin: true,
    // Labelled on the leaderboard, so nobody mistakes it for a colleague.
    displayName: `${name} (AI)`,
  });
  if (!enrolled.ok) {
    await db.user.delete({ where: { id: user.id } });
    return { ok: false, error: enrolled.error };
  }

  const investor = await db.aiInvestor.create({
    data: { userId: user.id, strategy: args.strategy.trim() },
  });
  return { ok: true, aiInvestorId: investor.id };
}

/**
 * The portfolio, if and only if it belongs to an AI investor.
 *
 * This is what limits the admin page to trading the AI's book. An administrator
 * can otherwise reach any portfolio, and "the admin quietly rebalanced a
 * colleague" is exactly what a competition must be able to rule out. As
 * everywhere else, the rule is part of the `where`, not a check afterwards.
 */
export async function findAiPortfolio(
  db: PrismaClient,
  portfolioId: string,
): Promise<{ id: string } | null> {
  return db.portfolio.findFirst({
    where: {
      id: portfolioId,
      participant: { deletedAt: null, user: { aiInvestor: { isNot: null } } },
    },
    select: { id: true },
  });
}
