/** Calendar periods for KPIs. Dates are "YYYY-MM-DD" strings; every range is [from, to). */
import type { Compare, PeriodKind } from "./schema.ts";

export interface Period { kind: PeriodKind; from: string; to: string; label: string; short: string }

const toDate = (d: string) => new Date(`${d}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => { const x = toDate(d); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
const addMonths = (d: string, n: number) => { const x = toDate(d); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + n); return iso(x); };
export const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
const months = (kind: PeriodKind) => (kind === "month" ? 1 : kind === "quarter" ? 3 : 12);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dayLabel = (d: string) => { const x = toDate(d); return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`; };

function label(kind: PeriodKind, from: string): { label: string; short: string } {
  const x = toDate(from), y = x.getUTCFullYear(), m = x.getUTCMonth();
  if (kind === "week") return { label: `Week of ${dayLabel(from)} ${y}`, short: dayLabel(from) };
  if (kind === "month") return { label: `${MONTHS_LONG[m]} ${y}`, short: `${MONTHS[m]}${m === 0 ? ` ${String(y).slice(2)}` : ""}` };
  if (kind === "quarter") return { label: `Q${m / 3 + 1} ${y}`, short: `Q${m / 3 + 1} ${String(y).slice(2)}` };
  return { label: String(y), short: String(y) };
}

/** The period of `kind` that contains `date` (weeks start on Monday). */
export function periodOf(kind: PeriodKind, date: string): Period {
  let from: string;
  if (kind === "week") from = addDays(date, -((toDate(date).getUTCDay() + 6) % 7));
  else {
    const x = toDate(date), m = x.getUTCMonth();
    from = iso(new Date(Date.UTC(x.getUTCFullYear(), kind === "month" ? m : kind === "quarter" ? m - (m % 3) : 0, 1)));
  }
  const to = kind === "week" ? addDays(from, 7) : addMonths(from, months(kind));
  return { kind, from, to, ...label(kind, from) };
}

/** The period `n` steps from `p` (n = -1: the one before). */
export const shift = (p: Period, n: number): Period =>
  periodOf(p.kind, p.kind === "week" ? addDays(p.from, 7 * n) : addMonths(p.from, months(p.kind) * n));

/** The last `count` periods, oldest first, ending with `p`. */
export const series = (p: Period, count: number): Period[] => Array.from({ length: count }, (_, i) => shift(p, i - count + 1));
export const SERIES_LENGTH: Record<PeriodKind, number> = { week: 8, month: 12, quarter: 8, year: 5 };

/** How far `today` is into `p`: days counted (today included) and days in total. */
export function elapsed(p: Period, today: string) {
  const total = daysBetween(p.from, p.to);
  if (today < p.from) return { days: 0, total, fraction: 0, current: false };
  if (today >= p.to) return { days: total, total, fraction: 1, current: false };
  const days = daysBetween(p.from, today) + 1;
  return { days, total, fraction: days / total, current: true };
}

/**
 * The period to compare with. For a running period of a "total" metric, only the same number of days of the
 * other period count, so "1–20 November" is compared with "1–20 October", not all of October.
 */
export function compareRange(p: Period, compare: Compare, today: string, kind: "total" | "snapshot"): { from: string; to: string; label: string } | null {
  if (compare === "none") return null;
  const other = compare === "previous" ? shift(p, -1)
    : p.kind === "week" ? periodOf("week", addDays(p.from, -364)) : periodOf(p.kind, addMonths(p.from, -12));
  const e = elapsed(p, today);
  if (!e.current) return { from: other.from, to: other.to, label: other.label };
  if (kind === "snapshot") {
    // The same point in the other period.
    const at = addDays(other.from, e.days);
    return { from: other.from, to: at < other.to ? at : other.to, label: `${other.label} (same point)` };
  }
  const to = addDays(other.from, e.days);
  const end = to < other.to ? to : other.to;
  return { from: other.from, to: end, label: `${dayLabel(other.from)}–${dayLabel(addDays(end, -1))}` };
}

export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && iso(toDate(s)) === s;
