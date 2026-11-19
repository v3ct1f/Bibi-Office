import { describe, expect, it } from "vitest";
import { addDays, computeLine, computeTotals, divRound, formatMoney, minorDigits, numberFormat } from "../src/money.ts";

describe("money", () => {
  it("rounds half away from zero", () => {
    expect(divRound(5n, 10n)).toBe(1n);
    expect(divRound(4n, 10n)).toBe(0n);
    expect(divRound(-5n, 10n)).toBe(-1n);
    expect(divRound(-14n, 10n)).toBe(-1n);
    expect(divRound(15n, 10n)).toBe(2n);
  });
  it("computes lines with per-line rounding and no float drift", () => {
    // 3 x 0.10 at 19%: net 30, tax 5.7 -> 6
    expect(computeLine({ description: "x", quantity: 3, unitPrice: 10, taxRate: 19 })).toMatchObject({ net: 30, tax: 6, quantityMilli: 3000, taxRateBp: 1900 });
    // 1.333 h x 99.99 = 133.286... -> 13329 cents; 7.7% -> 1026.3 -> 1026
    expect(computeLine({ description: "x", quantity: 1.333, unitPrice: 9999, taxRate: 7.7 })).toMatchObject({ net: 13329, tax: 1026 });
    // discount line
    expect(computeLine({ description: "x", quantity: 1, unitPrice: -500, taxRate: 19 })).toMatchObject({ net: -500, tax: -95 });
    const t = computeTotals([{ net: 30, tax: 6 }, { net: 13329, tax: 1026 }]);
    expect(t).toEqual({ subtotal: 13359, taxTotal: 1032, total: 14391 });
  });
  it("knows currency minor units and formats", () => {
    expect(minorDigits("EUR")).toBe(2);
    expect(minorDigits("JPY")).toBe(0);
    expect(formatMoney(123456, "EUR")).toBe("€1,234.56");
    expect(formatMoney(1500, "JPY")).toBe("¥1,500");
  });
  it("expands number formats into a scope and padded counter", () => {
    const f = numberFormat("INV-{YYYY}-{seq:5}", new Date("2026-03-04T00:00:00Z"));
    expect(f.scope).toBe("INV-2026-{seq}");
    expect(f.render(42)).toBe("INV-2026-00042");
    expect(numberFormat("{YY}{MM}-{seq}", new Date("2026-11-01T00:00:00Z")).render(7)).toBe("2611-7");
    expect(() => numberFormat("INV-{YYYY}", new Date())).toThrow();
  });
  it("adds calendar days across month ends", () => {
    expect(addDays("2026-01-31", 30)).toBe("2026-03-02");
  });
});
