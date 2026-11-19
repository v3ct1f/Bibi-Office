import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Building2, Plus, Trash2, User, X } from "lucide-react";
import { Button, Card, ErrorState, Field, Input, PageHeader, Select, Skeleton, Textarea, toast } from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import { invoiceTotals, lineTotals } from "../src/money.ts";
import {
  centsToInput, errorMessage, fmtMoney, parseMoney, useDebounced, useLoad, type BillTo, type Config, type InvoiceDetail,
} from "./shared.tsx";

interface Customer { companyId: string | null; contactId: string | null; label: string; kind: "company" | "contact" }
interface LineDraft { description: string; quantity: string; unitPrice: string; taxRate: string }

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "CAD", "AUD", "JPY"];

function parseLine(l: LineDraft) {
  const quantity = Number(l.quantity.replace(",", "."));
  const unitPriceCents = parseMoney(l.unitPrice);
  const taxRate = Number(l.taxRate.replace(",", ".") || "0");
  if (!l.description.trim() || !(quantity > 0) || unitPriceCents === null || !(taxRate >= 0 && taxRate <= 100)) return null;
  try {
    return { description: l.description.trim(), quantity, unitPriceCents, taxRate, ...lineTotals({ quantity, unitPriceCents, taxRate }) };
  } catch { return null; }
}

