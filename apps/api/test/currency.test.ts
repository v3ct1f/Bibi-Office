import { afterAll, beforeAll, describe, expect, it } from "vitest";
import invoicing from "@office/module-invoicing";
import {
  FixedRatesProvider, convertMinor, fromMinor, minorDigits, parseRatesJson, toMinor, type RatesProvider,
} from "@office/core";
import { setup } from "./harness.ts";

/**
 * Language and currency: the money maths (whole minor units, 0 / 2 / 3 decimal currencies), the public rates list
 * (a fixed table, swappable, no network), a person's own choices, and a business's display currency, which never
 * touches invoices that already exist.
 */
const RATES = { EUR: 1, USD: 1.1, JPY: 150, KWD: 0.33, GBP: 0.8 };
let calls = 0;
const provider: RatesProvider = {
  async snapshot() { calls++; return { base: "EUR", rates: RATES, asOf: "2026-01-02", source: "test" }; },
};

describe("money maths", () => {
  it("knows how many decimals each currency has", () => {
    expect([minorDigits("EUR"), minorDigits("JPY"), minorDigits("KWD"), minorDigits("XXX")]).toEqual([2, 0, 3, 2]);
    expect(toMinor(12.34, "EUR")).toBe(1234);
    expect(toMinor(1200, "JPY")).toBe(1200);
    expect(toMinor(1.234, "KWD")).toBe(1234);
    expect(fromMinor(1234, "KWD")).toBe(1.234);
    expect(toMinor(0.1 + 0.2, "EUR")).toBe(30);   // no floating point drift
  });

  it("converts whole minor units between currencies with different decimals", () => {
    // €10.00 = 1000 cents -> 1500 yen (no decimals), 3.3 KWD = 3300 fils, 11 USD = 1100 cents
    expect(convertMinor(1000, "EUR", "JPY", RATES)).toBe(1500);
    expect(convertMinor(1000, "EUR", "KWD", RATES)).toBe(3300);
    expect(convertMinor(1000, "EUR", "USD", RATES)).toBe(1100);
    // and back: 1500 yen -> €10.00; 3300 fils -> €10.00
    expect(convertMinor(1500, "JPY", "EUR", RATES)).toBe(1000);
    expect(convertMinor(3300, "KWD", "EUR", RATES)).toBe(1000);
    // between two non-euro currencies, and rounding to the smallest unit
    expect(convertMinor(1100, "USD", "GBP", RATES)).toBe(800);
    expect(convertMinor(1, "EUR", "JPY", RATES)).toBe(2);     // 1 cent = 1.5 yen, rounds to 2
    expect(convertMinor(500, "EUR", "EUR", RATES)).toBe(500);
    expect(Number.isInteger(convertMinor(999, "EUR", "KWD", RATES)!)).toBe(true);
  });

  it("says so when a rate is missing instead of guessing", () => {
    expect(convertMinor(1000, "EUR", "CHF", RATES)).toBeNull();
    expect(convertMinor(1000, "XXX", "EUR", RATES)).toBeNull();
  });

  it("reads a rates table from config and ignores junk", () => {
    expect(parseRatesJson(undefined)).toBeNull();
    expect(parseRatesJson("not json")).toBeNull();
    expect(parseRatesJson("[1,2]")).toBeNull();
    expect(parseRatesJson("{\"USD\":1.2,\"EUR\":5,\"ZZZ\":3,\"GBP\":-1,\"JPY\":\"x\"}")).toEqual({ EUR: 1, USD: 1.2 });
  });
});

