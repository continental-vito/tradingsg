import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(stored, "correct horse battery staple")).toBe(true);
    expect(await verifyPassword(stored, "Correct horse battery staple")).toBe(false);
  });

  it("produces a different hash each time, so equal passwords are not equal rows", async () => {
    // A deterministic hash would let anyone with read access to the table see
    // which colleagues chose the same password.
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, "same-password")).toBe(true);
    expect(await verifyPassword(b, "same-password")).toBe(true);
  });

  it("does not truncate long passphrases", async () => {
    // bcrypt silently ignores everything past 72 bytes, which makes a long
    // passphrase weaker than it looks. argon2id is used precisely so this holds.
    const base = "x".repeat(72);
    const stored = await hashPassword(`${base}-alpha`);
    expect(await verifyPassword(stored, `${base}-alpha`)).toBe(true);
    expect(await verifyPassword(stored, `${base}-omega`)).toBe(false);
  });

  it("reads a corrupt stored hash as a wrong password, not as a crash", async () => {
    // A 500 here would tell an attacker the account exists.
    expect(await verifyPassword("not-a-hash", "anything")).toBe(false);
    expect(await verifyPassword("", "anything")).toBe(false);
  });
});
