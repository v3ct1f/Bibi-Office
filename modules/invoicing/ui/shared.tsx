import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@office/ui";
import type { ModuleHost } from "@office/ui/module-ui";
import { toScaled } from "../src/money.ts";

// ── Types (mirror the API DTOs) ──────────────────────────────────────────────
export type DisplayStatus = "draft" | "sent" | "partially_paid" | "overdue" | "paid" | "void";
export interface BillTo { name: string; contactName?: string; email?: string; taxId?: string; address?: Record<string, unknown> }
export interface Invoice {
  id: string; number: string | null; status: "draft" | "sent" | "paid" | "void"; displayStatus: DisplayStatus;
  companyId: string | null; contactId: string | null; billTo: BillTo; currency: string;
  issueDate: string; dueDate: string; notes: string | null;
  subtotalCents: number; taxCents: number; totalCents: number; paidCents: number; balanceCents: number;
  source: string; sentAt: string | null; paidAt: string | null; voidedAt: string | null; voidReason: string | null;
  reminderCount: number; lastRemindedAt: string | null; createdAt: string;
}
export interface Line { id?: string; description: string; quantity: number; unitPriceCents: number; taxRate: number; netCents?: number; taxCents?: number }
export interface Payment { id: string; amountCents: number; paidOn: string; method: string | null; reference: string | null }
export type InvoiceDetail = Invoice & { lines: Line[]; payments: Payment[] };
export interface Config {
  currency: string; numberFormat: string; paymentTermDays: number; defaultTaxRate: number; defaultDueDate: string;
  sellerName?: string; sellerAddress?: string; sellerTaxId?: string; paymentInstructions?: string;
}
export interface Summary {
  today: string;
  currencies: { currency: string; outstandingCents: number; overdueCents: number; openCount: number; overdueCount: number; draftCount: number; paidLast30Cents: number }[];
}

// ── Formatting ───────────────────────────────────────────────────────────────
export function fmtMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** "1,234.50" / "1234,5" / "-3" -> cents; null when not a valid amount with at most 2 decimals. */
export function parseMoney(raw: string): number | null {
  let s = raw.trim().replace(/[\s ']/g, "");
  if (!s) return null;
  const lastSep = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  if (lastSep >= 0 && s.length - lastSep - 1 <= 2) {
    s = `${s.slice(0, lastSep).replace(/[.,]/g, "")}.${s.slice(lastSep + 1)}`;
  } else {
    s = s.replace(/[.,]/g, "");
  }
  if (!/^-?\d+(\.\d{0,2})?$/.test(s)) return null;
  try { return Number(toScaled(Number(s), 2)); } catch { return null; }
}

export const centsToInput = (cents: number) => (cents / 100).toFixed(2);

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : "—";

const STATUS: Record<DisplayStatus, { label: string; variant: "neutral" | "default" | "warning" | "destructive" | "success" | "outline" }> = {
  draft: { label: "Draft", variant: "neutral" },
  sent: { label: "Sent", variant: "default" },
  partially_paid: { label: "Partially paid", variant: "warning" },
  overdue: { label: "Overdue", variant: "destructive" },
  paid: { label: "Paid", variant: "success" },
  void: { label: "Void", variant: "outline" },
};
export const StatusBadge = ({ status }: { status: DisplayStatus }) => <Badge variant={STATUS[status].variant}>{STATUS[status].label}</Badge>;

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

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

export function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

/** Navigate to a module path with a query string (host.navigate takes paths only). */
export function goWithQuery(host: ModuleHost, path: string, query: Record<string, string>) {
  window.history.pushState(null, "", `${host.href(path)}?${new URLSearchParams(query)}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
