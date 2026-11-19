import { describe, expect, it } from "vitest";
import {
  addDays, divRound, formatNumber, invoiceTotals, lineTotals, numberPeriod, toCents, toScaled, validateNumberFormat,
} from "../src/money.ts";

describe("money", () => {
  it("rounds half away from zero", () => {
    expect(divRound(5n, 10n)).toBe(1n);
    expect(divRound(4n, 10n)).toBe(0n);
    expect(divRound(-5n, 10n)).toBe(-1n);
    expect(divRound(15n, 10n)).toBe(2n);
  });

  it("scales decimals exactly and rejects extra precision", () => {
    expect(toScaled(1.005, 3)).toBe(1005n);
    expect(toScaled(0.1 + 0.2, 2)).toBe(30n);
    expect(toScaled(-2.5, 2)).toBe(-250n);
    expect(() => toScaled(1.0001, 3)).toThrow(/decimals/);
    expect(() => toScaled(Number.NaN, 2)).toThrow();
    expect(toCents(19.99)).toBe(1999);
  });

  it("prices lines per line with tax rounding", () => {
    expect(lineTotals({ quantity: 3, unitPriceCents: 1999, taxRate: 21 })).toEqual({ netCents: 5997, taxCents: 1259 }); // 1259.37
    expect(lineTotals({ quantity: 0.333, unitPriceCents: 1000, taxRate: 0 })).toEqual({ netCents: 333, taxCents: 0 });
    expect(lineTotals({ quantity: 1.5, unitPriceCents: 333, taxRate: 7.5 })).toEqual({ netCents: 500, taxCents: 38 }); // 499.5 -> 500; 37.5 -> 38
    expect(lineTotals({ quantity: 1, unitPriceCents: -500, taxRate: 20 })).toEqual({ netCents: -500, taxCents: -100 });
  });

  it("sums totals and refuses absurd amounts", () => {
    expect(invoiceTotals([{ netCents: 1000, taxCents: 210 }, { netCents: -100, taxCents: -21 }]))
      .toEqual({ subtotalCents: 900, taxCents: 189, totalCents: 1089 });
    expect(() => lineTotals({ quantity: 1_000_000, unitPriceCents: 1e12, taxRate: 0 })).toThrow(/too large/);
  });
});

describe("invoice numbers", () => {
  const d = new Date("2026-03-07T12:00:00Z");
  it("formats tokens", () => {
    expect(formatNumber("INV-{YYYY}-{seq:5}", d, 42)).toBe("INV-2026-00042");
    expect(formatNumber("{YY}{MM}/{seq}", d, 7)).toBe("2603/7");
    expect(formatNumber("A{seq:3}", d, 12345)).toBe("A12345");
  });
  it("picks the counter period", () => {
    expect(numberPeriod("INV-{YYYY}-{seq:5}", d)).toBe("2026");
    expect(numberPeriod("{YY}{MM}-{seq}", d)).toBe("2026-03");
    expect(numberPeriod("INV-{seq:6}", d)).toBe("");
  });
  it("validates formats", () => {
    expect(validateNumberFormat("INV-{YYYY}-{seq:5}")).toBeNull();
    expect(validateNumberFormat("INV-{YYYY}")).toMatch(/exactly one/);
    expect(validateNumberFormat("{seq}{seq}")).toMatch(/exactly one/);
    expect(validateNumberFormat("{seq:0}")).toMatch(/width/);
    expect(validateNumberFormat("{DD}-{seq}")).toMatch(/Unknown token/);
    expect(validateNumberFormat("<b>{seq}")).toMatch(/may only contain/);
  });
  it("adds calendar days in UTC", () => {
    expect(addDays("2026-01-31", 30)).toBe("2026-03-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
