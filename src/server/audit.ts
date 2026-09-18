/**
 * JSON for the audit trail.
 *
 * `JSON.stringify` throws on a BigInt, and every monetary column in this schema
 * is one — so passing a settings or portfolio row straight in threw AFTER the
 * change had already been committed. The administrator saw an error for an
 * action that had in fact succeeded, and the audit row, which is the thing that
 * proves what happened, was the one part that did not get written.
 *
 * BigInt becomes a decimal string and Date an ISO string, so the record stays
 * exact and readable rather than lossy. Kept out of the "use server" file so it
 * can be tested directly.
 */
export function auditJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value, (_key, v: unknown) =>
    typeof v === "bigint" ? v.toString() : v instanceof Date ? v.toISOString() : v,
  );
}
