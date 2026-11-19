import { Badge } from "@office/ui";
import type { MovementKind } from "./types.ts";

export const P = { read: "inventory:items.read", move: "inventory:stock.move", adjust: "inventory:stock.adjust", manage: "inventory:items.manage" } as const;
export const ROOT = "/m/inventory/inventory";
const lang = () => (typeof navigator !== "undefined" && navigator.language) || "en";
const digits = (currency: string) => {
  try { return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { return 2; }
};
export const fmtMoney = (minor: number, currency: string) =>
  new Intl.NumberFormat(lang(), { style: "currency", currency }).format(minor / 10 ** digits(currency));
/** "12.5" → 1250 (minor units); undefined when blank or invalid */
export const toMinor = (s: string, currency: string): number | undefined => {
  const t = s.trim().replace(",", ".");
  if (!t || !/^\d+(\.\d+)?$/.test(t)) return undefined;
  return Math.round(Number(t) * 10 ** digits(currency));
};
export const fromMinor = (minor: number | null | undefined, currency: string) => (minor == null ? "" : String(minor / 10 ** digits(currency)));
export const fmtQty = (n: number, unit?: string) => `${new Intl.NumberFormat(lang(), { maximumFractionDigits: 3 }).format(n)}${unit ? ` ${unit}` : ""}`;
export const fmtWhen = (iso: string) => new Date(iso).toLocaleString(lang(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

const KIND: Record<MovementKind, [string, "primary" | "neutral" | "success" | "danger" | "warning"]> = {
  receipt: ["Received", "success"], issue: ["Issued", "primary"], adjustment: ["Adjusted", "warning"],
  transfer_out: ["Moved out", "neutral"], transfer_in: ["Moved in", "neutral"], count: ["Counted", "warning"],
};
export const KindBadge = ({ k }: { k: MovementKind }) => <Badge tone={KIND[k][1]}>{KIND[k][0]}</Badge>;
export const StockBadge = ({ low, onHand }: { low: boolean; onHand: number }) =>
  onHand <= 0 ? <Badge tone="danger">Out of stock</Badge> : low ? <Badge tone="warning">Low</Badge> : null;
