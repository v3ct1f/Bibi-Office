import { useCallback, useEffect, useRef, useState } from "react";
import { Building2, User, X } from "lucide-react";
import { Badge, Button, Input } from "@office/ui";
import { useModuleHost, type ModuleHost } from "@office/ui/module-ui";

// ── Types (mirror the API DTOs) ──────────────────────────────────────────────
export type Status = "open" | "won" | "lost";
export interface Stage { id: string; name: string; kind: Status; probability: number; position?: number; dealCount?: number }
export interface Pipeline { id: string; name: string; stages: Stage[] }
export interface Deal {
  id: string; title: string; valueCents: number; currency: string; status: Status;
  pipelineId: string; stageId: string; stageName: string | null; probability: number;
  companyId: string | null; companyName: string | null; contactId: string | null; contactName: string | null;
  ownerId: string | null; expectedClose: string | null; nextStep: string | null; nextStepDate: string | null; notes: string | null;
  lostReason: string | null; closedAt: string | null; stageChangedAt: string; createdAt: string; updatedAt: string;
}
export interface Activity { id: string; kind: "note" | "call" | "meeting" | "email" | "stage" | "system"; body: string; createdBy: string | null; createdAt: string }
export type DealDetail = Deal & { stages: Stage[]; activities: Activity[] };
export interface Board {
  pipelines: { id: string; name: string }[];
  pipeline: { id: string; name: string };
  columns: { stage: Stage; deals: Deal[]; totals: Record<string, number> }[];
}
export interface Summary {
  currencies: { currency: string; openCount: number; openCents: number; weightedCents: number; wonMonthCount: number; wonMonthCents: number }[];
  winRate90d: number | null;
  nextStepsDue: number;
}

export const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "CAD", "AUD", "JPY"];

// ── Formatting ───────────────────────────────────────────────────────────────
export function fmtMoney(cents: number, currency: string, compact = false): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, ...(compact ? { notation: "compact", maximumFractionDigits: 1 } : {}) }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
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
export const centsToInput = (cents: number) => (cents / 100).toFixed(2);

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : "—";
export const fmtDateTime = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
export const today = () => new Date().toISOString().slice(0, 10);

export const STATUS: Record<Status, { label: string; variant: "default" | "success" | "neutral" }> = {
  open: { label: "Open", variant: "default" }, won: { label: "Won", variant: "success" }, lost: { label: "Lost", variant: "neutral" },
};
export const StatusBadge = ({ status }: { status: Status }) => <Badge variant={STATUS[status].variant}>{STATUS[status].label}</Badge>;

export const customerOf = (d: Pick<Deal, "companyName" | "contactName">) =>
  [d.companyName, d.contactName].filter(Boolean).join(" · ") || null;

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
  return { ...state, reload, set: (data: T) => setState({ data, loading: false }) };
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

/** Link to a core record page (company / contact). */
export const coreHref = (host: ModuleHost, kind: "companies" | "contacts", id: string) => `/t/${host.tenant.slug}/${kind}/${id}`;

// ── Customer picker (company and/or contact) ─────────────────────────────────
export interface Customer { kind: "company" | "contact"; id: string; label: string; companyId?: string | null }

export function CustomerPicker({ kind, value, onChange, label }: {
  kind: "company" | "contact"; value: Customer | null; onChange: (c: Customer | null) => void; label: string;
}) {
  const host = useModuleHost();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const results = useLoad(async () => {
    if (!dq) return [] as Customer[];
    if (kind === "company") {
      if (!host.can("core:companies.read")) return [];
      const r = await host.core.get<{ data: { id: string; name: string }[] }>("/companies", { q: dq, limit: 6 });
      return r.data.map((c): Customer => ({ kind, id: c.id, label: c.name }));
    }
    if (!host.can("core:contacts.read")) return [];
    const r = await host.core.get<{ data: { id: string; firstName: string | null; lastName: string | null; email: string | null; companyId: string | null }[] }>("/contacts", { q: dq, limit: 6 });
    return r.data.map((c): Customer => ({ kind, id: c.id, companyId: c.companyId, label: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unnamed contact" }));
  }, [host, dq, kind]);
  const Icon = kind === "company" ? Building2 : User;

  if (value) {
    return (
      <div className="flex h-9 items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 text-sm">
        <span className="flex items-center gap-2 truncate"><Icon className="size-4 text-muted-foreground" />
          <span className="truncate font-medium" data-testid={`selected-${kind}`}>{value.label}</span></span>
        <Button type="button" variant="ghost" size="sm" className="h-7" aria-label={`Remove ${kind}`} onClick={() => onChange(null)}><X /></Button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input aria-label={label} placeholder={kind === "company" ? "Search companies…" : "Search contacts…"} value={q} onChange={(e) => setQ(e.target.value)} />
      {dq && (
        <div role="listbox" aria-label={`${label} results`} className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-surface shadow-md">
          {results.loading && !results.data?.length ? <p className="p-3 text-sm text-muted-foreground">Searching…</p>
            : !results.data?.length ? (
              <p className="p-3 text-sm text-muted-foreground">
                No {kind === "company" ? "companies" : "contacts"} match “{dq}”.{" "}
                <a className="underline" href={`/t/${host.tenant.slug}/${kind === "company" ? "companies" : "contacts"}?new=1`}>Add one</a>
              </p>
            )
            : results.data.map((c) => (
              <button key={c.id} type="button" role="option" aria-selected={false}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => { onChange(c); setQ(""); }}>
                <Icon className="size-4 text-muted-foreground" />{c.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