describe("rates, preferences and display currency (API)", () => {
  let h: Awaited<ReturnType<typeof setup>>;
  let boss: string, maria: string, nina: string, tenantId: string;
  const M = () => h.client(maria, tenantId);

  beforeAll(async () => {
    h = await setup([invoicing], { rates: provider });
    [boss, maria, nina] = await Promise.all([h.token("boss"), h.token("maria"), h.token("nina")]);
    tenantId = (await h.client(maria).post("/tenants", { slug: "acme", name: "Acme" })).body.id;
    await h.client(nina).get("/me");
    await h.join(tenantId, maria, nina, ["member"]);
  });
  afterAll(async () => { await h.teardown(); });

  it("lists exchange rates to anyone, from the swappable provider", async () => {
    const r = await h.client().get("/rates");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ base: "EUR", asOf: "2026-01-02", source: "test", rates: RATES });
    expect(r.body.currencies).toEqual(expect.arrayContaining(["EUR", "USD", "JPY", "KWD"]));
    expect(calls).toBeGreaterThan(0);
  });

  it("uses the built-in fixed table when no provider is given", async () => {
    const snap = await new FixedRatesProvider().snapshot();
    expect(snap).toMatchObject({ base: "EUR", source: "fixed" });
    expect(snap.rates.EUR).toBe(1);
    expect(snap.rates.USD).toBeGreaterThan(0);
  });

  it("keeps a person's own language and currency", async () => {
    expect((await h.client(maria).get("/me")).body).toMatchObject({ locale: null, currency: null });
    const r = await h.client(maria).patch("/me/preferences", { locale: "es", currency: "USD" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ locale: "es", currency: "USD" });
    expect((await h.client(maria).get("/me")).body).toMatchObject({ locale: "es", currency: "USD" });
    // one at a time, and only for themselves
    await h.client(maria).patch("/me/preferences", { currency: "JPY" });
    expect((await h.client(maria).get("/me")).body).toMatchObject({ locale: "es", currency: "JPY" });
    expect((await h.client(nina).get("/me")).body).toMatchObject({ locale: null, currency: null });
    // reset
    expect((await h.client(maria).patch("/me/preferences", { locale: null, currency: null })).body).toEqual({ locale: null, currency: null });
  });

  it("refuses unknown currencies, bad language codes, strangers and extra fields", async () => {
    expect((await h.client(maria).patch("/me/preferences", { currency: "ZZZ" })).status).toBe(400);
    expect((await h.client(maria).patch("/me/preferences", { currency: "usd" })).status).toBe(400);
    expect((await h.client(maria).patch("/me/preferences", { locale: "English please" })).status).toBe(400);
    expect((await h.client(maria).patch("/me/preferences", { theme: "dark" })).status).toBe(400);
    expect((await h.client().patch("/me/preferences", { locale: "nl" })).status).toBe(401);
  });

  it("a business's display currency starts as EUR and the owner can change it", async () => {
    expect((await M().get("/me/access")).body.tenant.displayCurrency).toBe("EUR");
    expect((await M().patch("/tenant/display-currency", { currency: "GBP" })).status).toBe(200);
    expect((await M().get("/me/access")).body.tenant.displayCurrency).toBe("GBP");
    expect((await M().patch("/tenant/display-currency", { currency: "ZZZ" })).status).toBe(400);
    expect((await M().get("/me/access")).body.tenant.displayCurrency).toBe("GBP");
    // it is in the audit log
    const audit = (await M().get("/audit")).body.data as { action: string }[];
    expect(audit.some((a) => a.action === "tenant.display_currency_changed")).toBe(true);
    // null goes back to EUR
    expect((await M().patch("/tenant/display-currency", { currency: null })).status).toBe(200);
    expect((await M().get("/me/access")).body.tenant.displayCurrency).toBe("EUR");
  });

  it("only people allowed to manage the business can change it", async () => {
    const N = h.client(nina, tenantId);
    expect((await N.patch("/tenant/display-currency", { currency: "USD" })).status).toBe(403);
    expect((await h.client(boss).patch("/tenant/display-currency", { currency: "USD" })).status).toBeGreaterThanOrEqual(400);
    expect((await M().get("/me/access")).body.tenant.displayCurrency).toBe("EUR");
  });

  it("never changes invoices that already exist (or their amounts)", async () => {
    expect((await M().post("/modules/invoicing/enable", {})).status).toBe(200);
    const company = (await M().post("/companies", { name: "Initech" })).body;
    const inv = await M().post("/m/invoicing/invoices", { companyId: company.id, currency: "USD", lines: [{ description: "Work", quantity: 2, unitPriceCents: 12345, taxRate: 0 }] });
    expect(inv.status).toBe(201);
    expect(inv.body.currency).toBe("USD");
    const before = (await M().get(`/m/invoicing/invoices/${inv.body.id}`)).body;

    await M().patch("/tenant/display-currency", { currency: "JPY" });
    // the "also use it for new invoices" step is the invoicing module's own setting
    expect((await M().patch("/modules/invoicing/settings", { currency: "JPY" })).status).toBe(200);

    const after = (await M().get(`/m/invoicing/invoices/${inv.body.id}`)).body;
    expect(after.currency).toBe("USD");
    expect(after.totalCents).toBe(before.totalCents);
    expect(after.totalCents).toBe(24690);
    // a new invoice starts in the new default, whole yen
    const fresh = await M().post("/m/invoicing/invoices", { companyId: company.id, lines: [{ description: "Work", quantity: 1, unitPriceCents: 5000, taxRate: 0 }] });
    expect(fresh.body.currency).toBe("JPY");
  });
});
