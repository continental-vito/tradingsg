import { describe, expect, it } from "vitest";
import { money, ratio } from "./serialize";

describe("money", () => {
  // The bug this guards: the dashboard took its sign from a separately
  // computed ratio and its magnitude from the gain. A four-cent loss, whose
  // ratio rounds to 0.00%, rendered as "+0,04 €" — a gain and a loss at once.
  it("carries a direction taken from the amount itself", () => {
    expect(money(-4n).direction).toBe(-1);
    expect(money(4n).direction).toBe(1);
    expect(money(0n).direction).toBe(0);
  });

  it("disagrees with a ratio that rounds to zero, and is the one to trust", () => {
    const lossCents = -4n;
    const lossPpm = ratio(0); // −4 cents of €100,000 rounds to 0.00%
    expect(lossPpm.direction).toBe(0);
    expect(money(lossCents).direction).toBe(-1);
  });

  it("keeps the exact value as a string, never a float", () => {
    // Above 2^53 a Number would silently lose precision; the string does not.
    const huge = 9_007_199_254_740_993n;
    expect(money(huge).cents).toBe("9007199254740993");
  });

  it("formats the sign into the text as well", () => {
    expect(money(-12_345n).text).toContain("-");
    expect(money(12_345n).text).not.toContain("-");
  });
});
