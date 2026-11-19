import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@office/ui";

// ── Types (mirror the API DTOs) ──────────────────────────────────────────────
export type Status = "open" | "pending" | "solved";
export type Priority = "low" | "normal" | "high" | "urgent";
export type View = "mine" | "unassigned" | "open" | "pending" | "solved" | "overdue" | "all";
export interface Person { userId: string; name: string }
export interface Config {
  me: string | null; canReply: boolean; canManage: boolean;
  mailbox: { configured: boolean; address: string | null; missing: string[] };
  sync: { lastRunAt: string | null; lastOkAt: string | null; lastError: string | null; imported: number } | null;
  people: Person[];
}
export interface Ticket {
  id: string; number: number; ref: string; subject: string; status: Status; priority: Priority; channel: "email" | "manual";
  requesterEmail: string | null; requesterName: string | null; contactId: string | null; assigneeId: string | null; assigneeName: string | null;
  firstResponseAt: string | null; firstResponseDue: string | null; resolutionDue: string | null; solvedAt: string | null;
  lastMessageAt: string; lastInboundAt: string | null; createdAt: string; overdue: { firstResponse: boolean; resolution: boolean };
}
export interface TicketRow extends Ticket { preview: string; lastFrom: "customer" | "us" }
export interface Counts { mine: number; unassigned: number; open: number; pending: number; overdue: number }
export interface TicketList { total: number; counts: Counts; data: TicketRow[] }
export interface Attachment { id: string; name: string; contentType: string; sizeBytes: number }
export interface Message {
  id: string; kind: "inbound" | "reply" | "note"; authorName: string | null; fromEmail: string | null; fromName: string | null; to: string[]; cc: string[];
  body: string; sendStatus: "sending" | "sent" | "failed" | null; sendError: string | null; sentAt: string | null; createdAt: string; attachments: Attachment[];
}
export interface TicketDetail extends Ticket {
  contact: { id: string; name: string; phone: string | null; companyId: string | null } | null;
  messages: Message[];
  otherTickets: { id: string; ref: string; subject: string; status: Status; createdAt: string }[];
}
export interface Macro { id: string; name: string; body: string; updatedAt: string }
export interface Target { priority: Priority; firstResponseMin: number | null; resolutionMin: number | null }

// ── Labels & formatting ──────────────────────────────────────────────────────
type Variant = "default" | "success" | "neutral" | "warning" | "destructive" | "outline";
export const STATUS: Record<Status, [string, Variant, string]> = {
  open: ["Open", "warning", "Waiting for us"],
  pending: ["Pending", "outline", "Waiting for the customer"],
  solved: ["Solved", "success", "Done"],
};
export const PRIORITY: Record<Priority, [string, Variant]> = {
  urgent: ["Urgent", "destructive"], high: ["High", "warning"], normal: ["Normal", "neutral"], low: ["Low", "outline"],
};
export const PRIORITIES: Priority[] = ["urgent", "high", "normal", "low"];
export const StatusBadge = ({ status }: { status: Status }) => <Badge variant={STATUS[status][1]}>{STATUS[status][0]}</Badge>;
export const PriorityBadge = ({ priority }: { priority: Priority }) =>
  priority === "normal" ? null : <Badge variant={PRIORITY[priority][1]}>{PRIORITY[priority][0]}</Badge>;
export const OverdueBadge = ({ t }: { t: Ticket }) =>
  t.overdue.firstResponse ? <Badge variant="destructive">Reply overdue</Badge> : t.overdue.resolution ? <Badge variant="destructive">Overdue</Badge> : null;

export const fmtDateTime = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
export function fmtRelative(iso: string, now = Date.now()) {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 7 * 86400) return rtf.format(Math.round(diff / 86400), "day");
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
}
/** "1 h 30 min" for a number of minutes. */
export function fmtMinutes(m: number | null) {
  if (m === null) return "No target";
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
  return [d ? `${d} d` : "", h ? `${h} h` : "", min ? `${min} min` : ""].filter(Boolean).join(" ") || "0 min";
}
export const fmtSize = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);
export const requesterLabel = (t: Pick<Ticket, "requesterName" | "requesterEmail">) => t.requesterName || t.requesterEmail || "Unknown customer";
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
/** Re-runs `fn` every `ms` while the tab is visible (new mail arrives in the background). */
export function useInterval(fn: () => void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") ref.current(); }, ms);
    return () => clearInterval(t);
  }, [ms]);
}
