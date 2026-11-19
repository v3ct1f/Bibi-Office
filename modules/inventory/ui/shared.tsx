import { useCallback, useEffect, useRef, useState } from "react";
import { Building2, X } from "lucide-react";
import { Badge, Button, Input } from "@office/ui";
import { useModuleHost } from "@office/ui/module-ui";

// ── Types (mirror the API DTOs) ──────────────────────────────────────────────
export type Reason = "delivery" | "usage" | "waste" | "count";
export type OrderStatus = "draft" | "sent" | "received" | "cancelled";
export interface Config { currency: string; me: string | null; canAdjust: boolean; canManage: boolean; categories: string[]; units: string[] }
export interface Item {
  id: string; name: string; sku: string | null; category: string | null; unit: string; stock: number; minStock: number; reorderQty: number | null;
  supplierId: string | null; supplierName: string | null; unitCostCents: number; valueCents: number; notes: string | null; archived: boolean;
  low: boolean; onOrder: number; suggestedQty: number; updatedAt: string;
}
export interface Movement {
  id: string; itemId: string; itemName: string; unit: string; reason: Reason; reasonLabel: string; delta: number; stockAfter: number;
  note: string | null; orderId: string | null; orderNumber: string | null; actorName: string | null; at: string;
}
export interface ItemDetail extends Item {
  openOrders: { id: string; number: string; status: OrderStatus; quantity: number }[];
  history: Movement[];
}
export interface ItemList { data: Item[]; lowCount: number; valueCents: number; currency: string }
export interface OrderSummary {
  id: string; number: string; supplierId: string; supplierName: string | null; status: OrderStatus; currency: string; expectedOn: string | null;
  lineCount: number; totalCents: number; createdAt: string; sentAt: string | null; receivedAt: string | null;
}
export interface OrderLine { id: string; itemId: string; itemName: string; unit: string; sku: string | null; quantity: number; unitCostCents: number; totalCents: number; receivedQty: number | null }
export interface Order extends OrderSummary {
  notes: string | null; createdByName: string | null; receivedByName: string | null; lines: OrderLine[];
  can: { edit: boolean; send: boolean; receive: boolean; cancel: boolean; delete: boolean };
}

// ── Formatting ───────────────────────────────────────────────────────────────
export function fmtMoney(cents: number, currency: string): string {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100); }
  catch { return `${(cents / 100).toFixed(2)} ${currency}`; }
}
export const fmtQty = (n: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(n);
export const fmtSigned = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtQty(Math.abs(n))}`;
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : "—";
export const fmtDateTime = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

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
export const centsToInput = (c: number | null | undefined) => (c === null || c === undefined ? "" : (c / 100).toFixed(2));
/** "2,5" / "2.5" -> 2.5; null if not a number >= 0 with at most 3 decimals. Empty -> undefined. */
export function parseQty(raw: string): number | null | undefined {
  const s = raw.trim().replace(",", ".");
  if (!s) return undefined;
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  return Number(s);
}

export const REASONS: { key: Reason; label: string; hint: string; sign: 1 | -1 | 0 }[] = [
  { key: "delivery", label: "Delivery", hint: "Stock came in", sign: 1 },
  { key: "usage", label: "Usage", hint: "Used or sold", sign: -1 },
  { key: "waste", label: "Waste", hint: "Spoiled, broken or expired", sign: -1 },
  { key: "count", label: "Count correction", hint: "Set what you actually counted", sign: 0 },
];
type Variant = "default" | "success" | "neutral" | "warning" | "destructive" | "outline";
const ORDER_STATUS: Record<OrderStatus, [string, Variant]> = {
  draft: ["Draft", "outline"], sent: ["Sent", "warning"], received: ["Received", "success"], cancelled: ["Cancelled", "neutral"],
};
export const OrderBadge = ({ status }: { status: OrderStatus }) => <Badge variant={ORDER_STATUS[status][1]}>{ORDER_STATUS[status][0]}</Badge>;
export const LowBadge = () => <Badge variant="destructive">Low</Badge>;
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

// ── Supplier picker (suppliers are core companies) ───────────────────────────
export interface Supplier { id: string; name: string }
export function SupplierPicker({ value, onChange, id, invalid }: { value: Supplier | null; onChange: (s: Supplier | null) => void; id?: string; invalid?: boolean }) {
  const host = useModuleHost();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const results = useLoad(async () => (dq ? (await host.core.get<{ data: Supplier[] }>("/companies", { q: dq, limit: 6 })).data : []), [host, dq]);

  if (value) {
    return (
      <div className="flex h-9 items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 text-sm">
        <span className="flex items-center gap-2 truncate"><Building2 className="size-4 text-muted-foreground" /><span className="truncate font-medium" data-testid="selected-supplier">{value.name}</span></span>
        <Button type="button" variant="ghost" size="sm" className="h-7" aria-label="Change supplier" onClick={() => onChange(null)}><X /> Change</Button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input id={id} aria-invalid={invalid || undefined} placeholder="Start typing a company name…" value={q} onChange={(e) => setQ(e.target.value)} />
      {dq && (
        <div role="listbox" aria-label="Suppliers" className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-surface shadow-md">
          {results.loading && !results.data?.length ? <p className="p-3 text-sm text-muted-foreground">Searching…</p>
            : !results.data?.length ? (
              <p className="p-3 text-sm text-muted-foreground">
                No company matches “{dq}”. Add your supplier under <a className="underline" href={`/t/${host.tenant.slug}/companies?new=1`}>Companies</a> first.
              </p>
            )
            : results.data.map((c) => (
              <button key={c.id} type="button" role="option" aria-selected={false}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => { onChange({ id: c.id, name: c.name }); setQ(""); }}>
                <Building2 className="size-4 text-muted-foreground" />{c.name}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
