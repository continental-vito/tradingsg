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

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const competitionSchema = z.object({
  competitionId: z.string().min(1),
  name: z.string().trim().min(1, "The competition needs a name."),
  description: z.string().trim().max(500).optional(),
  status: z.enum(["DRAFT", "REGISTRATION", "RUNNING", "PAUSED", "ENDED"]),
  registrationOpen: z.boolean(),
  startDate: z.string().regex(DATE, "Use a YYYY-MM-DD date."),
  endDate: z.string().regex(DATE, "Use a YYYY-MM-DD date."),
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

  const d = parsed.data;

  if (d.endDate <= d.startDate) {
    return { ok: false, error: "The competition has to end after it starts." };
  }

  // Moving the window after portfolios exist silently rewrites what every
  // stored valuation was measured against, so it is refused rather than
  // quietly invalidating the standings.
  if (d.startDate !== before.startDate) {
    const valued = await db.portfolioValuation.count({
      where: { competitionId: d.competitionId },
    });
    if (valued > 0) {
      return {
        ok: false,
        error: `The start date cannot be moved: ${valued} valuations have already been computed against ${before.startDate}, and changing it would silently alter every return. End the competition and create a new one instead.`,
      };
    }
  }

  const updated = await db.competition.update({
    where: { id: d.competitionId },
    data: {
      name: d.name,
      description: d.description ?? null,
      status: d.status,
      registrationOpen: d.registrationOpen,
      startDate: d.startDate,
      endDate: d.endDate,
      startsAt: new Date(`${d.startDate}T08:00:00Z`),
      endsAt: new Date(`${d.endDate}T17:30:00Z`),
    },
  });

  await audit(
    admin.id,
    "competition.update",
    "Competition",
    updated.id,
    {
      status: before.status,
      registrationOpen: before.registrationOpen,
      startDate: before.startDate,
      endDate: before.endDate,
    },
    {
      status: updated.status,
      registrationOpen: updated.registrationOpen,
      startDate: updated.startDate,
      endDate: updated.endDate,
    },
  );

  revalidatePath("/admin");
  revalidatePath("/admin/competition");
  revalidatePath("/");
  revalidatePath("/competition");
  return { ok: true, message: `${updated.name} updated.` };
}

const createSchema = z.object({
  name: z.string().trim().min(1, "The competition needs a name."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and hyphens only.")
    .min(2)
    .max(50),
  description: z.string().trim().max(500).optional(),
  startDate: z.string().regex(DATE, "Use a YYYY-MM-DD date."),
  endDate: z.string().regex(DATE, "Use a YYYY-MM-DD date."),
  startingCapitalEuros: z.coerce.number().int().min(1).max(100_000_000),
  timezone: z.string().trim().min(1).default("Europe/Berlin"),
  copyStocksFrom: z.string().optional(),
});

/**
 * Creating a competition, with its settings row and stock universe, in one
 * transaction. A competition without settings has no rules for the rebalance
 * planner to validate against, and a competition without stocks cannot be
 * allocated — half a competition is not a useful thing to have created.
 */
export async function createCompetitionAction(
  input: z.input<typeof createSchema>,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Those values are not valid." };
  }
  const d = parsed.data;

  if (d.endDate <= d.startDate) {
    return { ok: false, error: "The competition has to end after it starts." };
  }
  if (await db.competition.findUnique({ where: { slug: d.slug } })) {
    return { ok: false, error: `A competition with the address "${d.slug}" already exists.` };
  }

  const created = await db.$transaction(async (tx) => {
    const competition = await tx.competition.create({
      data: {
        slug: d.slug,
        name: d.name,
        description: d.description ?? null,
        status: "DRAFT",
        registrationOpen: false,
        timezone: d.timezone,
        startingCapitalCents: BigInt(d.startingCapitalEuros) * 100n,
        startDate: d.startDate,
        endDate: d.endDate,
        startsAt: new Date(`${d.startDate}T08:00:00Z`),
        endsAt: new Date(`${d.endDate}T17:30:00Z`),
      },
    });

    await tx.competitionSettings.create({
      data: { competitionId: competition.id, revision: 1 },
    });

    if (d.copyStocksFrom) {
      const source = await tx.competitionStock.findMany({
        where: { competitionId: d.copyStocksFrom, removedAt: null },
        orderBy: { sortOrder: "asc" },
      });
      for (const [i, row] of source.entries()) {
        await tx.competitionStock.create({
          data: { competitionId: competition.id, stockId: row.stockId, sortOrder: i },
        });
      }
    }

    return competition;
  });

  await audit(admin.id, "competition.create", "Competition", created.id, null, {
    slug: created.slug,
    startDate: created.startDate,
    endDate: created.endDate,
  });

  revalidatePath("/admin");
  revalidatePath("/admin/competition");
  return {
    ok: true,
    message: `${created.name} created as a draft. Add stocks, then open registration when you are ready.`,
  };
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

const windowSchema = z.object({
  competitionId: z.string().min(1),
  label: z.string().trim().min(1, "Give the window a name.").max(60),
  opensAt: z.string().min(1),
  closesAt: z.string().min(1),
});

/**
 * Trading windows.
 *
 * Selecting "only during scheduled windows" used to be a trap: the rule was
 * honoured by the engine and nothing could create a window, so choosing it
 * locked every participant out with "none are scheduled". A setting you can
 * choose that breaks trading is worse than one that is not offered.
 */
export async function createTradingWindowAction(
  input: z.input<typeof windowSchema>,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = windowSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That window is not valid." };
  }

  const opensAt = new Date(parsed.data.opensAt);
  const closesAt = new Date(parsed.data.closesAt);
  if (Number.isNaN(opensAt.getTime()) || Number.isNaN(closesAt.getTime())) {
    return { ok: false, error: "Those are not valid dates and times." };
  }
  if (closesAt <= opensAt) {
    return { ok: false, error: "A window has to close after it opens." };
  }

  const overlapping = await db.tradingWindow.findFirst({
    where: {
      competitionId: parsed.data.competitionId,
      isActive: true,
      opensAt: { lt: closesAt },
      closesAt: { gt: opensAt },
    },
  });
  if (overlapping) {
    return {
      ok: false,
      error: `That overlaps "${overlapping.label}", which runs from ${overlapping.opensAt.toLocaleString("en-GB")} to ${overlapping.closesAt.toLocaleString("en-GB")}.`,
    };
  }

  const created = await db.tradingWindow.create({
    data: {
      competitionId: parsed.data.competitionId,
      label: parsed.data.label,
      opensAt,
      closesAt,
    },
  });

  await audit(admin.id, "competition.window.create", "TradingWindow", created.id, null, {
    label: created.label,
    opensAt: created.opensAt.toISOString(),
    closesAt: created.closesAt.toISOString(),
  });

  revalidatePath("/admin/settings");
  revalidatePath("/rules");
  return { ok: true, message: `"${created.label}" added.` };
}

export async function deleteTradingWindowAction(id: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  const window = await db.tradingWindow.findUnique({ where: { id } });
  if (!window) return { ok: false, error: "That window no longer exists." };

  // Deactivated rather than deleted: a window that was open when somebody
  // traded is part of why that trade was allowed, and the audit trail should
  // still be able to show it.
  await db.tradingWindow.update({ where: { id }, data: { isActive: false } });

  await audit(admin.id, "competition.window.remove", "TradingWindow", id, window, {
    isActive: false,
  });

  revalidatePath("/admin/settings");
  revalidatePath("/rules");
  return { ok: true, message: `"${window.label}" removed.` };
}
