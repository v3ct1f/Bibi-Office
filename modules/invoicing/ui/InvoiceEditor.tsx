import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, Building2, Plus, Trash2, User, X } from "lucide-react";
import { Button, Card, ErrorState, DatePicker, Field, Input, PageHeader, Select, Skeleton, Textarea, toast } from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import { addDays, invoiceTotals, lineTotals } from "../src/money.ts";
import {
  centsToInput, CURRENCIES, errorMessage, fmtMoney, parseMoney, useDebounced, useLoad,
  type BillTo, type Config, type Invoice, type InvoiceDetail,
} from "./shared.tsx";

interface Customer { companyId: string | null; contactId: string | null; label: string; kind: "company" | "contact" }
interface LineDraft { description: string; quantity: string; unitPrice: string; taxRate: string }
interface BillDraft { name: string; contactName: string; email: string; taxId: string; line1: string; line2: string; postalCode: string; city: string; country: string }

const EMPTY_BILL: BillDraft = { name: "", contactName: "", email: "", taxId: "", line1: "", line2: "", postalCode: "", city: "", country: "" };
const TERMS = [0, 7, 14, 30, 45, 60, 90];

const billFrom = (b: BillTo): BillDraft => ({
  name: b.name ?? "", contactName: b.contactName ?? "", email: b.email ?? "", taxId: b.taxId ?? "",
  line1: b.address?.line1 ?? "", line2: b.address?.line2 ?? "", postalCode: b.address?.postalCode ?? "",
  city: b.address?.city ?? "", country: b.address?.country ?? "",
});

