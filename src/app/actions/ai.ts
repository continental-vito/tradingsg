"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/app/actions/admin";
import { requireAdmin } from "@/server/auth/guard";
import { auditJson } from "@/server/audit";
import { db } from "@/server/db";
import { advisorConfigured, createAdvisor } from "@/server/ai";
import { createAiInvestor } from "@/server/ai/create";
import { runAiInvestor } from "@/server/ai/investor";

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

const modelSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9.-]{2,60}$/, "Use a model id such as claude-opus-5-5.");

const createSchema = z.object({
  competitionId: z.string().min(1),
  name: z.string().trim().min(1, "Give the AI investor a name.").max(40),
  model: modelSchema,
  strategy: z
    .string()
    .trim()
    .min(10, "Describe the strategy in a sentence or two — it is what the AI follows.")
    .max(4_000),
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

  await audit(admin.id, "ai.create", result.aiInvestorId, {
    name: parsed.data.name,
    model: parsed.data.model,
  });
  revalidatePath("/admin/ai");
  revalidatePath("/leaderboard");
  return {
    ok: true,
    message: `${parsed.data.name} joined with the starting capital. It decides every Monday morning, or now with "Run now".`,
  };
}

const updateSchema = z.object({
  aiInvestorId: z.string().min(1),
  model: modelSchema,
  strategy: z.string().trim().min(10, "Describe the strategy in a sentence or two.").max(4_000),
  isEnabled: z.boolean(),
});

export async function updateAiInvestorAction(
  input: z.input<typeof updateSchema>,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Those values are not valid." };
  }
  const { aiInvestorId, ...data } = parsed.data;

  const existing = await db.aiInvestor.findUnique({ where: { id: aiInvestorId } });
  if (!existing) return { ok: false, error: "That AI investor no longer exists." };

  await db.aiInvestor.update({ where: { id: aiInvestorId }, data });
  await audit(admin.id, "ai.update", aiInvestorId, data);

  revalidatePath("/admin/ai");
  return {
    ok: true,
    message: data.isEnabled
      ? "Saved. The new instructions apply from its next decision."
      : "Saved and paused. It will not trade until you enable it again.",
  };
}

export async function runAiInvestorNowAction(aiInvestorId: string): Promise<ActionResult> {
  const admin = await requireAdmin();

  const existing = await db.aiInvestor.findUnique({ where: { id: aiInvestorId } });
  if (!existing) return { ok: false, error: "That AI investor no longer exists." };
  if (!advisorConfigured()) {
    return {
      ok: false,
      error:
        "ANTHROPIC_API_KEY is not set, so there is no model to ask. Add it to the environment and redeploy.",
    };
  }

  const outcome = await runAiInvestor(db, createAdvisor(), {
    aiInvestorId,
    triggeredBy: "ADMIN",
  });
  await audit(admin.id, "ai.run", aiInvestorId, outcome);

  revalidatePath("/admin/ai");
  revalidatePath("/leaderboard");
  return outcome.status === "TRADED" || outcome.status === "SKIPPED"
    ? { ok: true, message: outcome.summary }
    : { ok: false, error: outcome.summary };
}
