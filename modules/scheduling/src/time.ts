/** Pure date/time helpers for planning in local wall-clock time. Dates are "YYYY-MM-DD", times "HH:MM". */

const DAY_MS = 86_400_000;

export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
  && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
export const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(s);

export const dayNumber = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY_MS);
export const fromDayNumber = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => fromDayNumber(dayNumber(d) + n);
/** Monday of the week containing d. */
export const weekStart = (d: string) => { const wd = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7; return addDays(d, -wd); };
export const weekDays = (start: string) => Array.from({ length: 7 }, (_, i) => addDays(start, i));

export const hhmm = (t: string) => t.slice(0, 5);
export const minutesOf = (t: string) => { const [h, m] = t.split(":"); return Number(h) * 60 + Number(m); };

/** Length of a shift in minutes; an end at or before the start means it runs past midnight. */
export const spanMinutes = (start: string, end: string) => {
  const s = minutesOf(start), e = minutesOf(end);
  return e > s ? e - s : e + 1440 - s;
};
export const paidMinutes = (start: string, end: string, breakMinutes: number) => Math.max(0, spanMinutes(start, end) - breakMinutes);

/** Absolute [start, end) in minutes, so shifts on neighbouring days compare correctly. */
export const shiftInterval = (s: { day: string; start: string; end: string }): [number, number] => {
  const a = dayNumber(s.day) * 1440 + minutesOf(s.start);
  return [a, a + spanMinutes(s.start, s.end)];
};
export const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];

export const hours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;
export const fmtHours = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;

export function validTimeZone(tz: string | undefined): string {
  if (!tz) return "UTC";
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return tz; } catch { return "UTC"; }
}

/** Today's local date and time in a time zone. */
export function nowIn(tz: string, at = new Date()): { date: string; time: string } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
