// Pure money math. All amounts are integer minor units; never floats.

export interface LineInput { description: string; quantity: number; unitPrice: number; taxRate: number }
export interface Line extends LineInput { quantityMilli: number; taxRateBp: number; net: number; tax: number }
export interface Totals { subtotal: number; taxTotal: number; total: number }

/** Round half away from zero for n / d with integers (d > 0). */
export function divRound(n: bigint, d: bigint): bigint {
  const q = n / d, r = n % d;
  if (r === 0n) return q;
  const twice = (r < 0n ? -r : r) * 2n;
  return twice >= d ? q + (n < 0n ? -1n : 1n) : q;
}

/** 1.5 -> 1500 (thousandths). Input validated to ≤3 decimals by the API schema. */
export const toMilli = (q: number) => Math.round(q * 1000);
/** 19 (%) or 7.7 (%) -> basis points 1900 / 770. */
export const toBp = (pct: number) => Math.round(pct * 100);

export function computeLine(l: LineInput): Line {
  const quantityMilli = toMilli(l.quantity), taxRateBp = toBp(l.taxRate);
  const net = divRound(BigInt(quantityMilli) * BigInt(l.unitPrice), 1000n);
  const tax = divRound(net * BigInt(taxRateBp), 10000n);
  return { ...l, quantityMilli, taxRateBp, net: Number(net), tax: Number(tax) };
}

/** Per-line rounding, then sums (common EU practice; documented in README). */
export function computeTotals(lines: Pick<Line, "net" | "tax">[]): Totals {
  const subtotal = lines.reduce((a, l) => a + l.net, 0);
  const taxTotal = lines.reduce((a, l) => a + l.tax, 0);
  return { subtotal, taxTotal, total: subtotal + taxTotal };
}

/** Number of minor-unit digits for an ISO 4217 currency (EUR 2, JPY 0, KWD 3). */
export function minorDigits(currency: string): number {
  try { return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2; }
  catch { return 2; }
}

export function formatMoney(minor: number, currency: string, locale = "en"): string {
  const d = minorDigits(currency);
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: d, maximumFractionDigits: d })
    .format(minor / 10 ** d);
}

/** Expand "INV-{YYYY}-{seq:5}" into the sequence scope ("INV-2026-") and a renderer for the counter. */
export function numberFormat(format: string, date: Date): { scope: string; render(seq: number): string } {
  const yyyy = String(date.getUTCFullYear()), yy = yyyy.slice(2), mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const expanded = format.replaceAll("{YYYY}", yyyy).replaceAll("{YY}", yy).replaceAll("{MM}", mm);
  const m = /\{seq(?::(\d))?\}/.exec(expanded);
  if (!m) throw new Error("numberFormat must contain {seq} or {seq:N}");
  const pad = Number(m[1] ?? 1);
  return {
    scope: expanded.replace(m[0], "{seq}"),
    render: (seq) => expanded.replace(m[0], String(seq).padStart(pad, "0")),
  };
}

/** YYYY-MM-DD + days (UTC calendar math). */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export const todayUtc = () => new Date().toISOString().slice(0, 10);
