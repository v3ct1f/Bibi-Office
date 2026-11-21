import type { MetricRange } from "./module.ts";

/** Offset of `tz` from UTC at `at`, in ms (positive east of Greenwich). */
function offsetMs(at: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(at));
  const n = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - Math.floor(at / 1000) * 1000;
}

/** The instant a calendar date ("2026-11-01") starts in `tz`. */
export function startOfDay(date: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - offsetMs(guess, tz);
  t = guess - offsetMs(t, tz); // second pass settles days when the clocks change
  return new Date(t);
}

/** Today's date ("2026-11-20") in `tz`. */
export function todayIn(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

/** A metric range for dates [from, to) in `tz`. */
export function metricRange(from: string, to: string, tz = "UTC", now = new Date()): MetricRange {
  const start = startOfDay(from, tz), end = startOfDay(to, tz);
  return { from, to, start: start.toISOString(), end: end.toISOString(), timeZone: tz, current: start <= now && now < end };
}
