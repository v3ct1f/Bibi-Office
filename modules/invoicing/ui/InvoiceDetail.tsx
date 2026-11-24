import { useState, type ReactNode } from "react";
import { ArrowLeft, Ban, BellRing, Banknote, Check, CircleCheck, Lock, Pencil, Printer, Settings2, Trash2 } from "lucide-react";
import {
  Button, Card, ConfirmDialog, Dialog, DialogContent, DialogFooter, ErrorState, DatePicker, Field, Input, PageHeader, Skeleton, Textarea, toast,
} from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import {
  addressLines, centsToInput, errorMessage, fmtDate, fmtMoney, parseMoney, StatusBadge, useLoad,
  type Config, type InvoiceDetail as Inv, type Seller,
} from "./shared.tsx";

/** Prints only the invoice sheet (the module cannot touch the app's global CSS, so it ships its own rule). */
const PRINT_CSS = `@media print {
  @page { margin: 14mm; }
  body * { visibility: hidden !important; }
  #invoice-sheet, #invoice-sheet * { visibility: visible !important; }
  #invoice-sheet { position: absolute; inset: 0 auto auto 0; width: 100%; border: 0 !important; box-shadow: none !important; padding: 0 !important; color: #000; background: #fff; }
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
      <DialogContent title="Record payment" description={`Money received for ${inv.number}. Open balance ${fmtMoney(inv.balanceCents, inv.currency)}.`}>
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
            <Field label={`Amount (${inv.currency})`} hint="Change it for a part-payment." error={amount && invalid ? `Enter an amount up to ${centsToInput(inv.balanceCents)}` : undefined}>
              {(a) => <Input {...a} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />}
            </Field>
            <Field label="Paid on">{(a) => <DatePicker {...a} value={paidOn} onChange={(iso) => setPaidOn(iso)} />}</Field>
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
      <DialogContent title={`Void ${inv.number}?`} description="Use this when an invoice was issued by mistake. It stays on record marked void, and its number is not reused. This cannot be undone.">
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

// ── Progress + next step ─────────────────────────────────────────────────────
function Progress({ inv }: { inv: Inv }) {
  const steps = [
    { key: "draft", label: "Draft", hint: "Editable, no number yet" },
    { key: "final", label: "Finalized", hint: inv.number ?? "Gets its number" },
    { key: "paid", label: inv.status === "void" ? "Void" : "Paid", hint: inv.status === "void" ? "Cancelled" : inv.paidCents > 0 && inv.status !== "paid" ? "Part-paid" : "Money received" },
  ];
  const at = inv.status === "draft" ? 0 : inv.status === "sent" ? 1 : 2;
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="Invoice progress">
      {steps.map((s, i) => {
        const done = i < at || (i === at && i === 2);
        const current = i === at && !done;
        return (
          <li key={s.key} aria-current={current ? "step" : undefined}
            className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${current ? "border-primary bg-primary/5" : ""} ${i > at ? "opacity-60" : ""}`}>
            <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${done ? "bg-success text-white" : current ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              {done ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className="grid leading-tight"><span className="font-medium">{s.label}</span><span className="text-xs text-muted-foreground">{s.hint}</span></span>
          </li>
        );
      })}
    </ol>
  );
}

function NextStep({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card className="flex flex-wrap items-center gap-4 border-primary/30 bg-primary/5 p-4" role="status" aria-label="Next step">
      <div className="text-primary [&_svg]:size-5">{icon}</div>
      <div className="grid min-w-60 flex-1 gap-0.5">
        <p className="font-semibold">{title}</p>
        <div className="text-sm text-muted-foreground">{children}</div>
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </Card>
  );
}

