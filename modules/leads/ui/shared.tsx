import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@office/ui";

// ── Types (mirror the API DTOs) ──────────────────────────────────────────────
export type Status = "new" | "contacted" | "qualified" | "disqualified" | "converted";
export type Source = "manual" | "web_form" | "referral" | "event" | "phone" | "email" | "social" | "ads" | "workflow" | "other";
export interface Lead {
  id: string; name: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null;
  companyName: string | null; jobTitle: string | null; source: Source; status: Status;
  ownerId: string | null; ownerName: string | null; valueCents: number; currency: string; followUpOn: string | null;
  message: string | null; notes: string | null; disqualifyReason: string | null;
  contactId: string | null; companyId: string | null; convertedAt: string | null;
  statusChangedAt: string; createdAt: string; updatedAt: string;
}
export interface Activity { id: string; kind: "note" | "call" | "meeting" | "email" | "status" | "system"; body: string; createdBy: string | null; createdAt: string }
export type LeadDetail = Lead & { activities: Activity[] };
export interface Summary {
  byStatus: { new: number; contacted: number; qualified: number };
  open: number; addedThisWeek: number; followUpsDue: number; conversionRate90d: number | null;
}
export interface Person { userId: string; name: string }

export const SOURCES: { value: Source; label: string }[] = [
  { value: "manual", label: "Added by hand" }, { value: "web_form", label: "Web form" }, { value: "referral", label: "Referral" },
  { value: "event", label: "Event" }, { value: "phone", label: "Phone call" }, { value: "email", label: "Email" },
  { value: "social", label: "Social media" }, { value: "ads", label: "Ads" }, { value: "workflow", label: "Workflow" }, { value: "other", label: "Other" },
];
export const sourceLabel = (s: Source) => SOURCES.find((x) => x.value === s)?.label ?? s;

/** The working steps, in order; disqualified and converted are outcomes. */
export const STEPS: Status[] = ["new", "contacted", "qualified"];
export const STATUS: Record<Status, { label: string; variant: "default" | "success" | "neutral" | "warning" }> = {
  new: { label: "New", variant: "warning" }, contacted: { label: "Contacted", variant: "default" }, qualified: { label: "Qualified", variant: "default" },
  disqualified: { label: "Disqualified", variant: "neutral" }, converted: { label: "Converted", variant: "success" },
};
export const StatusBadge = ({ status }: { status: Status }) => <Badge variant={STATUS[status].variant}>{STATUS[status].label}</Badge>;

export const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "CAD", "AUD", "JPY"];

// ── Formatting ───────────────────────────────────────────────────────────────
export function fmtMoney(cents: number, currency: string): string {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100); }
  catch { return `${(cents / 100).toFixed(2)} ${currency}`; }
}
/** "1,234.50" / "1234,5" -> cents; null when not a valid non-negative amount with at most 2 decimals. */
export function parseMoney(raw: string): number | null {
  let s = raw.trim().replace(/[\s ']/g, "");
  if (!s) return 0;
  const lastSep = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  s = lastSep >= 0 && s.length - lastSep - 1 <= 2 ? `${s.slice(0, lastSep).replace(/[.,]/g, "")}.${s.slice(lastSep + 1)}` : s.replace(/[.,]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : "—";
export const fmtDateTime = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
export const today = () => new Date().toISOString().slice(0, 10);
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
export const isOpen = (s: Status) => STEPS.includes(s);

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
  return { ...state, reload, set: (data: T) => setState({ data, loading: false }) };
}

export function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}
