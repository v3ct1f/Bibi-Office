import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button } from "@office/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";

// ── Types (mirror the API DTOs) ──────────────────────────────────────────────
export type Color = "blue" | "green" | "orange" | "purple" | "pink" | "teal" | "red" | "gray";
export const COLORS: Color[] = ["blue", "green", "orange", "purple", "pink", "teal", "red", "gray"];
export interface Config { timezone: string; today: string; me: string | null; canSelf: boolean; canManage: boolean }
export interface Person { userId: string; name: string }
export interface Position { id: string; name: string; color: Color }
export interface Shift {
  id: string; employeeId: string; positionId: string | null; day: string; start: string; end: string; breakMinutes: number;
  notes: string | null; published: boolean; mine: boolean; minutes: number; swapPending?: boolean; positionName?: string | null;
}
export interface WeekTimeOff { id: string; employeeId: string; kind: TimeOffKind; startDate: string; endDate: string; status: "approved" | "pending" }
export interface Week {
  start: string; end: string; days: string[]; today: string; timezone: string;
  people: Person[]; positions: Position[]; shifts: Shift[]; timeOff: WeekTimeOff[]; drafts: number;
}
export type TimeOffKind = "vacation" | "sick" | "personal" | "other";
export type TimeOffStatus = "pending" | "approved" | "rejected" | "cancelled";
export interface Brief { id: string; day: string; start: string; end: string }
export interface TimeOff {
  id: string; employeeId: string; employeeName: string | null; kind: TimeOffKind; startDate: string; endDate: string; reason: string | null;
  status: TimeOffStatus; decidedByName: string | null; decidedAt: string | null; decisionComment: string | null; createdAt: string; conflicts: Brief[];
}
export type SwapStatus = "pending" | "accepted" | "declined" | "approved" | "rejected" | "cancelled";
export interface Swap {
  id: string; status: SwapStatus; message: string | null; decisionComment: string | null; createdAt: string;
  from: { userId: string; name: string | null }; to: { userId: string; name: string | null };
  shift: Brief | null; targetShift: Brief | null; decidedByName: string | null;
  can: { respond: boolean; cancel: boolean; decide: boolean };
}
export interface Entry {
  id: string; employeeId: string; shiftId: string | null; clockIn: string; clockOut: string | null; date: string;
  in: string; out: string | null; overnight: boolean; minutes: number; open: boolean; note: string | null; source: "clock" | "manual"; edited: boolean;
}

// ── Dates (local wall-clock strings, "YYYY-MM-DD") ──────────────────────────
const DAY_MS = 86_400_000;
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const weekStart = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
const fmt = (opts: Intl.DateTimeFormatOptions) => (d: string) => new Intl.DateTimeFormat(undefined, { ...opts, timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
export const fmtDay = fmt({ weekday: "short", day: "numeric", month: "short" });
export const fmtWeekday = fmt({ weekday: "short" });
export const fmtDayNum = fmt({ day: "numeric", month: "short" });
export const fmtDate = fmt({ dateStyle: "medium" });
export const fmtRange = (a: string, b: string) => (a === b ? fmtDate(a) : `${fmtDayNum(a)} – ${fmtDate(b)}`);
export const fmtHours = (m: number) => `${Math.floor(m / 60)}h ${String(Math.abs(m) % 60).padStart(2, "0")}m`;
export const overnight = (s: { start: string; end: string }) => s.end <= s.start;
export const shiftTime = (s: { start: string; end: string }) => `${s.start}–${s.end}${overnight(s) ? " (+1)" : ""}`;

export const KIND_LABEL: Record<TimeOffKind, string> = { vacation: "Vacation", sick: "Sick leave", personal: "Personal", other: "Other" };
type Variant = "default" | "success" | "neutral" | "warning" | "destructive" | "outline";
const TO_STATUS: Record<TimeOffStatus, [string, Variant]> = {
  pending: ["Waiting for approval", "warning"], approved: ["Approved", "success"], rejected: ["Rejected", "destructive"], cancelled: ["Cancelled", "neutral"],
};
const SW_STATUS: Record<SwapStatus, [string, Variant]> = {
  pending: ["Waiting for colleague", "warning"], accepted: ["Waiting for manager", "warning"], declined: ["Declined", "neutral"],
  approved: ["Approved", "success"], rejected: ["Rejected", "destructive"], cancelled: ["Cancelled", "neutral"],
};
export const TimeOffBadge = ({ status }: { status: TimeOffStatus }) => <Badge variant={TO_STATUS[status][1]}>{TO_STATUS[status][0]}</Badge>;
export const SwapBadge = ({ status }: { status: SwapStatus }) => <Badge variant={SW_STATUS[status][1]}>{SW_STATUS[status][0]}</Badge>;

/** Static class names so Tailwind picks them up. */
export const COLOR_CLASS: Record<Color, string> = {
  blue: "border-l-blue-500 bg-blue-500/10", green: "border-l-green-500 bg-green-500/10", orange: "border-l-orange-500 bg-orange-500/10",
  purple: "border-l-purple-500 bg-purple-500/10", pink: "border-l-pink-500 bg-pink-500/10", teal: "border-l-teal-500 bg-teal-500/10",
  red: "border-l-red-500 bg-red-500/10", gray: "border-l-gray-400 bg-gray-500/10",
};
export const DOT_CLASS: Record<Color, string> = {
  blue: "bg-blue-500", green: "bg-green-500", orange: "bg-orange-500", purple: "bg-purple-500",
  pink: "bg-pink-500", teal: "bg-teal-500", red: "bg-red-500", gray: "bg-gray-400",
};

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

/** Previous / this / next week buttons with the week's dates. */
export function WeekNav({ start, today, onChange }: { start: string; today: string; onChange: (s: string) => void }) {
  const current = weekStart(today) === start;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="icon" aria-label="Previous week" onClick={() => onChange(addDays(start, -7))}><ChevronLeft /></Button>
      <Button variant="outline" size="icon" aria-label="Next week" onClick={() => onChange(addDays(start, 7))}><ChevronRight /></Button>
      <p className="min-w-40 font-medium" aria-live="polite" data-testid="week-label">{fmtRange(start, addDays(start, 6))}</p>
      {!current && <Button variant="link" size="sm" onClick={() => onChange(weekStart(today))}>This week</Button>}
    </div>
  );
}

// ── Data loading (modules use host.api, not the app's query cache) ───────────
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const reload = useCallback(async () => {
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await run();
      if (n === seq.current) setState({ data, loading: false });
    } catch (error) {
      if (n === seq.current) setState({ error, loading: false });
    }
  }, [run]);
  useEffect(() => { void reload(); }, [reload]);
  return { ...state, reload };
}

/** Saves text as a file in the browser (CSV export). */
export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
