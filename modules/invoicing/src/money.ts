/**
 * Pure money + numbering helpers (no I/O). Money is integer minor units (cents); quantities carry
 * up to 3 decimals and tax rates up to 2. Rounding is half away from zero, per line, using BigInt so
 * large values never lose precision.
 */
export interface LineInput { description: string; quantity: number; unitPriceCents: number; taxRate: number }
export interface LineTotals { netCents: number; taxCents: number }
export interface Totals { subtotalCents: number; taxCents: number; totalCents: number }

export const MAX_CENTS = 10n ** 14n; // 1 trillion in major units: far beyond any invoice, well under 2^53

/** Scale a decimal number to an integer with `places` decimals, rejecting extra precision. */
export function toScaled(n: number, places: number): bigint {
  if (!Number.isFinite(n)) throw new Error("not a finite number");
  const s = n.toFixed(places + 2);
  const [int, frac = ""] = s.replace("-", "").split(".");
  if (/[1-9]/.test(frac.slice(places))) throw new Error(`more than ${places} decimals`);
  const v = BigInt(int! + frac.slice(0, places).padEnd(places, "0"));
  return n < 0 ? -v : v;
}

/** a / b rounded half away from zero. */
export function divRound(a: bigint, b: bigint): bigint {
  const neg = (a < 0n) !== (b < 0n);
  const [x, y] = [a < 0n ? -a : a, b < 0n ? -b : b];
  const q = (x * 2n + y) / (y * 2n);
  return neg ? -q : q;
}

export function lineTotals(l: Pick<LineInput, "quantity" | "unitPriceCents" | "taxRate">): LineTotals {
  const q = toScaled(l.quantity, 3);           // quantity * 1000
  const r = toScaled(l.taxRate, 2);            // rate * 100 (percent)
  const net = divRound(q * BigInt(l.unitPriceCents), 1000n);
  const tax = divRound(net * r, 10000n);
  if (net > MAX_CENTS || net < -MAX_CENTS) throw new Error("line amount too large");
  return { netCents: Number(net), taxCents: Number(tax) };
}

export function invoiceTotals(lines: LineTotals[]): Totals {
  let sub = 0n, tax = 0n;
  for (const l of lines) { sub += BigInt(l.netCents); tax += BigInt(l.taxCents); }
  if (sub + tax > MAX_CENTS) throw new Error("invoice total too large");
  return { subtotalCents: Number(sub), taxCents: Number(tax), totalCents: Number(sub + tax) };
}

/** Major units (e.g. 12.5 EUR) -> cents. Rejects more than 2 decimals. */
export const toCents = (major: number) => Number(toScaled(major, 2));

// ── Invoice numbers ──────────────────────────────────────────────────────────
// Tokens: {YYYY} {YY} {MM} {seq} {seq:N} (N = zero-pad width 1-12). Exactly one {seq} is required.
const TOKEN = /\{(YYYY|YY|MM|seq(?::(\d{1,2}))?)\}/g;

export function validateNumberFormat(fmt: string): string | null {
  const seqs = [...fmt.matchAll(/\{seq(?::(\d{1,2}))?\}/g)];
  if (seqs.length !== 1) return "Number format must contain exactly one {seq} or {seq:N} token";
  const w = seqs[0]![1];
  if (w && (Number(w) < 1 || Number(w) > 12)) return "{seq:N} width must be between 1 and 12";
  const rest = fmt.replace(TOKEN, "");
  if (/[{}]/.test(rest)) return "Unknown token in number format (allowed: {YYYY} {YY} {MM} {seq:N})";
  if (!/^[A-Za-z0-9 ._\-/#]*$/.test(rest)) return "Number format may only contain letters, digits, spaces and . _ - / #";
  if (fmt.length > 40) return "Number format is too long";
  return null;
}

/** Counter period: numbering restarts each year (or month) when the format includes it. */
export function numberPeriod(fmt: string, date: Date): string {
  const y = String(date.getUTCFullYear());
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  if (fmt.includes("{MM}")) return `${y}-${m}`;
  if (fmt.includes("{YYYY}") || fmt.includes("{YY}")) return y;
  return "";
}

export function formatNumber(fmt: string, date: Date, seq: number): string {
  const y = String(date.getUTCFullYear());
  return fmt.replace(TOKEN, (_, tok: string, width?: string) => {
    if (tok === "YYYY") return y;
    if (tok === "YY") return y.slice(2);
    if (tok === "MM") return String(date.getUTCMonth() + 1).padStart(2, "0");
    return String(seq).padStart(width ? Number(width) : 1, "0");
  });
}

// ── Dates (UTC calendar days, "YYYY-MM-DD") ──────────────────────────────────
export const today = (now = new Date()) => now.toISOString().slice(0, 10);
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
