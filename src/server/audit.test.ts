import { describe, expect, it } from "vitest";
import { auditJson } from "./audit";

describe("auditJson", () => {
  // The bug this guards: an admin saved the competition rules, the change was
  // committed, and then the audit write threw on a BigInt — so they saw an
  // error for an action that had succeeded, and the record proving what
  // happened was the one thing that did not get written.
  it("serialises a row containing BigInt money", () => {
    const row = {
      id: "s1",
      minPositionCents: 5_000n,
      feeMaxCents: null,
      maxPositionPpm: 300_000,
      allowCash: true,
    };
    expect(() => JSON.stringify(row)).toThrow(TypeError);
    expect(auditJson(row)).toBe(
      '{"id":"s1","minPositionCents":"5000","feeMaxCents":null,"maxPositionPpm":300000,"allowCash":true}',
    );
  });

  it("keeps a BigInt exact rather than rounding it into a Number", () => {
    // Above 2^53 a Number would lose the last digit, and this is money.
    expect(auditJson({ v: 9_007_199_254_740_993n })).toBe('{"v":"9007199254740993"}');
  });

  it("writes dates as ISO strings", () => {
    expect(auditJson({ at: new Date("2026-09-18T12:00:00.000Z") })).toBe(
      '{"at":"2026-09-18T12:00:00.000Z"}',
    );
  });

  it("returns null for nothing, so the column stays null rather than the string 'null'", () => {
    expect(auditJson(undefined)).toBeNull();
    expect(auditJson(null)).toBeNull();
  });

  it("handles nesting and arrays", () => {
    expect(auditJson({ files: [{ bytes: 10n }, { bytes: 20n }] })).toBe(
      '{"files":[{"bytes":"10"},{"bytes":"20"}]}',
    );
  });
});
