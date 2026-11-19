import { Badge } from "@office/ui";
import { formatMoney, minorDigits } from "../src/money.ts";
import type { Invoice } from "./types.ts";

export const P = { read: "invoicing:invoice.read", write: "invoicing:invoice.write", send: "invoicing:invoice.send", void: "invoicing:invoice.void", pay: "invoicing:payment.write" } as const;
export const ROOT = "/m/invoicing/invoices";
export const money = (minor: number, currency: string) => formatMoney(minor, currency, navigator.language || "en");
/** "12.5" -> 1250 for EUR. Returns null when not a valid amount. */
export function parseMoney(text: string, currency: string): number | null {
  const t = text.trim().replace(/\s/g, "").replace(/,(\d{1,3})$/, ".$1").replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const d = minorDigits(currency);
  const [i, f = ""] = t.replace("-", "").split(".");
  if (f.length > d) return null;
  const v = Number(i) * 10 ** d + Number((f + "0".repeat(d)).slice(0, d) || 0);
  return t.startsWith("-") ? -v : v;
}
export const toMajor = (minor: number, currency: string) => (minor / 10 ** minorDigits(currency)).toFixed(minorDigits(currency));
export const fmtDay = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC" }) : "—");

export function StatusBadge({ inv }: { inv: Pick<Invoice, "status" | "overdue" | "amountPaid"> }) {
  if (inv.status === "open" && inv.overdue) return <Badge tone="danger">Overdue</Badge>;
  if (inv.status === "open" && inv.amountPaid > 0) return <Badge tone="warning">Partly paid</Badge>;
  const map = { draft: ["neutral", "Draft"], open: ["primary", "Open"], paid: ["success", "Paid"], void: ["neutral", "Void"] } as const;
  const [tone, label] = map[inv.status];
  return <Badge tone={tone}>{label}</Badge>;
}
