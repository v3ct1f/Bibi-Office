import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Badge } from "@office/ui";

// ── Types (mirror the API DTOs) ──────────────────────────────────────────────
export type Status = "draft" | "submitted" | "approved" | "rejected" | "paid";
export type Kind = "receipt" | "invoice";
export interface Line { description: string; quantity: number; amountCents: number }
export interface Expense {
  id: string; kind: Kind; status: Status; employeeId: string; employeeName?: string | null; vendor: string; docDate: string; dueDate: string | null;
  invoiceNumber: string | null; category: string | null; description: string | null; currency: string;
  subtotalCents: number; taxCents: number; totalCents: number; fileId: string | null;
  submittedAt: string | null; decidedBy: string | null; decidedAt: string | null; decisionComment: string | null; paidAt: string | null;
  createdAt: string; updatedAt: string;
}
export interface ExpenseDetail extends Expense {
  decidedByName: string | null; ocrText: string | null; lines: Line[];
  history: { action: string; actorName: string | null; comment: string | null; at: string }[];
  file: { id: string; name: string; contentType: string; sizeBytes: number } | null;
  can: { edit: boolean; delete: boolean; submit: boolean; approve: boolean; reject: boolean; pay: boolean };
}
export interface Config { currency: string; categories: string[]; me: string | null; canSubmit: boolean; canReview: boolean; maxFileBytes: number }
export interface Totals { currency: string; cents: number }
export interface ListResult { data: Expense[]; total: number; totals: Totals[] }

export const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "CAD", "AUD", "MXN"];

// ── Formatting ───────────────────────────────────────────────────────────────
export function fmtMoney(cents: number, currency: string): string {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100); }
  catch { return `${(cents / 100).toFixed(2)} ${currency}`; }
}
export const fmtTotals = (t: Totals[]) => (t.length ? t.map((x) => fmtMoney(x.cents, x.currency)).join(" + ") : fmtMoney(0, "EUR"));

/** "1,234.50" / "1234,5" -> cents; null when not a valid non-negative amount with at most 2 decimals. */
export function parseMoney(raw: string): number | null {
  let s = raw.trim().replace(/[\s'€$£]/g, "");
  if (!s) return 0;
  const lastSep = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  s = lastSep >= 0 && s.length - lastSep - 1 <= 2 ? `${s.slice(0, lastSep).replace(/[.,]/g, "")}.${s.slice(lastSep + 1)}` : s.replace(/[.,]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}
export const centsToInput = (cents: number | null | undefined) => (cents === null || cents === undefined ? "" : (cents / 100).toFixed(2));

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : "—";
export const fmtDateTime = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
export const today = () => new Date().toISOString().slice(0, 10);

export const STATUS: Record<Status, { label: string; variant: "default" | "success" | "neutral" | "warning" | "destructive" | "outline" }> = {
  draft: { label: "Draft", variant: "outline" },
  submitted: { label: "Waiting for approval", variant: "warning" },
  approved: { label: "Approved", variant: "default" },
  rejected: { label: "Rejected", variant: "destructive" },
  paid: { label: "Paid", variant: "success" },
};
export const StatusBadge = ({ status }: { status: Status }) => <Badge variant={STATUS[status].variant}>{STATUS[status].label}</Badge>;

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

export function Section({ n, title, description, children }: { n: number; title: string; description?: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 rounded-lg border bg-surface p-4 shadow-xs sm:p-5" aria-label={title}>
      <div className="flex gap-3">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{n}</span>
        <div className="grid gap-0.5">
          <h2 className="font-semibold leading-tight">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {children}
    </section>
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
  return { ...state, reload, set: (data: T) => setState({ data, loading: false }) };
}

export function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

/** Saves text as a file in the browser (CSV export). */
export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