function parseLine(l: LineDraft) {
  const quantity = Number(l.quantity.replace(",", "."));
  const unitPriceCents = parseMoney(l.unitPrice);
  const taxRate = Number(l.taxRate.replace(",", ".") || "0");
  if (!l.description.trim() || !(quantity > 0) || unitPriceCents === null || !(taxRate >= 0 && taxRate <= 100)) return null;
  try {
    return { description: l.description.trim(), quantity, unitPriceCents, taxRate, ...lineTotals({ quantity, unitPriceCents, taxRate }) };
  } catch { return null; }
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

function Step({ n, title, description, children }: { n: number; title: string; description?: string; children: ReactNode }) {
  return (
    <Card className="grid gap-4 p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{n}</span>
        <div className="grid gap-0.5">
          <h2 className="font-semibold leading-6">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {children}
    </Card>
  );
}

function CustomerPicker({ value, onChange }: { value: Customer | null; onChange: (c: Customer | null) => void }) {
  const host = useModuleHost();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const results = useLoad(async () => {
    if (!dq) return [] as Customer[];
    type Co = { id: string; name: string };
    type Ct = { id: string; firstName: string | null; lastName: string | null; email: string | null };
    const [co, ct] = await Promise.all([
      host.can("core:companies.read") ? host.core.get<{ data: Co[] }>("/companies", { q: dq, limit: 5 }) : { data: [] as Co[] },
      host.can("core:contacts.read") ? host.core.get<{ data: Ct[] }>("/contacts", { q: dq, limit: 5 }) : { data: [] as Ct[] },
    ]);
    return [
      ...co.data.map((c): Customer => ({ companyId: c.id, contactId: null, label: c.name, kind: "company" })),
      ...ct.data.map((c): Customer => ({
        companyId: null, contactId: c.id, kind: "contact",
        label: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unnamed contact",
      })),
    ];
  }, [host, dq]);

  if (value) {
    return (
      <div className="flex h-9 items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 text-sm">
        <span className="flex items-center gap-2 truncate">
          {value.kind === "company" ? <Building2 className="size-4 text-muted-foreground" /> : <User className="size-4 text-muted-foreground" />}
          <span className="truncate font-medium" data-testid="selected-customer">{value.label}</span>
        </span>
        <Button variant="ghost" size="sm" className="h-7" aria-label="Change customer" onClick={() => onChange(null)}><X /> Change</Button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input aria-label="Customer search" placeholder="Start typing a company or contact name…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {dq && (
        <div role="listbox" aria-label="Customers" className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-surface shadow-md">
          {results.loading && !results.data?.length ? <p className="p-3 text-sm text-muted-foreground">Searching…</p>
            : !results.data?.length ? (
              <p className="p-3 text-sm text-muted-foreground">
                No companies or contacts match “{dq}”. Add them under <a className="underline" href={`/t/${host.tenant.slug}/companies?new=1`}>Companies</a> first.
              </p>
            )
            : results.data.map((c) => (
              <button
                key={`${c.kind}:${c.companyId ?? c.contactId}`} type="button" role="option" aria-selected={false}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => { onChange(c); setQ(""); }}
              >
                {c.kind === "company" ? <Building2 className="size-4 text-muted-foreground" /> : <User className="size-4 text-muted-foreground" />}
                {c.label}<span className="ml-auto text-xs text-muted-foreground">{c.kind}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

const customerFrom = (inv: { companyId: string | null; contactId: string | null; billTo: BillTo }): Customer => ({
  companyId: inv.companyId, contactId: inv.companyId ? null : inv.contactId,
  label: inv.billTo.name, kind: inv.companyId ? "company" : "contact",
});

export function InvoiceEditor({ params }: PageProps) {
  const host = useModuleHost();
  const id = params.id;
  const config = useLoad(() => host.api.get<Config>("/config"), [host]);
  const existing = useLoad(() => (id ? host.api.get<InvoiceDetail>(`/invoices/${id}`) : Promise.resolve(null)), [host, id]);

  const [customer, setCustomerState] = useState<Customer | null>(null);
  const [bill, setBill] = useState<BillDraft>(EMPTY_BILL);
  const [currency, setCurrency] = useState("EUR");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [terms, setTerms] = useState<string>("30");
  const [dueDate, setDueDate] = useState("");
  const [serviceDate, setServiceDate] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);

  /** Picking a customer fills billing details: their last invoice's details first, else the saved record. */
  const setCustomer = async (c: Customer | null) => {
    setCustomerState(c);
    if (!c) { setBill(EMPTY_BILL); return; }
    setBill({ ...EMPTY_BILL, name: c.label });
    try {
      const key = c.companyId ? "companyId" : "contactId";
      const last = (await host.api.get<{ data: Invoice[] }>("/invoices", { [key]: c.companyId ?? c.contactId!, limit: 1 })).data[0];
      if (last) return setBill(billFrom(last.billTo));
      if (c.companyId) {
        const co = await host.core.get<{ name: string; taxId: string | null }>(`/companies/${c.companyId}`);
        setBill({ ...EMPTY_BILL, name: co.name, taxId: co.taxId ?? "" });
      } else {
        const ct = await host.core.get<{ email: string | null }>(`/contacts/${c.contactId}`);
        setBill({ ...EMPTY_BILL, name: c.label, email: ct.email ?? "" });
      }
    } catch { /* keep what we have */ }
  };

  useEffect(() => {
    if (ready || !config.data || existing.loading) return;
    const c = config.data;
    const inv = existing.data;
    if (inv) {
      setCustomerState(customerFrom(inv)); setBill(billFrom(inv.billTo));
      setCurrency(inv.currency); setIssueDate(inv.issueDate); setDueDate(inv.dueDate);
      const d = daysBetween(inv.issueDate, inv.dueDate);
      setTerms(TERMS.includes(d) ? String(d) : "custom");
      setServiceDate(inv.serviceDate ?? ""); setReference(inv.reference ?? ""); setNotes(inv.notes ?? "");
      setLines(inv.lines.map((l) => ({ description: l.description, quantity: String(l.quantity), unitPrice: centsToInput(l.unitPriceCents), taxRate: String(l.taxRate) })));
    } else {
      setCurrency(c.currency); setDueDate(c.defaultDueDate);
      setTerms(TERMS.includes(c.paymentTermDays) ? String(c.paymentTermDays) : "custom");
      setLines([{ description: "", quantity: "1", unitPrice: "", taxRate: String(c.defaultTaxRate) }]);
      // Prefill from ?companyId= / ?contactId= (e.g. "New invoice" on a company page).
      const sp = new URLSearchParams(window.location.search);
      const coId = sp.get("companyId"), ctId = sp.get("contactId");
      if (coId) void host.core.get<{ id: string; name: string }>(`/companies/${coId}`).then((x) => setCustomer({ companyId: x.id, contactId: null, label: x.name, kind: "company" })).catch(() => {});
      else if (ctId) void host.core.get<{ id: string; firstName: string | null; lastName: string | null; email: string | null }>(`/contacts/${ctId}`)
        .then((x) => setCustomer({ companyId: null, contactId: x.id, kind: "contact", label: [x.firstName, x.lastName].filter(Boolean).join(" ") || x.email || "Contact" })).catch(() => {});
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, config.data, existing.loading, existing.data, host]);

  const priced = lines.map(parseLine);
  const totals = (() => {
    try { return invoiceTotals(priced.filter((p): p is NonNullable<typeof p> => !!p)); } catch { return { subtotalCents: 0, taxCents: 0, totalCents: 0 }; }
  })();

  const setLine = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const setB = (k: keyof BillDraft) => (e: { target: { value: string } }) => setBill((b) => ({ ...b, [k]: e.target.value }));
  const back = id ? `/invoices/${id}` : "/invoices";
  const changeIssue = (d: string) => { setIssueDate(d); if (terms !== "custom" && d) setDueDate(addDays(d, Number(terms))); };
  const changeTerms = (t: string) => { setTerms(t); if (t !== "custom" && issueDate) setDueDate(addDays(issueDate, Number(t))); };

  if (config.error || existing.error) return <ErrorState error={config.error ?? existing.error} onRetry={() => { void config.reload(); void existing.reload(); }} />;
  if (!ready) return <><Skeleton className="h-8 w-56" /><Skeleton className="mt-6 h-72" /></>;
  if (existing.data && existing.data.status !== "draft") {
    return <ErrorState title="This invoice can no longer be edited" error="Finalized invoices are locked. Void it and create a new one instead." />;
  }

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!customer) return toast.error("Step 1: choose who you are billing");
    const bad = priced.findIndex((p, i) => !p && (lines[i]!.description || lines[i]!.unitPrice));
    if (bad >= 0) return toast.error(`Item ${bad + 1} is incomplete: it needs a description, a quantity above 0 and a price`);
    if (dueDate && dueDate < issueDate) return toast.error("The due date cannot be before the issue date");
    const body = {
      companyId: customer.companyId, contactId: customer.contactId, currency, issueDate, dueDate: dueDate || undefined,
      serviceDate: serviceDate || null, reference: reference.trim() || null, notes: notes.trim() || null,
      billTo: {
        name: bill.name.trim(), contactName: bill.contactName.trim(), email: bill.email.trim(), taxId: bill.taxId.trim(),
        address: { line1: bill.line1.trim(), line2: bill.line2.trim(), postalCode: bill.postalCode.trim(), city: bill.city.trim(), country: bill.country.trim() },
      },
      lines: priced.filter((p): p is NonNullable<typeof p> => !!p).map(({ description, quantity, unitPriceCents, taxRate }) => ({ description, quantity, unitPriceCents, taxRate })),
    };
    setSaving(true);
    try {
      const r = id ? await host.api.patch<InvoiceDetail>(`/invoices/${id}`, body) : await host.api.post<InvoiceDetail>("/invoices", body);
      toast.success(id ? "Draft saved" : "Draft saved. Review it, then finalize.");
      host.navigate(`/invoices/${r.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally { setSaving(false); }
  };

  const billField = (k: keyof BillDraft, label: string, cls = "", props: { type?: string; max?: number } = {}) => (
    <Field label={label} className={cls}>
      {(a) => <Input {...a} type={props.type ?? "text"} value={bill[k]} onChange={setB(k)} maxLength={props.max ?? 200} />}
    </Field>
  );

  return (
    <form onSubmit={save} className="grid gap-4">
      <a href={host.href(back)} onClick={(e) => { e.preventDefault(); host.navigate(back); }} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {id ? "Back to invoice" : "Invoices"}
      </a>
      <PageHeader
        className="mb-2"
        title={id ? "Edit draft invoice" : "New invoice"}
        description="Fill in the three steps and save a draft. Nothing is sent and no number is used until you finalize it."
        actions={<>
          <Button variant="outline" type="button" onClick={() => host.navigate(back)}>Cancel</Button>
          <Button type="submit" loading={saving}>Save draft</Button>
        </>}
      />

      <Step n={1} title="Who are you billing?" description="Pick a company or contact. The billing details below are printed on the invoice; change them here for this invoice only.">
        <Field label="Customer" required>{() => <CustomerPicker value={customer} onChange={(c) => void setCustomer(c)} />}</Field>
        {customer && (
          <div className="grid gap-4 rounded-md border p-4 sm:grid-cols-2" aria-label="Billing details">
            {billField("name", "Bill to (name on invoice)", "sm:col-span-2")}
            {billField("contactName", "Attention of")}
            {billField("email", "Email", "", { type: "email" })}
            {billField("line1", "Address line 1", "sm:col-span-2")}
            {billField("line2", "Address line 2", "sm:col-span-2")}
            {billField("postalCode", "Postal code", "", { max: 20 })}
            {billField("city", "City", "", { max: 100 })}
            {billField("country", "Country", "", { max: 100 })}
            {billField("taxId", "Customer VAT / tax ID", "", { max: 50 })}
          </div>
        )}
      </Step>

      <Step n={2} title="Invoice details" description="Dates, payment terms and any reference your customer asked for.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Issue date">{(a) => <DatePicker {...a} value={issueDate} onChange={(iso) => changeIssue(iso)} required />}</Field>
          <Field label="Payment terms">{(a) => (
            <Select {...a} value={terms} onChange={(e) => changeTerms(e.target.value)}>
              {TERMS.map((d) => <option key={d} value={d}>{d === 0 ? "Due on receipt" : `${d} days`}</option>)}
              <option value="custom">Custom due date</option>
            </Select>
          )}</Field>
          <Field label="Due date">{(a) => <DatePicker {...a} value={dueDate} min={issueDate} onChange={(iso) => { setDueDate(iso); setTerms("custom"); }} />}</Field>
          <Field label="Delivery / service date" hint="Optional. When the work was done or goods delivered.">
            {(a) => <DatePicker {...a} value={serviceDate} onChange={(iso) => setServiceDate(iso)} />}
          </Field>
          <Field label="Customer reference / PO number" hint="Optional. Many companies require their PO number on invoices.">
            {(a) => <Input {...a} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />}
          </Field>
          <Field label="Currency">{(a) => (
            <Select {...a} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {[...new Set([currency, ...CURRENCIES])].map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          )}</Field>
        </div>
      </Step>

      <Step n={3} title="What are you billing for?" description="One line per product or service. Prices are before tax.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-2 font-medium">Description</th>
                <th className="w-24 px-2 py-2 font-medium">Qty</th>
                <th className="w-32 px-2 py-2 font-medium">Unit price</th>
                <th className="w-24 px-2 py-2 font-medium">Tax %</th>
                <th className="w-32 px-2 py-2 text-right font-medium">Amount</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const p = priced[i];
                return (
                  <tr key={i} className="border-b align-top last:border-0">
                    <td className="py-2 pr-2"><Input aria-label={`Line ${i + 1} description`} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="e.g. Website design, 10 hours" /></td>
                    <td className="px-2 py-2"><Input aria-label={`Line ${i + 1} quantity`} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></td>
                    <td className="px-2 py-2"><Input aria-label={`Line ${i + 1} unit price`} inputMode="decimal" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} placeholder="0.00" /></td>
                    <td className="px-2 py-2"><Input aria-label={`Line ${i + 1} tax rate`} inputMode="decimal" value={l.taxRate} onChange={(e) => setLine(i, { taxRate: e.target.value })} /></td>
                    <td className="px-2 py-2 pt-4 text-right tabular-nums">{p ? fmtMoney(p.netCents, currency) : "—"}</td>
                    <td className="py-2 pl-1">
                      <Button type="button" variant="ghost" size="icon" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1}
                        onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 /></Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Button type="button" variant="outline" size="sm" className="mt-2"
            onClick={() => setLines((ls) => [...ls, { description: "", quantity: "1", unitPrice: "", taxRate: String(config.data?.defaultTaxRate ?? 0) }])}>
            <Plus /> Add line
          </Button>
        </div>
        <div className="grid gap-5 border-t pt-4 sm:grid-cols-2">
          <Field label="Note to customer" hint="Optional. Printed above the payment details.">{(a) => <Textarea {...a} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />}</Field>
          <dl className="grid content-start gap-1.5 text-sm sm:min-w-64 sm:justify-self-end" aria-label="Totals">
            <div className="flex justify-between gap-8"><dt className="text-muted-foreground">Subtotal</dt><dd className="tabular-nums">{fmtMoney(totals.subtotalCents, currency)}</dd></div>
            <div className="flex justify-between gap-8"><dt className="text-muted-foreground">Tax</dt><dd className="tabular-nums">{fmtMoney(totals.taxCents, currency)}</dd></div>
            <div className="flex justify-between gap-8 border-t pt-1.5 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums" data-testid="editor-total">{fmtMoney(totals.totalCents, currency)}</dd></div>
          </dl>
        </div>
      </Step>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <p className="mr-auto text-sm text-muted-foreground">Next: review the draft, then finalize it to get an invoice number.</p>
        <Button variant="outline" type="button" onClick={() => host.navigate(back)}>Cancel</Button>
        <Button type="submit" loading={saving}>Save draft</Button>
      </div>
    </form>
  );
}
