/**
 * CSV writing.
 *
 * Every field is quoted and every embedded quote doubled, unconditionally. A
 * participant called O'Brien, a department with a comma in it, or a note
 * containing a newline must not shift the columns of a file whose whole purpose
 * is to reconstruct the competition after something has gone wrong.
 *
 * Rows are written CRLF because that is what RFC 4180 says and what Excel
 * expects, and the file opens with a UTF-8 byte-order mark for the same
 * reason — without it Excel renders "Novo Nordisk" and "L'Oréal" as mojibake.
 */

export const BOM = "﻿";

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  // BigInt and Date are the two types that would otherwise stringify into
  // something a spreadsheet cannot read back.
  const text =
    typeof value === "bigint"
      ? value.toString()
      : value instanceof Date
        ? value.toISOString()
        : typeof value === "boolean"
          ? value
            ? "true"
            : "false"
          : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function csvRow(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(",");
}

export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return BOM + [csvRow(headers), ...rows.map(csvRow)].join("\r\n") + "\r\n";
}
