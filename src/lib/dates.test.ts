import { describe, expect, it } from "vitest";
import {
  addDays,
  dateKeyOf,
  daysBetween,
  eachTradingDay,
  endOfWeek,
  isoWeekOf,
  isWeekend,
  periodKeyFor,
  startOfWeek,
} from "./dates";

describe("dateKeyOf", () => {
  // The bug this guards: a European market close at 22:00 local is the NEXT UTC
  // day in summer and the SAME one in winter, so `toISOString().slice(0,10)`
  // silently files half the year's closes under the wrong trade date.
  it("uses the competition timezone, not UTC", () => {
    const closeInSummer = new Date("2026-07-15T21:30:00Z"); // 23:30 in Berlin
    expect(dateKeyOf(closeInSummer, "UTC")).toBe("2026-07-15");
    expect(dateKeyOf(closeInSummer, "Europe/Berlin")).toBe("2026-07-15");

    const lateEvening = new Date("2026-07-15T22:30:00Z"); // 00:30 on the 16th in Berlin
    expect(dateKeyOf(lateEvening, "UTC")).toBe("2026-07-15");
    expect(dateKeyOf(lateEvening, "Europe/Berlin")).toBe("2026-07-16");
  });

  it("survives the spring DST transition", () => {
    // Europe/Berlin skips 02:00–03:00 on 29 March 2026.
    expect(dateKeyOf(new Date("2026-03-29T00:30:00Z"), "Europe/Berlin")).toBe("2026-03-29");
    expect(dateKeyOf(new Date("2026-03-29T23:30:00Z"), "Europe/Berlin")).toBe("2026-03-30");
  });
});

describe("date arithmetic", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("counts days across a DST change without dropping or adding one", () => {
    // Arithmetic is done in UTC precisely so a 23-hour local day is still one day.
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
  });

  it("identifies weekends", () => {
    expect(isWeekend("2026-09-05")).toBe(true); // Saturday
    expect(isWeekend("2026-09-06")).toBe(true); // Sunday
    expect(isWeekend("2026-09-07")).toBe(false); // Monday
  });

  it("lists trading days without weekends", () => {
    const days = eachTradingDay("2026-09-04", "2026-09-08");
    expect(days).toEqual(["2026-09-04", "2026-09-07", "2026-09-08"]);
  });
});

describe("week boundaries", () => {
  it("starts weeks on Monday by default", () => {
    expect(startOfWeek("2026-09-04")).toBe("2026-08-31"); // Friday -> that Monday
    expect(endOfWeek("2026-09-04")).toBe("2026-09-06");
  });

  it("honours a Sunday week start", () => {
    expect(startOfWeek("2026-09-04", 0)).toBe("2026-08-30");
  });

  // Getting this wrong makes January's first report overwrite December's last.
  it("assigns ISO weeks across the year boundary", () => {
    expect(isoWeekOf("2026-01-01")).toBe("2026-W01");
    expect(isoWeekOf("2027-01-01")).toBe("2026-W53");
    expect(isoWeekOf("2026-12-31")).toBe("2026-W53");
  });
});

describe("periodKeyFor", () => {
  // The value that goes into RebalanceRequest.periodKey, where a unique index
  // is what actually stops a concurrent double-submit trading twice in a week.
  it("gives every day of one week the same key", () => {
    const monday = periodKeyFor("2026-08-31", "WEEK");
    const friday = periodKeyFor("2026-09-04", "WEEK");
    expect(monday).toBe(friday);
  });

  it("gives adjacent weeks different keys", () => {
    expect(periodKeyFor("2026-09-04", "WEEK")).not.toBe(periodKeyFor("2026-09-07", "WEEK"));
  });

  it("buckets by day and by month", () => {
    expect(periodKeyFor("2026-09-04", "DAY")).toBe("2026-09-04");
    expect(periodKeyFor("2026-09-04", "MONTH")).toBe("2026-09");
  });
});
