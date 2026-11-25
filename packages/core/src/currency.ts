/**
 * Currencies and exchange rates, with no database or framework in it, so the API and the web app share it
 * (the web app imports "@office/core/currency").
 *
 * Money in Office is always stored as whole minor units (cents) next to its currency code. Most currencies have 2
 * decimals, a few have none (JPY, KRW...) and a few have 3 (KWD, BHD...), so never assume "divide by 100":
 * use minorDigits(code). Rates are only used to SHOW approximate amounts in another currency; nothing stored is
 * ever converted.
 */

/** Currencies people can pick, with how many decimals their smallest unit has. */
export const CURRENCIES = {
  EUR: 2, USD: 2, GBP: 2, CHF: 2, SEK: 2, NOK: 2, DKK: 2, PLN: 2, CZK: 2, HUF: 2, RON: 2,
  CAD: 2, AUD: 2, NZD: 2, MXN: 2, BRL: 2, ARS: 2, COP: 2, CNY: 2, INR: 2, AED: 2, ZAR: 2, TRY: 2,
  JPY: 0, KRW: 0, CLP: 0,
  KWD: 3, BHD: 3,
} as const satisfies Record<string, 0 | 2 | 3>;
export type CurrencyCode = keyof typeof CURRENCIES;
export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];
/** The currency prices are set and billed in. */
export const BASE_CURRENCY = "EUR";

export const isCurrency = (c: unknown): c is CurrencyCode => typeof c === "string" && Object.hasOwn(CURRENCIES, c);
/** Decimals of the smallest unit: 2 for EUR, 0 for JPY, 3 for KWD. Unknown codes count as 2. */
export const minorDigits = (code: string): number => (isCurrency(code) ? CURRENCIES[code] : 2);

/** Units of each currency for 1 EUR. EUR itself is always 1. */
export type Rates = Readonly<Record<string, number>>;
export interface RatesSnapshot {
  base: typeof BASE_CURRENCY;
  rates: Rates;
  /** When the rates were last updated (ISO date). */
  asOf: string;
  /** Where they came from: "fixed" for the built-in table, otherwise the provider's name. */
  source: string;
}

/** Something that can say what the rates are. Swap it for a real one (ECB, a paid API) without touching the rest. */
export interface RatesProvider {
  snapshot(): Promise<RatesSnapshot>;
}

/** Built-in rates (approximate, euro = 1). Used locally, in tests, and as the fallback; updated by hand in config. */
export const FIXED_RATES: Rates = {
  EUR: 1, USD: 1.08, GBP: 0.85, CHF: 0.96, SEK: 11.4, NOK: 11.6, DKK: 7.46, PLN: 4.3, CZK: 25.2, HUF: 395, RON: 4.97,
  CAD: 1.48, AUD: 1.65, NZD: 1.79, MXN: 18.5, BRL: 5.4, ARS: 1000, COP: 4300, CNY: 7.8, INR: 90, AED: 3.97, ZAR: 20, TRY: 36,
  JPY: 160, KRW: 1450, CLP: 1000, KWD: 0.33, BHD: 0.41,
};
export const FIXED_RATES_DATE = "2026-11-01";

/** The simple provider: a fixed table. No network. Pass your own table (e.g. from config) to override. */
export class FixedRatesProvider implements RatesProvider {
  constructor(private readonly table: Rates = FIXED_RATES, private readonly asOf = FIXED_RATES_DATE, private readonly source = "fixed") {}
  async snapshot(): Promise<RatesSnapshot> {
    return { base: BASE_CURRENCY, rates: cleanRates(this.table), asOf: this.asOf, source: this.source };
  }
}

/** Keeps only known currencies with a sensible positive rate; EUR is always 1. */
export function cleanRates(table: Record<string, unknown>): Rates {
  const out: Record<string, number> = { EUR: 1 };
  for (const c of CURRENCY_CODES) {
    const v = table[c];
    if (c !== "EUR" && typeof v === "number" && Number.isFinite(v) && v > 0) out[c] = v;
  }
  return out;
}

/** Parses a rates table written as JSON, e.g. from an environment variable: {"USD":1.09,"GBP":0.86}. Bad input gives null. */
export function parseRatesJson(text: string | undefined): Rates | null {
  if (!text) return null;
  try {
    const v: unknown = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const r = cleanRates(v as Record<string, unknown>);
    return Object.keys(r).length > 1 ? r : null;
  } catch { return null; }
}

/**
 * Converts an amount in whole minor units from one currency to another, rounding to the target's smallest unit.
 * Handles different decimals (EUR cents -> JPY whole yen, EUR cents -> KWD fils). Returns null when a rate is missing.
 */
export function convertMinor(minor: number, from: string, to: string, rates: Rates): number | null {
  if (from === to) return minor;
  const rf = rates[from], rt = rates[to];
  if (!rf || !rt) return null;
  const major = minor / 10 ** minorDigits(from);
  return Math.round((major / rf) * rt * 10 ** minorDigits(to));
}

/** Major units (what people type, e.g. 29.5) to minor units (2950; JPY 1200 -> 1200). */
export const toMinor = (major: number, code: string): number => Math.round(major * 10 ** minorDigits(code));
export const fromMinor = (minor: number, code: string): number => minor / 10 ** minorDigits(code);