// ── Printable sheet ──────────────────────────────────────────────────────────
function Sheet({ inv, cfg, tenantName }: { inv: Inv; cfg: Config | undefined; tenantName: string }) {
  // Finalized invoices print the seller details they were issued with; drafts show the current settings.
  const seller: Seller = inv.seller ?? cfg?.seller ?? {};
  const sellerLines = addressLines(seller.address);
  const billLines = addressLines(inv.billTo.address);
  const meta: [string, string][] = [
    ["Invoice number", inv.number ?? "Assigned when finalized"],
    ["Issue date", fmtDate(inv.issueDate)],
    ["Due date", fmtDate(inv.dueDate)],
    ...(inv.serviceDate ? [["Delivery / service date", fmtDate(inv.serviceDate)] as [string, string]] : []),
    ...(inv.reference ? [["Your reference", inv.reference] as [string, string]] : []),
  ];
  const bank = [seller.bankName && `Bank: ${seller.bankName}`, seller.iban && `IBAN: ${seller.iban}`, seller.bic && `BIC: ${seller.bic}`].filter(Boolean) as string[];
  return (
    <Card id="invoice-sheet" className="p-6 sm:p-10">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="grid gap-3">
          {cfg?.logo && <img src={cfg.logo} alt={`${seller.name || tenantName} logo`} className="max-h-16 max-w-56 object-contain object-left" data-testid="invoice-logo" />}
          <div className="grid gap-0.5 text-sm">
            <p className="text-base font-semibold">{seller.name || tenantName}</p>
            {sellerLines.map((l) => <p key={l} className="text-muted-foreground">{l}</p>)}
            {[seller.email, seller.phone, seller.website].filter(Boolean).map((l) => <p key={l} className="text-muted-foreground">{l}</p>)}
          </div>
        </div>
        <div className="grid gap-2 text-right">
          <p className="text-2xl font-semibold tracking-tight">{inv.status === "draft" ? "Draft invoice" : "Invoice"}</p>
          {inv.number && <p className="font-mono text-sm" data-testid="invoice-number">{inv.number}</p>}
          {inv.status === "void" && <p className="text-sm font-semibold uppercase text-destructive">Void</p>}
        </div>
      </div>

      <div className="mt-8 grid gap-6 text-sm sm:grid-cols-2">
        <div className="grid content-start gap-0.5">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Bill to</p>
          <p className="font-medium">{inv.billTo.name}</p>
          {inv.billTo.contactName && <p>Attn. {inv.billTo.contactName}</p>}
          {billLines.map((l) => <p key={l} className="text-muted-foreground">{l}</p>)}
          {inv.billTo.email && <p className="text-muted-foreground">{inv.billTo.email}</p>}
          {inv.billTo.taxId && <p className="text-muted-foreground">VAT / tax ID {inv.billTo.taxId}</p>}
        </div>
        <dl className="grid content-start gap-1 sm:justify-self-end">
          {meta.map(([k, v]) => <div key={k} className="flex justify-between gap-8"><dt className="text-muted-foreground">{k}</dt><dd className="text-right">{v}</dd></div>)}
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

      {inv.notes && <p className="mt-8 whitespace-pre-line text-sm">{inv.notes}</p>}
      {(bank.length > 0 || seller.paymentInstructions) && inv.status !== "void" && (
        <div className="mt-6 grid gap-1 rounded-md border p-4 text-sm" data-testid="payment-box">
          <p className="font-semibold">How to pay</p>
          <p>Please pay {fmtMoney(inv.status === "draft" ? inv.totalCents : inv.balanceCents, inv.currency)} by {fmtDate(inv.dueDate)}{inv.number ? `, mentioning ${inv.number}` : ""}.</p>
          {bank.map((b) => <p key={b} className="font-mono text-xs sm:text-sm">{b}</p>)}
          {seller.paymentInstructions && <p className="whitespace-pre-line text-muted-foreground">{seller.paymentInstructions}</p>}
        </div>
      )}
      {(seller.taxId || seller.registrationNumber || seller.footer) && (
        <div className="mt-8 grid gap-1 border-t pt-4 text-xs text-muted-foreground">
          {(seller.taxId || seller.registrationNumber) && (
            <p>{[seller.taxId && `VAT / tax ID ${seller.taxId}`, seller.registrationNumber && `Company reg. ${seller.registrationNumber}`].filter(Boolean).join(" · ")}</p>
          )}
          {seller.footer && <p className="whitespace-pre-line">{seller.footer}</p>}
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
  const daysLate = Math.round((Date.now() - Date.parse(`${i.dueDate}T00:00:00Z`)) / 86_400_000);
  const missingProfile = !cfg.data?.seller.name && !i.seller?.name;

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast.success(ok); } catch (err) { toast.error(errorMessage(err)); throw err; }
  };
  const print = <Button variant="outline" onClick={() => window.print()}><Printer /> Print / save PDF</Button>;

  let next: ReactNode = null;
  if (i.status === "draft") {
    next = (
      <NextStep icon={<Lock />} title="Next: check the invoice below, then finalize it"
        action={can("invoicing:invoice.send") && <Button onClick={() => setDialog("send")}><CircleCheck /> Finalize invoice</Button>}>
        Finalizing gives it the next invoice number and locks it. Then print or save it as PDF and send it to your customer.
        {can("invoicing:invoice.write") && <> Something wrong? <button type="button" className="cursor-pointer underline" onClick={() => host.navigate(`/invoices/${i.id}/edit`)}>Edit the draft</button>.</>}
      </NextStep>
    );
  } else if (open) {
    next = (
      <NextStep icon={i.displayStatus === "overdue" ? <BellRing /> : <Banknote />}
        title={i.displayStatus === "overdue" ? `Overdue by ${daysLate} day${daysLate === 1 ? "" : "s"}: follow up` : `Waiting for payment: ${fmtMoney(i.balanceCents, i.currency)} due ${fmtDate(i.dueDate)}`}
        action={<>
          {print}
          {i.displayStatus === "overdue" && can("invoicing:invoice.send") && <Button variant="outline" onClick={() => setDialog("remind")}><BellRing /> Log reminder</Button>}
          {can("invoicing:invoice.write") && <Button onClick={() => setDialog("pay")}><Banknote /> Record payment</Button>}
        </>}>
        {i.displayStatus === "overdue"
          ? "Contact your customer, then log the reminder so it is on record. When money arrives, record the payment."
          : "Send the PDF to your customer if you have not yet. When their money arrives, record the payment here."}
      </NextStep>
    );
  } else if (i.status === "paid") {
    next = <NextStep icon={<CircleCheck />} title="Paid in full" action={print}>Nothing left to do. Payments are listed on the right.</NextStep>;
  }

  return (
    <>
      <style>{PRINT_CSS}</style>
      {back}
      <PageHeader
        className="mb-4"
        title={<span className="flex items-center gap-3">{i.number ?? "Draft invoice"} <StatusBadge status={i.displayStatus} /></span>}
        description={<>
          {i.billTo.name} · {fmtMoney(i.totalCents, i.currency)}
          {i.reminderCount > 0 && <> · {i.reminderCount} reminder{i.reminderCount === 1 ? "" : "s"} logged</>}
          {i.status === "void" && i.voidReason && <> · voided: {i.voidReason}</>}
        </>}
        actions={<>
          {i.status === "draft" && can("invoicing:invoice.write") && <>
            <Button variant="ghost" className="text-destructive" onClick={() => setDialog("delete")}><Trash2 /> Delete draft</Button>
            <Button variant="outline" onClick={() => host.navigate(`/invoices/${i.id}/edit`)}><Pencil /> Edit</Button>
          </>}
          {open && can("invoicing:invoice.write") && i.paidCents === 0 && <Button variant="ghost" onClick={() => setDialog("void")}><Ban /> Void</Button>}
          {open && i.displayStatus !== "overdue" && can("invoicing:invoice.send") && <Button variant="ghost" onClick={() => setDialog("remind")}><BellRing /> Log reminder</Button>}
          {i.status === "draft" && print}
        </>}
      />
      <div className="mb-4 grid gap-3">
        <Progress inv={i} />
        {next}
        {missingProfile && can("core:modules.manage") && i.status === "draft" && (
          <p className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            Your logo, address and bank details are not set up yet, so they are missing from the invoice.
            <Button size="sm" variant="outline" onClick={() => host.navigate("/settings")}><Settings2 /> Set up invoice details</Button>
          </p>
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <Sheet inv={i} cfg={cfg.data} tenantName={host.tenant.name} />
        <Card className="h-fit p-4">
          <p className="mb-3 text-sm font-semibold">Payments</p>
          {i.payments.length === 0 ? <p className="text-sm text-muted-foreground">{i.status === "draft" ? "You can record payments once the invoice is finalized." : "No payments yet."}</p> : (
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
      <ConfirmDialog open={dialog === "send"} onOpenChange={(o) => !o && setDialog(null)} confirmLabel="Finalize invoice"
        title="Finalize this invoice?" description="It gets the next invoice number and can no longer be edited. Nothing is emailed: print or save it as PDF and send it to your customer yourself."
        onConfirm={() => act(async () => done(await host.api.post<Inv>(`/invoices/${i.id}/send`)), "Invoice finalized")} />
      <ConfirmDialog open={dialog === "remind"} onOpenChange={(o) => !o && setDialog(null)} confirmLabel="Log reminder"
        title="Log a payment reminder?" description="Use this after you have reminded the customer. It is kept on the invoice and can trigger your automations (Workflows)."
        onConfirm={() => act(async () => { await host.api.post(`/invoices/${i.id}/remind`); await inv.reload(); setCurrent(null); }, "Reminder logged")} />
      <ConfirmDialog open={dialog === "delete"} onOpenChange={(o) => !o && setDialog(null)} destructive confirmLabel="Delete draft"
        title="Delete this draft?" description="Drafts have no number yet, so nothing is lost from your numbering."
        onConfirm={() => act(async () => { await host.api.del(`/invoices/${i.id}`); host.navigate("/invoices"); }, "Draft deleted")} />
    </>
  );
}
