import { describe, expect, it } from "vitest";
import { findDate, parseAmount, parseReceipt } from "../src/receipt.ts";

describe("parseAmount", () => {
  it("reads both decimal styles", () => {
    expect(parseAmount("12,50")).toBe(1250);
    expect(parseAmount("12.50")).toBe(1250);
    expect(parseAmount("1.234,56")).toBe(123456);
    expect(parseAmount("1,234.56")).toBe(123456);
    expect(parseAmount("€ 3,00")).toBe(300);
    expect(parseAmount("abc")).toBeNull();
  });
});

describe("findDate", () => {
  it("reads ISO, day-first, US when unambiguous, and month names", () => {
    expect(findDate("Fecha: 07/03/2026 13:45")).toBe("2026-03-07");
    expect(findDate("2026-11-02")).toBe("2026-11-02");
    expect(findDate("Date 11/25/2026")).toBe("2026-11-25");
    expect(findDate("12.01.26")).toBe("2026-01-12");
    expect(findDate("3 de marzo de 2026")).toBe("2026-03-03");
    expect(findDate("Invoice date: March 9, 2026")).toBe("2026-03-09");
    expect(findDate("31/02/2026")).toBeNull();
  });
});

describe("parseReceipt", () => {
  it("reads a Spanish bar ticket", () => {
    const text = `BAR LA ESQUINA S.L.
CIF B12345678
C/ Mayor 5, Madrid
FACTURA SIMPLIFICADA N: T-2026-0042
Fecha: 14/03/2026  Hora: 21:10
2 x CAÑA              5,00
1 TORTILLA ESPAÑOLA   8,50
AGUA MINERAL          2,00
BASE IMPONIBLE       14,09
IVA 10%               1,41
TOTAL                15,50 €
EFECTIVO             20,00
CAMBIO                4,50`;
    const r = parseReceipt(text);
    expect(r.vendor).toBe("BAR LA ESQUINA S.L.");
    expect(r.date).toBe("2026-03-14");
    expect(r.invoiceNumber).toBe("T-2026-0042");
    expect(r.currency).toBe("EUR");
    expect(r.totalCents).toBe(1550);
    expect(r.taxCents).toBe(141);
    expect(r.subtotalCents).toBe(1409);
    expect(r.lines).toEqual([
      { description: "CAÑA", quantity: 2, amountCents: 500 },
      { description: "TORTILLA ESPAÑOLA", quantity: 1, amountCents: 850 },
      { description: "AGUA MINERAL", quantity: 1, amountCents: 200 },
    ]);
  });

  it("reads an English supplier invoice", () => {
    const text = `Fresh Produce Ltd
Invoice # INV-88213
Invoice date: March 9, 2026
Tomatoes 10kg        24.00
Lettuce               9.50
Subtotal             33.50
VAT 20%               6.70
Amount due          $40.20`;
    const r = parseReceipt(text);
    expect(r.vendor).toBe("Fresh Produce Ltd");
    expect(r.invoiceNumber).toBe("INV-88213");
    expect(r.date).toBe("2026-03-09");
    expect(r.currency).toBe("USD");
    expect(r).toMatchObject({ subtotalCents: 3350, taxCents: 670, totalCents: 4020 });
    expect(r.lines.map((l) => l.description)).toEqual(["Tomatoes 10kg", "Lettuce"]);
  });

  it("derives what is missing and never invents a tax larger than the total", () => {
    const r = parseReceipt("Kiosk\nTOTAL 4,20");
    expect(r).toMatchObject({ totalCents: 420, taxCents: 0, subtotalCents: 420 });
    expect(parseReceipt("").totalCents).toBeNull();
  });
});
