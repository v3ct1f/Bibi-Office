import { describe, expect, it } from "vitest";
import { metricRange, startOfDay } from "@office/sdk";
import { compareRange, elapsed, periodOf, series, shift } from "../src/periods.ts";
import { formatValue, targetStatus } from "../src/service.ts";

describe("periods", () => {
  it("finds the week, month, quarter and year around a date", () => {
    expect(periodOf("week", "2026-11-22")).toMatchObject({ from: "2026-11-16", to: "2026-11-23", label: "Week of 16 Nov 2026" }); // a Sunday
    expect(periodOf("week", "2026-11-16").from).toBe("2026-11-16");
    expect(periodOf("month", "2026-02-15")).toMatchObject({ from: "2026-02-01", to: "2026-03-01", label: "February 2026", short: "Feb" });
    expect(periodOf("month", "2026-01-31").short).toBe("Jan 26");
    expect(periodOf("quarter", "2026-11-20")).toMatchObject({ from: "2026-10-01", to: "2027-01-01", label: "Q4 2026" });
    expect(periodOf("year", "2026-11-20")).toMatchObject({ from: "2026-01-01", to: "2027-01-01", label: "2026" });
  });

  it("steps back and forward, and builds a trend", () => {
    const nov = periodOf("month", "2026-11-20");
    expect(shift(nov, -1).from).toBe("2026-10-01");
    expect(shift(nov, 2).from).toBe("2027-01-01");
    expect(shift(periodOf("month", "2026-03-31"), -1).from).toBe("2026-02-01"); // no day overflow
    expect(series(nov, 3).map((p) => p.from)).toEqual(["2026-09-01", "2026-10-01", "2026-11-01"]);
    expect(shift(periodOf("week", "2026-01-01"), -1).from).toBe("2025-12-22");
  });

  it("compares a running period with the same number of days before", () => {
    const nov = periodOf("month", "2026-11-20");
    expect(elapsed(nov, "2026-11-20")).toEqual({ days: 20, total: 30, fraction: 20 / 30, current: true });
    expect(compareRange(nov, "previous", "2026-11-20", "total")).toEqual({ from: "2026-10-01", to: "2026-10-21", label: "1 Oct–20 Oct" });
    expect(compareRange(nov, "last_year", "2026-11-20", "total")).toEqual({ from: "2025-11-01", to: "2025-11-21", label: "1 Nov–20 Nov" });
    expect(compareRange(nov, "previous", "2026-12-05", "total")).toEqual({ from: "2026-10-01", to: "2026-11-01", label: "October 2026" });
    expect(compareRange(nov, "none", "2026-11-20", "total")).toBeNull();
    // 31 days into a 28-day month: capped at the month's end
    expect(compareRange(periodOf("month", "2026-03-31"), "previous", "2026-03-31", "total")!.to).toBe("2026-03-01");
    // A week a year earlier starts on the same weekday
    expect(compareRange(periodOf("week", "2026-11-18"), "last_year", "2026-12-01", "total")!.from).toBe("2025-11-17");
  });

  it("turns dates into instants in the company's time zone", () => {
    expect(startOfDay("2026-11-01", "Europe/Madrid").toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(startOfDay("2026-07-01", "Europe/Madrid").toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(startOfDay("2026-03-29", "Europe/Madrid").toISOString()).toBe("2026-03-28T23:00:00.000Z"); // clocks change that night
    expect(startOfDay("2026-11-01", "America/New_York").toISOString()).toBe("2026-11-01T04:00:00.000Z");
    const r = metricRange("2026-11-01", "2026-12-01", "UTC", new Date("2026-11-20T10:00:00Z"));
    expect(r).toEqual({ from: "2026-11-01", to: "2026-12-01", start: "2026-11-01T00:00:00.000Z", end: "2026-12-01T00:00:00.000Z", timeZone: "UTC", current: true });
  });
});

describe("targets and formatting", () => {
  const up = { kind: "total", better: "up" } as const, down = { kind: "total", better: "down" } as const;
  it("says whether a target is met, on track, behind or missed", () => {
    expect(targetStatus(up, 1200, 1000, 1, true)).toBe("met");
    expect(targetStatus(up, 900, 1000, 1, true)).toBe("missed");
    expect(targetStatus(up, 600, 1000, 0.5, false)).toBe("on_track");
    expect(targetStatus(up, 400, 1000, 0.5, false)).toBe("behind");
    expect(targetStatus(down, 400, 1000, 0.5, false)).toBe("on_track"); // a budget, spent slower than planned
    expect(targetStatus(down, 600, 1000, 0.5, false)).toBe("behind");
    expect(targetStatus(down, 1100, 1000, 0.5, false)).toBe("missed");
    expect(targetStatus({ kind: "snapshot", better: "down" }, 5, 3, 0.5, false)).toBe("behind");
  });

  it("formats numbers by unit", () => {
    expect(formatValue(12345.6, "money", "EUR")).toBe("€12,346");
    expect(formatValue(99.5, "money", "USD")).toBe("$99.50");
    expect(formatValue(66.666, "percent")).toBe("66.7%");
    expect(formatValue(150, "minutes")).toBe("2.5 h");
    expect(formatValue(45, "minutes")).toBe("45 min");
    expect(formatValue(1, "days")).toBe("1 day");
    expect(formatValue(1234, "count")).toBe("1,234");
    expect(formatValue(null, "count")).toBe("—");
  });
});
