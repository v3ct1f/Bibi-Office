import { describe, expect, it } from "vitest";
import { workingDaysByYear } from "../src/service.ts";

describe("working days", () => {
  it("counts Monday to Friday only", () => {
    // 2026-03-02 is a Monday.
    expect([...workingDaysByYear("2026-03-02", "2026-03-08")]).toEqual([[2026, 5]]);
    expect([...workingDaysByYear("2026-03-07", "2026-03-08")]).toEqual([]); // a weekend
    expect([...workingDaysByYear("2026-03-04", "2026-03-04")]).toEqual([[2026, 1]]);
  });
  it("splits time off across the new year", () => {
    // Tue 2026-12-29 .. Fri 2027-01-01: 3 days in 2026, 1 in 2027.
    expect([...workingDaysByYear("2026-12-29", "2027-01-01")]).toEqual([[2026, 3], [2027, 1]]);
  });
});
