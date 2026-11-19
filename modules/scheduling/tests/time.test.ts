import { describe, expect, it } from "vitest";
import { addDays, isDate, isTime, nowIn, overlaps, paidMinutes, shiftInterval, spanMinutes, validTimeZone, weekStart } from "../src/time.ts";

describe("time helpers", () => {
  it("finds the Monday of a week and adds days across months", () => {
    expect(weekStart("2026-11-19")).toBe("2026-11-16"); // Thursday -> Monday
    expect(weekStart("2026-11-16")).toBe("2026-11-16");
    expect(weekStart("2026-11-22")).toBe("2026-11-16"); // Sunday belongs to the week before
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
  });

  it("measures shifts, including ones past midnight", () => {
    expect(spanMinutes("09:00", "17:00")).toBe(480);
    expect(spanMinutes("20:00", "02:00")).toBe(360);
    expect(paidMinutes("09:00", "17:30", 30)).toBe(480);
  });

  it("detects overlaps on the same and neighbouring days", () => {
    const late = shiftInterval({ day: "2026-11-16", start: "20:00", end: "02:00" });
    expect(overlaps(late, shiftInterval({ day: "2026-11-17", start: "01:00", end: "09:00" }))).toBe(true);
    expect(overlaps(late, shiftInterval({ day: "2026-11-17", start: "02:00", end: "09:00" }))).toBe(false);
    expect(overlaps(shiftInterval({ day: "2026-11-16", start: "09:00", end: "13:00" }), shiftInterval({ day: "2026-11-16", start: "13:00", end: "17:00" }))).toBe(false);
  });

  it("validates input and time zones", () => {
    expect(isDate("2026-02-30")).toBe(false);
    expect(isDate("2026-02-28")).toBe(true);
    expect(isTime("24:00")).toBe(false);
    expect(isTime("07:05")).toBe(true);
    expect(validTimeZone("Europe/Madrid")).toBe("Europe/Madrid");
    expect(validTimeZone("Mars/Base")).toBe("UTC");
    expect(nowIn("Europe/Madrid", new Date("2026-07-01T22:30:00Z"))).toEqual({ date: "2026-07-02", time: "00:30" });
  });
});
