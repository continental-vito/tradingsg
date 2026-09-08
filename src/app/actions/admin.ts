"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/server/auth/guard";
import { revokeAllSessions } from "@/server/auth/session";
import { db } from "@/server/db";
import { formatCents } from "@/server/money";
import { applyAdjustment } from "@/server/portfolio/adjust";

/**
 * Administrative mutations.
 *
 * Every one calls requireAdmin() itself. The (admin) layout also guards, but a
 * server action is reachable by POST without the layout ever rendering — the
 * layout is a convenience, not the boundary.
 *
 * Every one writes an AuditLog row. An admin who can silently change a
 * participant's portfolio mid-competition is exactly the thing a competition
 * needs to be able to prove did not happen.
 */

export interface ActionResult {
  ok: boolean;
  message?: string;
  error?: string;
}

async function audit(
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
) {
  await db.auditLog.create({
    data: {
      actorUserId,
      actorRole: "ADMIN",
      action,
      entityType,
      entityId,
      beforeJson: before === undefined ? null : JSON.stringify(before),
      afterJson: after === undefined ? null : JSON.stringify(after),
    },
  });
}

const competitionSchema = z.object({
  competitionId: z.string().min(1),
  name: z.string().trim().min(1, "The competition needs a name."),
  description: z.string().trim().max(500).optional(),
  status: z.enum(["DRAFT", "REGISTRATION", "RUNNING", "PAUSED", "ENDED"]),
  registrationOpen: z.boolean(),
});

export async function updateCompetitionAction(
  input: z.input<typeof competitionSchema>,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = competitionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Those values are not valid." };
  }

  const before = await db.competition.findUnique({ where: { id: parsed.data.competitionId } });
  if (!before) return { ok: false, error: "That competition no longer exists." };

  const updated = await db.competition.update({
    where: { id: parsed.data.competitionId },
    data: {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      status: parsed.data.status,
      registrationOpen: parsed.data.registrationOpen,
    },
  });

  await audit(
    admin.id,
    "competition.update",
    "Competition",
    updated.id,
    { status: before.status, registrationOpen: before.registrationOpen },
    { status: updated.status, registrationOpen: updated.registrationOpen },
  );

  revalidatePath("/admin");
  revalidatePath("/");
  return { ok: true, message: "Competition updated." };
}

const settingsSchema = z.object({
  competitionId: z.string().min(1),
  tradingMode: z.enum(["ANYTIME", "ONCE_PER_PERIOD", "WINDOWS", "LOCKED"]),
  maxChangesPerPeriod: z.coerce.number().int().min(1).max(50),
  maxPositionPct: z.coerce.number().min(1).max(100),
  minPositionPct: z.coerce.number().min(0).max(100),
  allowCash: z.boolean(),
  allowFractionalShares: z.boolean(),
  feeBps: z.coerce.number().int().min(0).max(1000),
});

/**
 * Rule changes write a NEW settings revision and supersede the old one, rather
 * than editing in place. A rebalance committed in week two can then still be
 * re-validated against the rules that were live in week two — tightening a cap
 * retroactively must not make historical portfolios look illegal.
 */
export async function updateSettingsAction(
  input: z.input<typeof settingsSchema>,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Those rules are not valid." };
  }
  const d = parsed.data;

  if (d.minPositionPct > d.maxPositionPct) {
    return {
      ok: false,
      error: `The minimum position (${d.minPositionPct}%) cannot exceed the maximum (${d.maxPositionPct}%).`,
    };
  }

  const current = await db.competitionSettings.findFirst({
    where: { competitionId: d.competitionId, supersededAt: null },
    orderBy: { revision: "desc" },
  });
  if (!current) return { ok: false, error: "That competition has no settings to update." };

  const next = await db.$transaction(async (tx) => {
    await tx.competitionSettings.update({
      where: { id: current.id },
      data: { supersededAt: new Date() },
    });
    return tx.competitionSettings.create({
      data: {
        ...stripIds(current),
        revision: current.revision + 1,
        effectiveFrom: new Date(),
        supersededAt: null,
        tradingMode: d.tradingMode,
        maxChangesPerPeriod: d.maxChangesPerPeriod,
        maxPositionPpm: Math.round(d.maxPositionPct * 10_000),
        minPositionPpm: Math.round(d.minPositionPct * 10_000),
        allowCash: d.allowCash,
        allowFractionalShares: d.allowFractionalShares,
        feeBps: d.feeBps,
        feeModel: d.feeBps > 0 ? "PERCENT" : "NONE",
      },
    });
  });

  await audit(
    admin.id,
    "competition.settings.update",
    "CompetitionSettings",
    next.id,
    current,
    next,
  );

  revalidatePath("/admin/settings");
  revalidatePath("/rules");
  return { ok: true, message: `Rules saved as revision ${next.revision}.` };
}

function stripIds<T extends { id: string; createdAt: Date; updatedAt: Date }>(row: T) {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = row;
  return rest;
}

export async function setParticipantStatusAction(
  participantId: string,
  status: "ACTIVE" | "WITHDRAWN" | "DISQUALIFIED",
  reason?: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();

  const before = await db.participant.findUnique({
    where: { id: participantId },
    select: { id: true, status: true, userId: true, displayName: true },
  });
  if (!before) return { ok: false, error: "That participant no longer exists." };

  await db.participant.update({
    where: { id: participantId },
    data: {
      status,
      disqualifiedReason: status === "DISQUALIFIED" ? (reason ?? null) : null,
      withdrawnAt: status === "WITHDRAWN" ? new Date() : null,
    },
  });

  await audit(admin.id, "participant.status", "Participant", participantId, before, { status });

  revalidatePath("/admin/participants");
  revalidatePath("/leaderboard");
  return { ok: true, message: `${before.displayName} is now ${status.toLowerCase()}.` };
}

