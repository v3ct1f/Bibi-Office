import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useModuleHost } from "@office/ui/module-ui";

// ── Types (mirror the API) ───────────────────────────────────────────────────
export type Unit = "money" | "count" | "hours" | "minutes" | "days" | "percent";
export type PeriodKind = "week" | "month" | "quarter" | "year";
export type Compare = "previous" | "last_year" | "none";
export type Chart = "bar" | "line" | "none";
export type Status = "met" | "on_track" | "behind" | "missed";
export interface Metric {
  key: string; label: string; description: string; group: string; unit: Unit; kind: "total" | "snapshot"; better: "up" | "down";
  link: string | null; source: "module" | "manual" | "derived"; module: string; currency: string | null;
}
export interface Person { userId: string; name: string; email: string }
export interface Config {
  canManage: boolean; canWriteValues: boolean; timeZone: string; today: string; mail: { ready: boolean; missing: string[] };
  catalogue: Metric[]; people: Person[];
}
export interface BoardRow { id: string; name: string; description: string | null; period: PeriodKind; tileCount: number }
export interface Board {
  id: string; name: string; description: string | null; period: PeriodKind; compare: Compare; canManage: boolean;
  tiles: { id: string; metricKey: string; label: string | null; chart: Chart }[];
  digest: { enabled: boolean; weekday: number; hour: number; lastSentAt: string | null; lastError: string | null; recipients: { userId: string; name: string; email: string | null }[] } | null;
}
export interface Point { from: string; label: string; value: number | null }
export interface TileValue {
  id: string; metricKey: string; label: string; chart: Chart; metric: Metric | null; unavailable?: string;
  value?: number | null; currency?: string | null; error?: string | null;
  compare?: { value: number | null; label: string; change: number | null; good: boolean | null } | null;
  target?: { value: number; progress: number | null; pace: number | null; status: Status | null } | null;
  series?: Point[];
}
export interface Values {
  board: { id: string; name: string; period: PeriodKind; compare: Compare };
  period: { kind: PeriodKind; from: string; to: string; label: string; current: boolean; finished: boolean; daysElapsed: number; days: number };
  previous: string; next: string | null; compare: Compare; tiles: TileValue[];
}
export interface Target { metricKey: string; period: PeriodKind; value: number }

// ── Words ────────────────────────────────────────────────────────────────────
export const PERIOD_LABEL: Record<PeriodKind, string> = { week: "Week", month: "Month", quarter: "Quarter", year: "Year" };
export const EACH_PERIOD: Record<PeriodKind, string> = { week: "each week", month: "each month", quarter: "each quarter", year: "each year" };
export const COMPARE_LABEL: Record<Compare, string> = { previous: "Compare with the period before", last_year: "Compare with last year", none: "Don't compare" };
export const GROUP_LABEL: Record<string, string> = { money: "Money", sales: "Sales", team: "Team", operations: "Operations", support: "Support", other: "Your own numbers" };
export const UNIT_LABEL: Record<Unit, string> = { count: "A count", money: "Money", hours: "Hours", minutes: "Minutes", days: "Days", percent: "Percent" };
export const STATUS_LABEL: Record<Status, string> = { met: "Target met", on_track: "On track", behind: "Behind target", missed: "Target missed" };
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// ── Formatting ───────────────────────────────────────────────────────────────
export function fmtValue(value: number | null | undefined, unit: Unit, currency?: string | null, compact = false): string {
  if (value == null) return "—";
  const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat(undefined, o).format(value);
  switch (unit) {
    case "money": return compact && Math.abs(value) >= 10_000
      ? nf({ style: "currency", currency: currency || "EUR", notation: "compact", maximumFractionDigits: 1 })
      : nf({ style: "currency", currency: currency || "EUR", maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2 });
    case "percent": return `${nf({ maximumFractionDigits: 1 })}%`;
    case "hours": return `${nf({ maximumFractionDigits: 1 })} h`;
    case "days": return `${nf({ maximumFractionDigits: 1 })} ${value === 1 ? "day" : "days"}`;
    case "minutes": return value >= 120 ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value / 60)} h` : `${Math.round(value)} min`;
    default: return compact && Math.abs(value) >= 10_000 ? nf({ notation: "compact", maximumFractionDigits: 1 }) : nf({ maximumFractionDigits: value % 1 ? 1 : 0 });
  }
}
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : "—";
export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "—";
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

/** A link inside the module that navigates without a full reload. */
export function ModLink({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  const host = useModuleHost();
  return <a href={host.href(to)} className={className ?? "hover:underline"} onClick={(e) => { e.preventDefault(); host.navigate(to); }}>{children}</a>;
}

export function SectionTabs({ current }: { current: string }) {
  const host = useModuleHost();
  const tabs = [{ to: "/kpi", label: "Boards" }, { to: "/kpi/manual", label: "Your own numbers" }];
  return (
    <nav aria-label="KPI sections" className="mb-4 flex gap-1.5 overflow-x-auto">
      {tabs.map((s) => (
        <a key={s.to} href={host.href(s.to)} aria-current={current === s.to ? "page" : undefined}
          onClick={(e) => { e.preventDefault(); host.navigate(s.to); }}
          className={`rounded-md border px-3 py-1.5 text-sm font-medium whitespace-nowrap ${current === s.to ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
          {s.label}
        </a>
      ))}
    </nav>
  );
}

// ── Data loading ─────────────────────────────────────────────────────────────
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
