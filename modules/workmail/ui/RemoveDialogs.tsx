import { useState } from "react";
import { Button, Dialog, DialogContent, DialogFooter, Field, Input, toast } from "@office/ui";
import { useModuleHost } from "@office/ui/module-ui";
import { errorMessage, fmtDate, mailboxPriceText, type Domain, type MailboxPrice } from "./shared.tsx";

/** What the business pays per month now and after `fewer` mailboxes stop counting (null when there's no charge). */
export function monthlyChange(price: MailboxPrice | null, planPerMonth: number | null, used: number, fewer: number) {
  if (!price || price.mode === "free" || fewer <= 0) return null;
  const fmt = (n: number) => mailboxPriceText({ ...price, perMonth: Math.round(n * 100) / 100 });
  const base = planPerMonth ?? 0;
  const before = fmt(base + used * price.perMonth), after = fmt(base + Math.max(0, used - fewer) * price.perMonth);
  const what = planPerMonth === null ? "Work email" : "Your monthly price";
  const tail = price.mode === "demo"
    ? " (demo: nothing is charged or refunded)."
    : ". It comes off your subscription now; the unused part of this month is credited on your next bill.";
  return `${what} goes from ${before} to ${after} per month (${fewer} ${fewer === 1 ? "mailbox" : "mailboxes"} × ${mailboxPriceText(price)} less)${tail}`;
}

const days60 = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 60 * 86_400_000).toISOString() : null);

/** Everything that happens when a domain is removed, said before it happens. */
export function removeDomainLines(d: Domain & { mailboxes?: number }, price: MailboxPrice | null, planPerMonth: number | null, used: number): string[] {
  const n = d.mailboxes ?? 0;
  const lines: string[] = [];
  if (d.status === "awaiting_payment") lines.push("The unfinished order is cancelled. Nothing was bought.");
  else if (d.source === "connected") lines.push(`${d.name} is disconnected from Work email. The domain itself stays yours at your own registrar.`);
  else {
    const paid = d.priceCents !== null && d.currency ? new Intl.NumberFormat(undefined, { style: "currency", currency: d.currency, minimumFractionDigits: 0 }).format(d.priceCents / 100) : "the year";
    lines.push(`${d.name} stays registered in your business's name${d.expiresOn ? ` until ${fmtDate(d.expiresOn)}` : ""} and won't be renewed (we let it expire).`);
    lines.push(price?.mode === "demo"
      ? `The ${paid} for this year isn't refunded (demo: nothing was charged).`
      : `The ${paid} paid for this year isn't refunded.`);
    const from = days60(d.registeredAt);
    lines.push(`Until it expires you can still move it to another registrar with "Take it with you"${from ? ` (from ${fmtDate(from)}: new domains are locked for 60 days)` : ""}.`);
  }
  lines.push(n > 0
    ? `Its ${n} ${n === 1 ? "mailbox is" : "mailboxes are"} switched off: mail stops arriving. The mail already in ${n === 1 ? "it" : "them"} is kept, nothing is deleted.`
    : "It has no mailboxes.");
  lines.push(monthlyChange(price, planPerMonth, used, n) ?? "What you pay each month doesn't change.");
  return lines;
}

/** Everything that happens when Work email is cancelled (Work email page and Add features say the same). */
export function cancelWorkEmailLines(price: MailboxPrice | null, planPerMonth: number | null, used: number): string[] {
  return [
    `Work email switches off now for everyone: ${used > 0 ? `all ${used} ${used === 1 ? "mailbox stops" : "mailboxes stop"} receiving mail` : "no mailboxes are affected"}.`,
    "Nothing is deleted: your domains, mailboxes and the mail in them are kept. Adding Work email again brings everything back.",
    "Domains you bought stay registered to your business until they expire and aren't renewed while Work email is off.",
    monthlyChange(price, planPerMonth, used, used) ?? (price?.mode === "free" || !price ? "There's no extra charge to stop." : "There's nothing on your subscription for Work email right now."),
  ];
}

/** A confirm dialog that lists what will happen and needs a word typed before the button works. */
function TypedConfirm({ open, title, lines, word, label, confirmLabel, busy, error, onConfirm, onClose }: {
  open: boolean; title: string; lines: string[]; word: string; label: string; confirmLabel: string; busy: boolean; error: string | null;
  onConfirm: () => void; onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const close = () => { setTyped(""); onClose(); };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent title={title} description="Please read what happens first.">
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (typed.trim().toLowerCase() === word) onConfirm(); }}>
          <ul className="grid list-disc gap-1.5 pl-5 text-sm" data-testid="remove-consequences">
            {lines.map((l) => <li key={l}>{l}</li>)}
          </ul>
          <Field label={label}>{(a) => <Input {...a} autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={word} />}</Field>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>Keep it</Button>
            <Button type="submit" variant="destructive" loading={busy} disabled={typed.trim().toLowerCase() !== word}>{confirmLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveDomainDialog({ domain, price, planPerMonth, used, onClose, onDone }: {
  domain: (Domain & { mailboxes?: number }) | null; price: MailboxPrice | null; planPerMonth: number | null; used: number;
  onClose: () => void; onDone: () => void;
}) {
  const host = useModuleHost();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    if (!domain) return;
    setBusy(true); setError(null);
    try {
      await host.api.post(`/domains/${domain.id}/remove`, { confirm: domain.name });
      toast.success(`${domain.name} removed`);
      setBusy(false); onDone();
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  };
  return (
    <TypedConfirm open={!!domain} title={`Remove ${domain?.name ?? ""}?`} lines={domain ? removeDomainLines(domain, price, planPerMonth, used) : []}
      word={domain?.name ?? ""} label={`Type ${domain?.name ?? ""} to confirm`} confirmLabel="Remove domain" busy={busy} error={error}
      onConfirm={() => void remove()} onClose={() => { setError(null); onClose(); }} />
  );
}
