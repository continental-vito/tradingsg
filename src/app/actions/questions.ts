"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/app/actions/admin";
import { dateKeyOf } from "@/lib/dates";
import { SurveyAdjustmentBase } from "@/lib/enums";
import { requireAdmin } from "@/server/auth/guard";
import { auditJson } from "@/server/audit";
import { db } from "@/server/db";
import { formatCents } from "@/server/money";
import { applySurveyAdjustment, planSurveyAdjustment } from "@/server/survey/adjust";

/**
 * Administering the login questions and the bonus/malus that hangs off them.
 * Every action re-checks the admin role and writes an audit entry; the ledger
 * work is in src/server/survey/adjust.ts, where it is tested.
 */

async function audit(
  actorUserId: string,
  action: string,
  entityId: string,
  before: unknown,
  after: unknown,
) {
  await db.auditLog.create({
    data: {
      actorUserId,
      actorRole: "ADMIN",
      action,
      entityType: "SurveyQuestion",
      entityId,
      beforeJson: auditJson(before),
      afterJson: auditJson(after),
    },
  });
}

const label = z.string().trim().min(1, "Both answers need a label.").max(40);
const questionSchema = z.object({
  prompt: z.string().trim().min(5, "Write the question in full.").max(300),
  yesLabel: label,
  noLabel: label,
});

export async function createQuestionAction(
  input: z.input<typeof questionSchema>,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = questionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That question is not valid." };
  }
  if (parsed.data.yesLabel.toLowerCase() === parsed.data.noLabel.toLowerCase()) {
    return { ok: false, error: "The two answers need different labels." };
  }

  const count = await db.surveyQuestion.count();
  const created = await db.surveyQuestion.create({ data: { ...parsed.data, sortOrder: count } });
  await audit(admin.id, "survey.question.create", created.id, null, parsed.data);

  revalidatePath("/admin/questions");
  return {
    ok: true,
    message: "Question added. Participants are asked it the next time they open the app.",
  };
}

const updateSchema = z.object({
  questionId: z.string().min(1),
  isActive: z.boolean(),
  allowChange: z.boolean(),
  prompt: questionSchema.shape.prompt,
  yesLabel: label,
  noLabel: label,
});

export async function updateQuestionAction(
  input: z.input<typeof updateSchema>,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Those values are not valid." };
  }
  const { questionId, ...data } = parsed.data;

  const before = await db.surveyQuestion.findUnique({
    where: { id: questionId },
    include: { _count: { select: { answers: true } } },
  });
  if (!before) return { ok: false, error: "That question no longer exists." };

  const reworded =
    data.prompt !== before.prompt ||
    data.yesLabel !== before.yesLabel ||
    data.noLabel !== before.noLabel;
  if (reworded && before._count.answers > 0) {
    return {
      ok: false,
      error: `${before._count.answers} people have already answered this wording, so it cannot change — their answers would then belong to a different question. Deactivate it and add a new one instead.`,
    };
  }

  await db.surveyQuestion.update({ where: { id: questionId }, data });
  await audit(
    admin.id,
    "survey.question.update",
    questionId,
    {
      prompt: before.prompt,
      yesLabel: before.yesLabel,
      noLabel: before.noLabel,
      isActive: before.isActive,
      allowChange: before.allowChange,
    },
    data,
  );

  revalidatePath("/admin/questions");
  revalidatePath("/account");
  return { ok: true, message: "Question saved." };
}

const adjustmentSchema = z.object({
  competitionId: z.string().min(1),
  questionId: z.string().min(1),
  answer: z.boolean(),
  ratePercent: z.coerce
    .number()
    .refine((v) => v !== 0, "Enter a percentage: positive for a bonus, negative for a malus.")
    .refine((v) => Math.abs(v) <= 100, "A bonus or malus cannot be more than 100%."),
  base: SurveyAdjustmentBase.schema,
  note: z.string().trim().max(300).optional(),
});

async function argsFrom(input: unknown) {
  const parsed = adjustmentSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Those values are not valid." } as const;
  }
  const competition = await db.competition.findUnique({
    where: { id: parsed.data.competitionId },
    select: { timezone: true, currency: true },
  });
  if (!competition) return { error: "That competition no longer exists." } as const;
  return {
    currency: competition.currency,
    args: {
      competitionId: parsed.data.competitionId,
      questionId: parsed.data.questionId,
      answer: parsed.data.answer,
      // Percent to parts per million: 2.5% is 25_000.
      ratePpm: Math.round(parsed.data.ratePercent * 10_000),
      base: parsed.data.base,
      note: parsed.data.note,
      asOfDate: dateKeyOf(new Date(), competition.timezone),
    },
  } as const;
}

export interface AdjustmentPreview {
  ok: boolean;
  error?: string;
  count?: number;
  total?: string;
  rows?: { name: string; amount: string }[];
}

/** Who would get what — nothing is written. */
export async function previewSurveyAdjustmentAction(input: unknown): Promise<AdjustmentPreview> {
  await requireAdmin();
  const built = await argsFrom(input);
  if ("error" in built) return { ok: false, error: built.error };

  const plan = await planSurveyAdjustment(db, built.args);
  if (plan.length === 0) {
    return {
      ok: false,
      error: "Nobody in the competition gave that answer, so nobody would be affected.",
    };
  }
  return {
    ok: true,
    count: plan.length,
    total: formatCents(
      plan.reduce((sum, p) => sum + p.amountCents, 0n),
      built.currency,
    ),
    rows: plan.map((p) => ({
      name: p.displayName,
      amount: formatCents(p.amountCents, built.currency),
    })),
  };
}

export async function applySurveyAdjustmentAction(
  input: unknown,
  idempotencyKey: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const built = await argsFrom(input);
  if ("error" in built) return { ok: false, error: built.error };
  if (!/^[A-Za-z0-9-]{8,64}$/.test(idempotencyKey)) {
    return { ok: false, error: "Reload the page and try again." };
  }

  const result = await applySurveyAdjustment(db, {
    ...built.args,
    idempotencyKey: `survey:${idempotencyKey}`,
    appliedByUserId: admin.id,
  });
  if (!result.ok) return { ok: false, error: result.error };

  if (!result.replayed) {
    await db.auditLog.create({
      data: {
        actorUserId: admin.id,
        actorRole: "ADMIN",
        action: "survey.adjustment.apply",
        entityType: "SurveyAdjustment",
        entityId: result.adjustmentId,
        afterJson: auditJson({
          ...built.args,
          participantCount: result.participantCount,
          totalCents: result.totalCents,
        }),
      },
    });
  }

  revalidatePath("/admin/questions");
  revalidatePath("/leaderboard");
  revalidatePath("/dashboard");
  revalidatePath("/portfolio");
  const kind = built.args.ratePpm > 0 ? "Bonus" : "Malus";
  return {
    ok: true,
    message: `${kind} applied to ${result.participantCount} participant${result.participantCount === 1 ? "" : "s"}, ${formatCents(result.totalCents, built.currency)} in total. It shows on the leaderboard after tonight's valuation.`,
  };
}
