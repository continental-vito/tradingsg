import "server-only";
import { hash, verify } from "@node-rs/argon2";

/**
 * argon2id with OWASP's second recommended configuration (19 MiB, t=2, p=1).
 * Deliberately not bcrypt: bcrypt silently truncates at 72 bytes, so a long
 * passphrase is weaker than it looks.
 */
const OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

/**
 * Returns false rather than throwing on a malformed stored hash. A corrupt row
 * must read as "wrong password", not as a 500 that tells an attacker the
 * account exists.
 */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}

/**
 * Burn roughly the same time as a real verification when the account does not
 * exist, so response timing does not enumerate valid addresses.
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Iq5rZUOKcTGPZKlRcmVjdGx5bm90YXJlYWxoYXNo";

export async function burnPasswordTime(plain: string): Promise<void> {
  try {
    await verify(DUMMY_HASH, plain);
  } catch {
    // Expected — the point is the elapsed time, not the result.
  }
}