export async function setUserDisabledAction(
  userId: string,
  isDisabled: boolean,
): Promise<ActionResult> {
  const admin = await requireAdmin();

  if (userId === admin.id) {
    return { ok: false, error: "You cannot disable your own account." };
  }

  const before = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, isDisabled: true, firstName: true, lastName: true, role: true },
  });
  if (!before) return { ok: false, error: "That account no longer exists." };

  await db.user.update({ where: { id: userId }, data: { isDisabled } });

  // A disabled account must lose access now, not when its cookie happens to
  // expire a week from now.
  if (isDisabled) await revokeAllSessions(userId, "ADMIN_DISABLE");

  await audit(admin.id, "user.disabled", "User", userId, before, { isDisabled });

  revalidatePath("/admin/participants");
  return {
    ok: true,
    message: `${before.firstName} ${before.lastName} ${isDisabled ? "disabled and signed out" : "re-enabled"}.`,
  };
}

const stockSchema = z.object({
  competitionId: z.string().min(1),
  symbol: z.string().trim().toUpperCase().min(1).max(12),
  name: z.string().trim().min(1),
  sector: z.string().trim().max(60).optional(),
});

export async function addStockAction(input: z.input<typeof stockSchema>): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = stockSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That stock is not valid." };
  }
  const d = parsed.data;

  const stock = await db.stock.upsert({
    where: { symbol: d.symbol },
    update: { name: d.name, sector: d.sector ?? null, isActive: true, deletedAt: null },
    create: { symbol: d.symbol, name: d.name, sector: d.sector ?? null },
  });

  const existing = await db.competitionStock.findUnique({
    where: { competitionId_stockId: { competitionId: d.competitionId, stockId: stock.id } },
  });
  if (existing && existing.removedAt === null) {
    return { ok: false, error: `${d.symbol} is already in this competition.` };
  }

  const count = await db.competitionStock.count({ where: { competitionId: d.competitionId } });
  await db.competitionStock.upsert({
    where: { competitionId_stockId: { competitionId: d.competitionId, stockId: stock.id } },
    update: { removedAt: null, isTradable: true },
    create: { competitionId: d.competitionId, stockId: stock.id, sortOrder: count },
  });

  await audit(admin.id, "stock.add", "Stock", stock.id, null, { symbol: d.symbol });

  revalidatePath("/admin/stocks");
  return {
    ok: true,
    message: `${d.symbol} added. It has no price yet — run the price job before anyone can buy it.`,
  };
}

/**
 * Soft removal only. Hard-deleting a stock mid-competition would orphan the
 * transactions that reference it and silently zero the portfolios holding it.
 */
export async function removeStockAction(
  competitionId: string,
  stockId: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();

  const holders = await db.holding.count({
    where: { stockId, microShares: { gt: 0n }, portfolio: { competitionId } },
  });

  await db.competitionStock.update({
    where: { competitionId_stockId: { competitionId, stockId } },
    data: { removedAt: new Date(), isTradable: false },
  });

  await audit(admin.id, "stock.remove", "Stock", stockId, { holders }, { removed: true });

  revalidatePath("/admin/stocks");
  return {
    ok: true,
    message:
      holders > 0
        ? `Removed from the tradable list. ${holders} participant${holders === 1 ? "" : "s"} still hold it — their positions stay valued and can be sold, but nobody can buy more.`
        : "Removed from the tradable list.",
  };
}

const adjustSchema = z.object({
  portfolioId: z.string().min(1),
  amountCents: z.coerce.bigint(),
  reason: z.string().trim().min(3, "Say why. This is written into the audit trail."),
});

/**
 * Wraps applyAdjustment with the authorisation and the audit entry. The ledger
 * work itself lives in src/server/portfolio/adjust.ts so it can be tested.
 */
export async function adjustPortfolioAction(
  input: z.input<typeof adjustSchema>,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = adjustSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That adjustment is not valid." };
  }

  const portfolio = await db.portfolio.findUnique({
    where: { id: parsed.data.portfolioId },
    include: { participant: { select: { id: true, displayName: true } } },
  });
  if (!portfolio) return { ok: false, error: "That portfolio no longer exists." };

  const before = portfolio.cashCents;
  const result = await applyAdjustment(db, {
    portfolioId: parsed.data.portfolioId,
    amountCents: parsed.data.amountCents,
    reason: parsed.data.reason,
    tradeDate: new Date().toISOString().slice(0, 10),
  });

  if (!result.ok) return { ok: false, error: result.error };

  await audit(
    admin.id,
    "portfolio.adjust",
    "Portfolio",
    parsed.data.portfolioId,
    { cashCents: before.toString() },
    { amountCents: parsed.data.amountCents.toString(), reason: parsed.data.reason },
  );

  revalidatePath(`/admin/participants/${portfolio.participantId}`);
  revalidatePath("/leaderboard");
  return {
    ok: true,
    message: `${formatCents(parsed.data.amountCents)} recorded for ${portfolio.participant.displayName}. Their portfolio is now flagged, and the adjustment is excluded from their return.`,
  };
}
