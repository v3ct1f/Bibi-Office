import { Badge } from "@office/ui";
import type { Deal } from "./types.ts";

export const P = { read: "crm:deal.read", write: "crm:deal.write", activity: "crm:activity.write", pipeline: "crm:pipeline.manage" } as const;
export const ROOT = "/m/crm/deals";

const digits = (currency: string) => {
  try { return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { return 2; }
};
export const money = (minor: number, currency: string, compact = false) =>
  new Intl.NumberFormat(navigator.language || "en", { style: "currency", currency, ...(compact ? { notation: "compact", maximumFractionDigits: 1 } : {}) })
    .format(minor / 10 ** digits(currency));
/** "12.5" -> 1250 for EUR; null if invalid. */
export function parseMoney(text: string, currency: string): number | null {
  const t = text.trim().replace(/\s/g, "").replace(/,(\d{1,3})$/, ".$1").replace(/,/g, "");
  if (!t) return 0;
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const d = digits(currency), [i, f = ""] = t.split(".");
  if (f.length > d) return null;
  return Number(i) * 10 ** d + Number((f + "0".repeat(d)).slice(0, d) || 0);
}
export const toMajor = (minor: number, currency: string) => (minor / 10 ** digits(currency)).toFixed(digits(currency));
export const fmtDay = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC" }) : "—");
export const fmtWhen = (d: string) => new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
export const personName = (c: { firstName: string | null; lastName: string | null; email: string | null }) =>
  [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "—";

export function DealStatus({ d }: { d: Pick<Deal, "status" | "stale"> }) {
  if (d.status === "won") return <Badge tone="success">Won</Badge>;
  if (d.status === "lost") return <Badge tone="danger">Lost</Badge>;
  return d.stale ? <Badge tone="warning">Stale</Badge> : <Badge tone="primary">Open</Badge>;
}
