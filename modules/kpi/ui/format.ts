import type { Unit } from "./types.ts";

const lang = () => (typeof navigator !== "undefined" && navigator.language) || "en";
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Today in the company's time zone, as a UTC-midnight Date (for calendar arithmetic). */
const todayIn = (timeZone: string) => {
  let ymd: string;
  try { ymd = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
  catch { ymd = new Date().toISOString().slice(0, 10); }
  return new Date(`${ymd}T00:00:00Z`);
};
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

export type Preset = "this_month" | "last_month" | "last_30" | "last_90" | "this_quarter" | "this_year" | "last_12m";
export const PRESETS: [Preset, string][] = [
  ["this_month", "This month"], ["last_month", "Last month"], ["last_30", "Last 30 days"], ["last_90", "Last 90 days"],
  ["this_quarter", "This quarter"], ["this_year", "This year"], ["last_12m", "Last 12 months"],
];
/** Inclusive date range for a preset in the company's calendar ("this …" ranges end today). */
export function presetRange(p: Preset, timeZone = "UTC"): { from: string; to: string } {
  const t = todayIn(timeZone), y = t.getUTCFullYear(), m = t.getUTCMonth();
  switch (p) {
    case "this_month": return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(t) };
    case "last_month": return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) };
    case "last_30": return { from: iso(addDays(t, -29)), to: iso(t) };
    case "last_90": return { from: iso(addDays(t, -89)), to: iso(t) };
    case "this_quarter": return { from: iso(new Date(Date.UTC(y, m - (m % 3), 1))), to: iso(t) };
    case "this_year": return { from: iso(new Date(Date.UTC(y, 0, 1))), to: iso(t) };
    case "last_12m": return { from: iso(new Date(Date.UTC(y, m - 11, 1))), to: iso(t) };
  }
}

/** Compact value for a stat tile: 1,284 / 12.9K / €4.2M; money arrives in minor units. */
export function fmtValue(v: number | null, unit: Unit, currency: string | null, compact = true): string {
  if (v === null) return "—";
  const opts: Intl.NumberFormatOptions = compact && Math.abs(unit === "money" ? v / 100 : v) >= 10_000 ? { notation: "compact", maximumFractionDigits: 1 } : {};
  if (unit === "money") {
    try { return new Intl.NumberFormat(lang(), { style: "currency", currency: currency ?? "EUR", maximumFractionDigits: compact ? 0 : 2, ...opts }).format(v / 100); }
    catch { return (v / 100).toFixed(2); }
  }
  if (unit === "percent") return `${new Intl.NumberFormat(lang(), { maximumFractionDigits: 1 }).format(v)}%`;
  if (unit === "hours") return `${new Intl.NumberFormat(lang(), { maximumFractionDigits: 1 }).format(v)} h`;
  return new Intl.NumberFormat(lang(), { maximumFractionDigits: 1, ...opts }).format(v);
}

/** Bucket label for axes and tooltips. */
export function fmtBucket(t: string, bucket: "day" | "week" | "month", long = false) {
  const d = new Date(`${t}T00:00:00Z`);
  if (bucket === "month") return d.toLocaleDateString(lang(), { month: long ? "long" : "short", year: long ? "numeric" : "2-digit", timeZone: "UTC" });
  const s = d.toLocaleDateString(lang(), { day: "numeric", month: "short", timeZone: "UTC" });
  return bucket === "week" && long ? `Week of ${s}` : s;
}
export const fmtDay = (t: string) => new Date(`${t}T00:00:00Z`).toLocaleDateString(lang(), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Change vs the previous period: direction, size, and whether it is good. */
export function delta(now: number | null, prev: number | null, unit: Unit, lowerIsBetter: boolean) {
  if (now === null || prev === null) return null;
  const diff = now - prev;
  if (diff === 0) return { dir: "flat" as const, text: "No change", good: null };
  const pct = prev !== 0 && unit !== "percent" ? Math.round((diff / Math.abs(prev)) * 100) : null;
  const text = unit === "percent" ? `${diff > 0 ? "+" : ""}${diff.toFixed(1)} pts` : pct !== null ? `${diff > 0 ? "+" : ""}${pct}%` : `${diff > 0 ? "+" : ""}${fmtValue(diff, unit, null)}`;
  return { dir: diff > 0 ? ("up" as const) : ("down" as const), text, good: diff > 0 !== lowerIsBetter };
}
