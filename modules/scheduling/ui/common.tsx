import { Badge } from "@office/ui";
import type { BookingStatus } from "./types.ts";

export const P = {
  read: "scheduling:booking.read", write: "scheduling:booking.write", own: "scheduling:availability.own",
  manage: "scheduling:availability.manage", services: "scheduling:service.manage",
} as const;
export const ROOT = "/m/scheduling/calendar";
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** YYYY-MM-DD of an instant in a time zone. */
export const localDate = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Monday of the week containing `day`. */
export const weekStart = (day: string) => { const d = new Date(`${day}T00:00:00Z`); return addDays(day, -((d.getUTCDay() + 6) % 7)); };
export const fmtTime = (iso: string, tz: string) => new Intl.DateTimeFormat(navigator.language || "en", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
export const fmtDayLong = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(navigator.language || "en", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
export const fmtDayShort = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(navigator.language || "en", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
export const fmtWhen = (iso: string, tz: string) =>
  new Intl.DateTimeFormat(navigator.language || "en", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
export const minToHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const hhmmToMin = (s: string) => { const [h, m] = s.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };

const LABEL: Record<BookingStatus, [string, "primary" | "neutral" | "success" | "danger"]> = {
  confirmed: ["Confirmed", "primary"], cancelled: ["Cancelled", "neutral"], completed: ["Completed", "success"], no_show: ["No-show", "danger"],
};
export const StatusBadge = ({ s }: { s: BookingStatus }) => <Badge tone={LABEL[s][1]}>{LABEL[s][0]}</Badge>;

/** Group slots by local day. */
export function byDay<T extends { start: string }>(slots: T[], tz: string) {
  const m = new Map<string, T[]>();
  for (const s of slots) { const d = localDate(new Date(s.start), tz); (m.get(d) ?? m.set(d, []).get(d)!).push(s); }
  return m;
}
