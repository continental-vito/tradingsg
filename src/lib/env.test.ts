import { describe, expect, it } from "vitest";
import { normalizeAppUrl } from "./env";

/**
 * APP_URL was `z.string().url()`, which rejected a bare hostname — and Vercel's
 * dashboard shows the domain without a scheme, so pasting what you see there
 * failed the entire production build with `APP_URL: Invalid URL`, a message
 * that names neither the cause nor the fix.
 */
describe("APP_URL normalisation", () => {
  it("completes a bare hostname, which is what Vercel's dashboard shows", () => {
    expect(normalizeAppUrl("tradingsg.vercel.app")).toBe("https://tradingsg.vercel.app");
  });

  it("leaves an explicit scheme alone, http included so localhost still works", () => {
    expect(normalizeAppUrl("https://tradingsg.vercel.app")).toBe("https://tradingsg.vercel.app");
    expect(normalizeAppUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("drops trailing slashes, which would otherwise double up in every email link", () => {
    // `${APP_URL}/reset-password/${token}` — a trailing slash gives `…app//reset-password`,
    // which works but reads as broken in someone's inbox.
    expect(normalizeAppUrl("https://tradingsg.vercel.app/")).toBe("https://tradingsg.vercel.app");
    expect(normalizeAppUrl("https://tradingsg.vercel.app///")).toBe("https://tradingsg.vercel.app");
  });

  it("tolerates whitespace from a copy-paste", () => {
    expect(normalizeAppUrl("  tradingsg.vercel.app  ")).toBe("https://tradingsg.vercel.app");
  });
});
