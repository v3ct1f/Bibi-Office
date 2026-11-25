import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@office/ui";

// ── Types (mirror the API) ───────────────────────────────────────────────────
export interface DnsRecord { type: "MX" | "TXT" | "CNAME"; host: string; value: string; priority?: number }
export interface Domain {
  id: string; name: string; source: "bought" | "connected"; status: "awaiting_payment" | "dns_pending" | "active";
  priceCents: number | null; currency: string | null; registrant: { name: string; email: string } | null;
  expiresOn: string | null; lastError: string | null; transferable: boolean; records: DnsRecord[] | null;
}
export interface Mailbox {
  id: string; address: string; localPart: string; domainId: string; domain: string; name: string; userId: string | null;
  status: "active" | "suspended"; suspendReason: "colleague_removed" | "feature_off" | "by_hand" | null; webmailUrl: string | null;
}
export type NewMailbox = Mailbox & { password: string };
export interface Offer { domain: string; available: boolean; priceCents: number | null; currency: string }
export interface MailboxPrice { perMonth: number; currency: string; mode: "stripe" | "demo" | "free" }
export interface Config {
  available: boolean; maxMailboxes: number; paymentRequired: boolean; hasDomain: boolean;
  mailboxesUsed: number; mailboxPrice: MailboxPrice | null;
}

/** The price of one mailbox, e.g. "€3". */
export function mailboxPriceText(p: MailboxPrice) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: p.currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(p.perMonth); }
  catch { return `${p.perMonth} ${p.currency}`; }
}
/** Said before a mailbox is created: what it costs this business. */
export function mailboxCostBefore(p: MailboxPrice | null): string {
  if (!p || p.mode === "free") return "No extra charge for your business.";
  if (p.mode === "demo") return `Each work mailbox costs ${mailboxPriceText(p)} per month (demo: nothing is charged).`;
  return `This adds ${mailboxPriceText(p)} per month to your subscription.`;
}
/** Said after a mailbox was created. Empty when there's no charge. */
export function mailboxCostAfter(p: MailboxPrice | null): string {
  if (!p || p.mode === "free") return "";
  if (p.mode === "demo") return `On a real subscription this adds ${mailboxPriceText(p)}/month (demo: nothing was charged).`;
  return `This added ${mailboxPriceText(p)}/month to your subscription.`;
}
/** The price in the create button, e.g. " (+€3/month)". */
export function mailboxCostShort(p: MailboxPrice | null): string {
  if (!p || p.mode === "free") return "";
  return ` (+${mailboxPriceText(p)}/month${p.mode === "demo" ? ", demo" : ""})`;
}
export interface Member { id: string; userId: string; name: string | null; email: string }

export const DOMAIN_STATUS: Record<Domain["status"], { label: string; variant: "success" | "warning" | "neutral" }> = {
  active: { label: "Ready", variant: "success" },
  dns_pending: { label: "Waiting for DNS records", variant: "warning" },
  awaiting_payment: { label: "Waiting for payment", variant: "warning" },
};
export const REASON: Record<string, string> = { colleague_removed: "colleague removed", feature_off: "Work email was off", by_hand: "switched off" };
export const DomainBadge = ({ status }: { status: Domain["status"] }) => <Badge variant={DOMAIN_STATUS[status].variant}>{DOMAIN_STATUS[status].label}</Badge>;

export function fmtMoney(cents: number, currency: string): string {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100); }
  catch { return `${(cents / 100).toFixed(2)} ${currency}`; }
}
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : "—";

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
