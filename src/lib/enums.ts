import { z } from "zod";

/**
 * SQLite has no enum type, and a CHECK constraint that exists on only one of
 * the two supported providers is worse than none. So every enum-like column is
 * a `String`, and this file is the single source of truth for what may go in
 * it. Each `zX` schema is applied at every boundary: server-action input, job
 * CLI arguments, provider adapter output, and on read where a domain object is
 * hydrated.
 */

function makeEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return {
    values,
    schema: z.enum(values),
  };
}

export const UserRole = makeEnum(["PARTICIPANT", "ADMIN"] as const);
export type UserRole = z.infer<typeof UserRole.schema>;

export const CompetitionStatus = makeEnum([
  "DRAFT",
  "REGISTRATION",
  "RUNNING",
  "PAUSED",
  "ENDED",
] as const);
export type CompetitionStatus = z.infer<typeof CompetitionStatus.schema>;

export const ParticipantStatus = makeEnum([
  "INVITED",
  "REGISTERED",
  "ACTIVE",
  "WITHDRAWN",
  "DISQUALIFIED",
] as const);
export type ParticipantStatus = z.infer<typeof ParticipantStatus.schema>;

export const PortfolioStatus = makeEnum(["DRAFT", "ACTIVE", "LOCKED"] as const);
export type PortfolioStatus = z.infer<typeof PortfolioStatus.schema>;

export const TradingMode = makeEnum(["ANYTIME", "ONCE_PER_PERIOD", "WINDOWS", "LOCKED"] as const);
export type TradingMode = z.infer<typeof TradingMode.schema>;

export const PeriodUnit = makeEnum(["DAY", "WEEK", "MONTH"] as const);
export type PeriodUnit = z.infer<typeof PeriodUnit.schema>;

export const FeeModel = makeEnum(["NONE", "FLAT", "PERCENT", "PERCENT_WITH_MIN"] as const);
export type FeeModel = z.infer<typeof FeeModel.schema>;

export const PriceMode = makeEnum(["LAST_CLOSE", "LIVE"] as const);
export type PriceMode = z.infer<typeof PriceMode.schema>;

/**
 * INITIAL_FUNDING and the two ADJUSTMENT types are the only external flows —
 * see Transaction.isExternalFlow. Everything else moves money between the cash
 * bucket and the holdings bucket of the same portfolio and must never break a
 * return sub-period.
 */
export const TransactionType = makeEnum([
  "INITIAL_FUNDING",
  "BUY",
  "SELL",
  "FEE",
  "ADJUSTMENT_CREDIT",
  "ADJUSTMENT_DEBIT",
  "LIQUIDATION_SELL",
] as const);
export type TransactionType = z.infer<typeof TransactionType.schema>;

export const EXTERNAL_FLOW_TYPES: ReadonlySet<TransactionType> = new Set([
  "INITIAL_FUNDING",
  "ADJUSTMENT_CREDIT",
  "ADJUSTMENT_DEBIT",
]);

export const ValuationKind = makeEnum([
  "INCEPTION",
  "EOD",
  "INTRADAY",
  "REBALANCE",
  "FINAL",
] as const);
export type ValuationKind = z.infer<typeof ValuationKind.schema>;

export const SnapshotKind = makeEnum(["DAILY", "WEEKLY", "FINAL"] as const);
export type SnapshotKind = z.infer<typeof SnapshotKind.schema>;

export const PriceQuality = makeEnum(["OK", "PARTIAL", "DEGRADED"] as const);
export type PriceQuality = z.infer<typeof PriceQuality.schema>;

export const PricePointSource = makeEnum([
  "CLOSE",
  "CARRY_FORWARD",
  "INTRADAY",
  "COST_BASIS",
] as const);
export type PricePointSource = z.infer<typeof PricePointSource.schema>;

export const UnrankedReason = makeEnum([
  "NO_PORTFOLIO",
  "NOT_INVESTED",
  "WITHDRAWN",
  "NO_VALUATION",
] as const);
export type UnrankedReason = z.infer<typeof UnrankedReason.schema>;

export const RebalanceStatus = makeEnum(["PENDING", "COMMITTED", "REJECTED", "FAILED"] as const);
export type RebalanceStatus = z.infer<typeof RebalanceStatus.schema>;

export const ReportStatus = makeEnum([
  "DRAFT",
  "READY",
  "SCHEDULED",
  "SENDING",
  "SENT",
  "PARTIALLY_SENT",
  "FAILED",
] as const);
export type ReportStatus = z.infer<typeof ReportStatus.schema>;

export const EntrySendStatus = makeEnum(["PENDING", "SKIPPED", "SENT", "FAILED"] as const);
export type EntrySendStatus = z.infer<typeof EntrySendStatus.schema>;

export const EmailStatus = makeEnum(["QUEUED", "SENDING", "SENT", "FAILED", "SKIPPED"] as const);
export type EmailStatus = z.infer<typeof EmailStatus.schema>;

export const EmailKind = makeEnum([
  "WEEKLY_REPORT",
  "PASSWORD_RESET",
  "WELCOME",
  "ADMIN_ALERT",
  "TEST",
] as const);
export type EmailKind = z.infer<typeof EmailKind.schema>;

export const NotificationType = makeEnum([
  "COMPETITION_START",
  "SETUP_DEADLINE",
  "WEEKLY_REPORT",
  "ENTERED_TOP_THREE",
  "OVERTAKEN",
  "COMPETITION_END",
  "TRADE_EXECUTED",
  "ADMIN_MESSAGE",
] as const);
export type NotificationType = z.infer<typeof NotificationType.schema>;

export const NotificationChannel = makeEnum(["EMAIL", "IN_APP"] as const);
export type NotificationChannel = z.infer<typeof NotificationChannel.schema>;

export const JobStatus = makeEnum(["RUNNING", "SUCCEEDED", "FAILED", "SKIPPED"] as const);
export type JobStatus = z.infer<typeof JobStatus.schema>;
