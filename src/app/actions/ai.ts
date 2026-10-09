"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/app/actions/admin";
import {
  previewRebalanceAction,
  submitRebalanceAction,
  type PlanPreview,
  type SubmitResult,
} from "@/app/actions/portfolio";
import { requireAdmin } from "@/server/auth/guard";
import { auditJson } from "@/server/audit";
import { db } from "@/server/db";
import { createAiInvestor, findAiPortfolio } from "@/server/ai/investor";

/**
 * Managing the AI investor. Admin-only, audited, and thin: the work is in
 * src/server/ai/investor.ts, where it can be tested without a request.
 */

async function audit(actorUserId: string, action: string, entityId: string, after: unknown) {
  await db.auditLog.create({
    data: {
      actorUserId,
      actorRole: "ADMIN",
      action,
      entityType: "AiInvestor",
      entityId,
      afterJson: auditJson(after),
    },
  });
}

const strategySchema = z
  .string()
  .trim()
  .min(10, "Describe the strategy in a sentence or two.")
  .max(4_000);

const createSchema = z.object({
  competitionId: z.string().min(1),
  name: z.string().trim().min(1, "Give the AI investor a name.").max(40),
  strategy: strategySchema,
});

export async function createAiInvestorAction(
  input: z.input<typeof createSchema>,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Those values are not valid." };
  }

  const result = await createAiInvestor(db, parsed.data);
  if (!result.ok) return { ok: false, error: result.error };

  await audit(admin.id, "ai.create", result.aiInvestorId, { name: parsed.data.name });
  revalidatePath("/admin/ai");
  revalidatePath("/leaderboard");
  return {
    ok: true,
    message: `${parsed.data.name} joined with the starting capital. Set its allocation below.`,
  };
}

const strategyUpdateSchema = z.object({
  aiInvestorId: z.string().min(1),
  strategy: strategySchema,
});

export async function updateAiStrategyAction(
  input: z.input<typeof strategyUpdateSchema>,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = strategyUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That strategy is not valid." };
  }

  const existing = await db.aiInvestor.findUnique({ where: { id: parsed.data.aiInvestorId } });
  if (!existing) return { ok: false, error: "That AI investor no longer exists." };

  await db.aiInvestor.update({
    where: { id: parsed.data.aiInvestorId },
    data: { strategy: parsed.data.strategy },
  });
  await audit(admin.id, "ai.strategy", parsed.data.aiInvestorId, {
    strategy: parsed.data.strategy,
  });

  revalidatePath("/admin/ai");
  return { ok: true, message: "Strategy saved." };
}

/**
 * The participant preview and commit, limited to the AI investor's portfolio.
 * Everything after the check is the same code a person's "Confirm" reaches,
 * which is what holds the AI to the same token, caps and fee.
 */
export async function previewAiRebalanceAction(
  portfolioId: string,
  rawTargets: unknown,
): Promise<PlanPreview> {
  await requireAdmin();
  if (!(await findAiPortfolio(db, portfolioId))) {
    return {
      ok: false,
      errors: [
        { code: "NOT_FOUND", message: "That AI investor no longer exists.", severity: "ERROR" },
      ],
      warnings: [],
    };
  }
  return previewRebalanceAction(portfolioId, rawTargets);
}

export async function submitAiRebalanceAction(
  portfolioId: string,
  rawTargets: unknown,
  idempotencyKey?: string,
): Promise<SubmitResult> {
  await requireAdmin();
  if (!(await findAiPortfolio(db, portfolioId))) {
    return {
      ok: false,
      errors: [
        { code: "NOT_FOUND", message: "That AI investor no longer exists.", severity: "ERROR" },
      ],
    };
  }
  const result = await submitRebalanceAction(portfolioId, rawTargets, idempotencyKey);
  revalidatePath("/admin/ai");
  return result;
}
