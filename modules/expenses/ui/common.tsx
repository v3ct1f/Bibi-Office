import { Badge } from "@office/ui";
import type { ExpenseStatus } from "./types.ts";

export const P = {
  submit: "expenses:expense.submit", readAll: "expenses:expense.read_all", approve: "expenses:expense.approve",
  reimburse: "expenses:expense.reimburse", categories: "expenses:category.manage",
} as const;
export const ROOT = "/m/expenses/expenses";

const digits = (currency: string) => {
  try { return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { return 2; }
};
export const money = (minor: number, currency: string) =>
  new Intl.NumberFormat(navigator.language || "en", { style: "currency", currency }).format(minor / 10 ** digits(currency));
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
export const today = () => new Date().toISOString().slice(0, 10);

const LABEL: Record<ExpenseStatus, [string, "neutral" | "primary" | "success" | "warning" | "danger"]> = {
  draft: ["Draft", "neutral"], submitted: ["Awaiting approval", "primary"], approved: ["Approved", "success"],
  rejected: ["Needs changes", "danger"], reimbursed: ["Reimbursed", "neutral"],
};
export const StatusBadge = ({ s }: { s: ExpenseStatus }) => <Badge tone={LABEL[s][1]}>{LABEL[s][0]}</Badge>;

/** Accepted receipt types (the server checks content, this only filters the picker). */
export const RECEIPT_ACCEPT = "application/pdf,image/png,image/jpeg,image/webp,image/gif";