function CustomerPicker({ value, onChange }: { value: Customer | null; onChange: (c: Customer | null) => void }) {
  const host = useModuleHost();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const results = useLoad(async () => {
    if (!dq) return [] as Customer[];
    type Co = { id: string; name: string };
    type Ct = { id: string; firstName: string | null; lastName: string | null; email: string | null; companyId: string | null };
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
      <div className="flex h-9 items-center justify-between gap-2 rounded-md border px-3 text-sm">
        <span className="flex items-center gap-2 truncate">
          {value.kind === "company" ? <Building2 className="size-4 text-muted-foreground" /> : <User className="size-4 text-muted-foreground" />}
          <span className="truncate" data-testid="selected-customer">{value.label}</span>
        </span>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Change customer" onClick={() => onChange(null)}><X /></Button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input aria-label="Customer search" placeholder="Search companies and contacts" value={q} onChange={(e) => setQ(e.target.value)} />
      {dq && (
        <div role="listbox" aria-label="Customers" className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-surface shadow-md">
          {results.loading && !results.data?.length ? <p className="p-3 text-sm text-muted-foreground">Searching…</p>
            : !results.data?.length ? <p className="p-3 text-sm text-muted-foreground">No companies or contacts match “{dq}”.</p>
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

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [currency, setCurrency] = useState("EUR");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready || !config.data || existing.loading) return;
    const c = config.data;
    const inv = existing.data;
    if (inv) {
      setCustomer(customerFrom(inv)); setCurrency(inv.currency); setIssueDate(inv.issueDate); setDueDate(inv.dueDate);
      setNotes(inv.notes ?? "");
      setLines(inv.lines.map((l) => ({ description: l.description, quantity: String(l.quantity), unitPrice: centsToInput(l.unitPriceCents), taxRate: String(l.taxRate) })));
    } else {
      setCurrency(c.currency); setDueDate(c.defaultDueDate);
      setLines([{ description: "", quantity: "1", unitPrice: "", taxRate: String(c.defaultTaxRate) }]);
      // Prefill from ?companyId= / ?contactId= (e.g. "New invoice" on a company page).
      const sp = new URLSearchParams(window.location.search);
      const coId = sp.get("companyId"), ctId = sp.get("contactId");
      if (coId) void host.core.get<{ id: string; name: string }>(`/companies/${coId}`).then((x) => setCustomer({ companyId: x.id, contactId: null, label: x.name, kind: "company" })).catch(() => {});
      else if (ctId) void host.core.get<{ id: string; firstName: string | null; lastName: string | null; email: string | null }>(`/contacts/${ctId}`)
        .then((x) => setCustomer({ companyId: null, contactId: x.id, kind: "contact", label: [x.firstName, x.lastName].filter(Boolean).join(" ") || x.email || "Contact" })).catch(() => {});
    }
    setReady(true);
  }, [ready, config.data, existing.loading, existing.data, host]);

  const priced = lines.map(parseLine);
  const totals = (() => {
    try { return invoiceTotals(priced.filter((p): p is NonNullable<typeof p> => !!p)); } catch { return { subtotalCents: 0, taxCents: 0, totalCents: 0 }; }
  })();

  const setLine = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const back = id ? `/invoices/${id}` : "/invoices";

  if (config.error || existing.error) return <ErrorState error={config.error ?? existing.error} onRetry={() => { void config.reload(); void existing.reload(); }} />;
  if (!ready) return <><Skeleton className="h-8 w-56" /><Skeleton className="mt-6 h-72" /></>;
  if (existing.data && existing.data.status !== "draft") {
    return <ErrorState title="This invoice can no longer be edited" error="Only drafts can be changed. Void it and create a new one instead." />;
  }

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!customer) return toast.error("Choose who to bill");
    const bad = priced.findIndex((p, i) => !p && (lines[i]!.description || lines[i]!.unitPrice));
    if (bad >= 0) return toast.error(`Line ${bad + 1} is incomplete: it needs a description, a quantity above 0 and a price`);
    if (dueDate && dueDate < issueDate) return toast.error("The due date cannot be before the issue date");
    const body = {
      companyId: customer.companyId, contactId: customer.contactId, currency, issueDate, dueDate: dueDate || undefined,
      notes: notes.trim() || null,
      lines: priced.filter((p): p is NonNullable<typeof p> => !!p).map(({ description, quantity, unitPriceCents, taxRate }) => ({ description, quantity, unitPriceCents, taxRate })),
    };
    setSaving(true);
    try {
      const r = id ? await host.api.patch<InvoiceDetail>(`/invoices/${id}`, body) : await host.api.post<InvoiceDetail>("/invoices", body);
      toast.success(id ? "Draft saved" : "Draft invoice created");
      host.navigate(`/invoices/${r.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={save}>
      <a href={host.href(back)} onClick={(e) => { e.preventDefault(); host.navigate(back); }} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {id ? "Back to invoice" : "Invoices"}
      </a>
      <PageHeader
        title={id ? "Edit draft invoice" : "New invoice"}
        description="Drafts can be changed freely. The invoice number is assigned when you send it."
        actions={<>
          <Button variant="outline" type="button" onClick={() => host.navigate(back)}>Cancel</Button>
          <Button type="submit" loading={saving}>{id ? "Save draft" : "Create draft"}</Button>
        </>}
      />
      <Card className="grid gap-5 p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Bill to" required className="sm:col-span-2">{() => <CustomerPicker value={customer} onChange={setCustomer} />}</Field>
          <Field label="Issue date">{(a) => <Input {...a} type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} required />}</Field>
          <Field label="Due date">{(a) => <Input {...a} type="date" value={dueDate} min={issueDate} onChange={(e) => setDueDate(e.target.value)} />}</Field>
          <Field label="Currency">{(a) => (
            <Select {...a} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {[...new Set([currency, ...CURRENCIES])].map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          )}</Field>
        </div>

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
                    <td className="py-2 pr-2"><Input aria-label={`Line ${i + 1} description`} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="What you are billing for" /></td>
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
          <Button type="button" variant="ghost" size="sm" className="mt-2"
            onClick={() => setLines((ls) => [...ls, { description: "", quantity: "1", unitPrice: "", taxRate: String(config.data?.defaultTaxRate ?? 0) }])}>
            <Plus /> Add line
          </Button>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Notes" hint="Shown on the invoice.">{(a) => <Textarea {...a} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />}</Field>
          <dl className="grid content-start gap-1.5 text-sm sm:justify-self-end sm:min-w-64" aria-label="Totals">
            <div className="flex justify-between gap-8"><dt className="text-muted-foreground">Subtotal</dt><dd className="tabular-nums">{fmtMoney(totals.subtotalCents, currency)}</dd></div>
            <div className="flex justify-between gap-8"><dt className="text-muted-foreground">Tax</dt><dd className="tabular-nums">{fmtMoney(totals.taxCents, currency)}</dd></div>
            <div className="flex justify-between gap-8 border-t pt-1.5 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums" data-testid="editor-total">{fmtMoney(totals.totalCents, currency)}</dd></div>
          </dl>
        </div>
      </Card>
    </form>
  );
}
