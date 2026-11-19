import { useState } from "react";
import { ArrowLeft, Ban, BellRing, Banknote, Pencil, Printer, Send, Trash2 } from "lucide-react";
import {
  Button, Card, ConfirmDialog, Dialog, DialogContent, DialogFooter, ErrorState, Field, Input, PageHeader, Skeleton, Textarea, toast,
} from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import {
  centsToInput, errorMessage, fmtDate, fmtMoney, parseMoney, StatusBadge, useLoad, type Config, type InvoiceDetail as Inv,
} from "./shared.tsx";

/** Prints only the invoice sheet (the module cannot touch the app's global CSS, so it ships its own rule). */
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  #invoice-sheet, #invoice-sheet * { visibility: visible !important; }
  #invoice-sheet { position: absolute; inset: 0 auto auto 0; width: 100%; border: 0 !important; box-shadow: none !important; }
}`;

function PaymentDialog({ inv, open, onOpenChange, onDone }: { inv: Inv; open: boolean; onOpenChange: (o: boolean) => void; onDone: (i: Inv) => void }) {
  const host = useModuleHost();
  const [amount, setAmount] = useState(centsToInput(inv.balanceCents));
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("Bank transfer");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const cents = parseMoney(amount);
  const invalid = cents === null || cents <= 0 || cents > inv.balanceCents;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Record payment" description={`Open balance ${fmtMoney(inv.balanceCents, inv.currency)}`}>
        <form className="grid gap-4" onSubmit={async (e) => {
          e.preventDefault();
          if (invalid) return;
          setBusy(true);
          try {
            const r = await host.api.post<Inv>(`/invoices/${inv.id}/payments`, { amountCents: cents, paidOn, method: method.trim() || null, reference: reference.trim() || null });
            toast.success(r.status === "paid" ? "Invoice paid in full" : "Payment recorded");
            onOpenChange(false); onDone(r);
          } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
        }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Amount (${inv.currency})`} error={amount && invalid ? `Enter an amount up to ${centsToInput(inv.balanceCents)}` : undefined}>
              {(a) => <Input {...a} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />}
            </Field>
            <Field label="Paid on">{(a) => <Input {...a} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />}</Field>
            <Field label="Method">{(a) => <Input {...a} value={method} onChange={(e) => setMethod(e.target.value)} maxLength={50} />}</Field>
            <Field label="Reference">{(a) => <Input {...a} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} />}</Field>
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={busy} disabled={invalid}>Record payment</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VoidDialog({ inv, open, onOpenChange, onDone }: { inv: Inv; open: boolean; onOpenChange: (o: boolean) => void; onDone: (i: Inv) => void }) {
  const host = useModuleHost();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Void ${inv.number}?`} description="The number stays used and the invoice stays on record, marked void. This cannot be undone.">
        <Field label="Reason">{(a) => <Textarea {...a} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}</Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" loading={busy} onClick={async () => {
            setBusy(true);
            try { const r = await host.api.post<Inv>(`/invoices/${inv.id}/void`, { reason: reason.trim() || null }); toast.success("Invoice voided"); onOpenChange(false); onDone(r); }
            catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
          }}>Void invoice</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Sheet({ inv, cfg, tenantName }: { inv: Inv; cfg: Config | undefined; tenantName: string }) {
  const addr = inv.billTo.address ? Object.values(inv.billTo.address).filter((v) => typeof v === "string" && v).join(", ") : "";
  return (
    <Card id="invoice-sheet" className="p-6 sm:p-10">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="grid gap-0.5 text-sm">
          <p className="text-base font-semibold">{cfg?.sellerName || tenantName}</p>
          {cfg?.sellerAddress && <p className="whitespace-pre-line text-muted-foreground">{cfg.sellerAddress}</p>}
          {cfg?.sellerTaxId && <p className="text-muted-foreground">Tax ID {cfg.sellerTaxId}</p>}
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold tracking-tight">{inv.status === "draft" ? "Draft invoice" : "Invoice"}</p>
          {inv.number && <p className="font-mono text-sm" data-testid="invoice-number">{inv.number}</p>}
        </div>
      </div>
      <div className="mt-8 grid gap-6 text-sm sm:grid-cols-2">
        <div className="grid gap-0.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Bill to</p>
          <p className="font-medium">{inv.billTo.name}</p>
          {inv.billTo.contactName && <p>{inv.billTo.contactName}</p>}
          {addr && <p className="text-muted-foreground">{addr}</p>}
          {inv.billTo.email && <p className="text-muted-foreground">{inv.billTo.email}</p>}
          {inv.billTo.taxId && <p className="text-muted-foreground">Tax ID {inv.billTo.taxId}</p>}
        </div>
        <dl className="grid content-start gap-1 sm:justify-self-end">
          <div className="flex justify-between gap-8"><dt className="text-muted-foreground">Issue date</dt><dd>{fmtDate(inv.issueDate)}</dd></div>
          <div className="flex justify-between gap-8"><dt className="text-muted-foreground">Due date</dt><dd>{fmtDate(inv.dueDate)}</dd></div>
          <div className="flex justify-between gap-8"><dt className="text-muted-foreground">Currency</dt><dd>{inv.currency}</dd></div>
        </dl>
      </div>
      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2 font-medium">Description</th><th className="py-2 text-right font-medium">Qty</th>
              <th className="py-2 text-right font-medium">Unit price</th><th className="py-2 text-right font-medium">Tax</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id} className="border-b">
                <td className="py-2 pr-4">{l.description}</td>
                <td className="py-2 text-right tabular-nums">{l.quantity}</td>
                <td className="py-2 text-right tabular-nums">{fmtMoney(l.unitPriceCents, inv.currency)}</td>
                <td className="py-2 text-right tabular-nums">{l.taxRate}%</td>
                <td className="py-2 text-right tabular-nums">{fmtMoney(l.netCents ?? 0, inv.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="ml-auto mt-4 grid max-w-xs gap-1.5 text-sm">
        <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd className="tabular-nums">{fmtMoney(inv.subtotalCents, inv.currency)}</dd></div>
        <div className="flex justify-between"><dt className="text-muted-foreground">Tax</dt><dd className="tabular-nums">{fmtMoney(inv.taxCents, inv.currency)}</dd></div>
        <div className="flex justify-between border-t pt-1.5 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums" data-testid="invoice-total">{fmtMoney(inv.totalCents, inv.currency)}</dd></div>
        {inv.paidCents > 0 && <>
          <div className="flex justify-between"><dt className="text-muted-foreground">Paid</dt><dd className="tabular-nums">−{fmtMoney(inv.paidCents, inv.currency)}</dd></div>
          <div className="flex justify-between font-semibold"><dt>Balance due</dt><dd className="tabular-nums" data-testid="invoice-balance">{fmtMoney(inv.balanceCents, inv.currency)}</dd></div>
        </>}
      </dl>
      {(inv.notes || cfg?.paymentInstructions) && (
        <div className="mt-8 grid gap-3 border-t pt-4 text-sm">
          {inv.notes && <p className="whitespace-pre-line">{inv.notes}</p>}
          {cfg?.paymentInstructions && <p className="whitespace-pre-line text-muted-foreground">{cfg.paymentInstructions}</p>}
        </div>
      )}
    </Card>
  );
}

export function InvoiceDetail({ params }: PageProps) {
  const host = useModuleHost();
  const id = params.id!;
  const inv = useLoad(() => host.api.get<Inv>(`/invoices/${id}`), [host, id]);
  const cfg = useLoad(() => host.api.get<Config>("/config"), [host]);
  const [current, setCurrent] = useState<Inv | null>(null);
  const [dialog, setDialog] = useState<null | "send" | "pay" | "void" | "delete" | "remind">(null);

  const back = (
    <a href={host.href("/invoices")} onClick={(e) => { e.preventDefault(); host.navigate("/invoices"); }} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" /> Invoices
    </a>
  );
  if (inv.loading && !inv.data) return <>{back}<Skeleton className="h-8 w-64" /><Skeleton className="mt-6 h-96" /></>;
  if (inv.error || !inv.data) return <>{back}<Card><ErrorState error={inv.error} onRetry={() => void inv.reload()} /></Card></>;
  const i = current && current.id === id ? current : inv.data;
  const done = (r: Inv) => setCurrent(r);
  const can = host.can;
  const open = i.status === "sent";

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast.success(ok); } catch (err) { toast.error(errorMessage(err)); throw err; }
  };

  return (
    <>
      <style>{PRINT_CSS}</style>
      {back}
      <PageHeader
        title={<span className="flex items-center gap-3">{i.number ?? "Draft invoice"} <StatusBadge status={i.displayStatus} /></span>}
        description={<>
          {i.billTo.name} · {fmtMoney(i.totalCents, i.currency)}
          {i.status === "sent" && <> · due {fmtDate(i.dueDate)}</>}
          {i.reminderCount > 0 && <> · {i.reminderCount} reminder{i.reminderCount === 1 ? "" : "s"} sent</>}
          {i.status === "void" && i.voidReason && <> · voided: {i.voidReason}</>}
        </>}
        actions={<>
          {i.status === "draft" && can("invoicing:invoice.write") && <>
            <Button variant="outline" className="text-destructive" onClick={() => setDialog("delete")}><Trash2 /> Delete</Button>
            <Button variant="outline" onClick={() => host.navigate(`/invoices/${i.id}/edit`)}><Pencil /> Edit</Button>
          </>}
          {open && can("invoicing:invoice.write") && i.paidCents === 0 && <Button variant="outline" onClick={() => setDialog("void")}><Ban /> Void</Button>}
          {open && can("invoicing:invoice.send") && <Button variant="outline" onClick={() => setDialog("remind")}><BellRing /> Send reminder</Button>}
          <Button variant="outline" onClick={() => window.print()}><Printer /> Print</Button>
          {i.status === "draft" && can("invoicing:invoice.send") && <Button onClick={() => setDialog("send")}><Send /> Send invoice</Button>}
          {open && can("invoicing:invoice.write") && <Button onClick={() => setDialog("pay")}><Banknote /> Record payment</Button>}
        </>}
      />
      {!cfg.data?.sellerName && can("core:modules.manage") && (
        <p className="mb-4 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Tip: add your company name, address and payment instructions in Settings → Modules → Invoicing so they print on every invoice.
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <Sheet inv={i} cfg={cfg.data} tenantName={host.tenant.name} />
        <Card className="h-fit p-4">
          <p className="mb-3 text-sm font-semibold">Payments</p>
          {i.payments.length === 0 ? <p className="text-sm text-muted-foreground">No payments yet.</p> : (
            <ul className="grid gap-3 text-sm">
              {i.payments.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3">
                  <div><p>{fmtDate(p.paidOn)}</p><p className="text-xs text-muted-foreground">{[p.method, p.reference].filter(Boolean).join(" · ") || "—"}</p></div>
                  <p className="tabular-nums">{fmtMoney(p.amountCents, i.currency)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {dialog === "pay" && <PaymentDialog inv={i} open onOpenChange={(o) => !o && setDialog(null)} onDone={done} />}
      {dialog === "void" && <VoidDialog inv={i} open onOpenChange={(o) => !o && setDialog(null)} onDone={done} />}
      <ConfirmDialog open={dialog === "send"} onOpenChange={(o) => !o && setDialog(null)} confirmLabel="Send invoice"
        title="Send this invoice?" description="It gets the next invoice number and can no longer be edited. Email delivery comes later; print or save it as PDF to send it now."
        onConfirm={() => act(async () => done(await host.api.post<Inv>(`/invoices/${i.id}/send`)), "Invoice sent")} />
      <ConfirmDialog open={dialog === "remind"} onOpenChange={(o) => !o && setDialog(null)} confirmLabel="Send reminder"
        title="Send a payment reminder?" description="This records the reminder and triggers any workflows or webhooks listening for invoice reminders."
        onConfirm={() => act(async () => { await host.api.post(`/invoices/${i.id}/remind`); await inv.reload(); setCurrent(null); }, "Reminder sent")} />
      <ConfirmDialog open={dialog === "delete"} onOpenChange={(o) => !o && setDialog(null)} destructive confirmLabel="Delete draft"
        title="Delete this draft?" description="Drafts have no number yet, so nothing is lost from your numbering."
        onConfirm={() => act(async () => { await host.api.del(`/invoices/${i.id}`); host.navigate("/invoices"); }, "Draft deleted")} />
    </>
  );
}
