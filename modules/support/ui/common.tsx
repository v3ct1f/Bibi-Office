import { Badge } from "@office/ui";
import type { Priority, TicketStatus } from "./types.ts";

export const P = { read: "support:tickets.read", work: "support:tickets.work", manage: "support:tickets.manage" } as const;
export const ROOT = "/m/support/inbox";

const STATUS: Record<TicketStatus, [string, "primary" | "neutral" | "success" | "warning"]> = {
  new: ["New", "primary"], open: ["Open", "warning"], pending: ["Waiting on customer", "neutral"], solved: ["Solved", "success"],
};
export const StatusBadge = ({ s }: { s: TicketStatus }) => <Badge tone={STATUS[s][1]}>{STATUS[s][0]}</Badge>;
export const statusLabel = (s: TicketStatus) => STATUS[s][0];
export const PRIORITIES: [Priority, string][] = [["low", "Low"], ["normal", "Normal"], ["high", "High"], ["urgent", "Urgent"]];
export const PriorityBadge = ({ p }: { p: Priority }) =>
  p === "normal" ? null : <Badge tone={p === "urgent" ? "danger" : p === "high" ? "warning" : "neutral"}>{PRIORITIES.find((x) => x[0] === p)![1]}</Badge>;

const rtf = () => new Intl.RelativeTimeFormat(navigator.language || "en", { numeric: "auto" });
/** "5 min ago", "in 2 hours", "3 days ago". */
export function ago(iso: string) {
  const s = (Date.parse(iso) - Date.now()) / 1000, a = Math.abs(s);
  if (a < 60) return rtf().format(Math.round(s), "second");
  if (a < 3600) return rtf().format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf().format(Math.round(s / 3600), "hour");
  return rtf().format(Math.round(s / 86400), "day");
}
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString(navigator.language || "en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
export const who = (t: { requesterName: string | null; requesterEmail: string }) => t.requesterName || t.requesterEmail;
