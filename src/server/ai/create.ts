import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { hashPassword } from "@/server/auth/password";
import { enrolInCompetition } from "@/server/portfolio/enrol";

/**
 * Creating an AI investor. Separate from investor.ts because it hashes a
 * password, which is server-only, while the decision code also runs from the
 * job CLI in plain Node.
 */

/** Accounts that exist only to be traded by the AI; nothing is ever delivered here. */
const AI_EMAIL_DOMAIN = "ai.tradingsg.invalid";

export async function createAiInvestor(
  db: PrismaClient,
  args: { name: string; strategy: string; model: string; competitionId: string },
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
    data: { userId: user.id, model: args.model, strategy: args.strategy.trim() },
  });
  return { ok: true, aiInvestorId: investor.id };
}
