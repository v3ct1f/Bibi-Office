import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Button, Card, CardContent, CardHeader, CardTitle, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner,
  Table, TBody, TD, Textarea, TH, THead, TR, cn,
} from "@office/ui";
import type { SlotProps } from "@office/sdk/ui";
import { computeLine, computeTotals } from "../src/money.ts";
import { fmtDay, money, P, parseMoney, ROOT, StatusBadge, toMajor } from "./common.tsx";
import type { CompanyLite, ContactLite, Invoice, InvoiceFull, Page } from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** /m/invoicing/invoices[/new[/<contactId>] | /<id> | /<id>/edit] */
export function InvoicesPage(props: SlotProps) {
  const seg = (props.subPath ?? "").split("/").filter(Boolean);
  if (seg[0] === "new") return <InvoiceEditor {...props} {...(seg[1] && UUID.test(seg[1]) ? { prefillContact: seg[1] } : {})} />;
  if (seg[0] && UUID.test(seg[0])) return seg[1] === "edit" ? <InvoiceEditor {...props} id={seg[0]} /> : <InvoiceDetail {...props} id={seg[0]} />;
  if (seg.length) return <EmptyState title="Page not found" />;
  return <InvoiceList {...props} />;
}

const FILTERS = [["", "All"], ["draft", "Drafts"], ["open", "Open"], ["overdue", "Overdue"], ["paid", "Paid"], ["void", "Void"]] as const;

function InvoiceList({ api, tenantId, can, navigate, errorMessage }: SlotProps) {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const list = useInfiniteQuery({
    queryKey: ["tenant", tenantId, "invoicing", "invoices", { status, q }],
    initialPageParam: "",
    queryFn: ({ pageParam }) => api.get<Page<Invoice>>(`/invoices?limit=25${status ? `&status=${status}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}${pageParam ? `&cursor=${pageParam}` : ""}`),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <>
      <PageHeader title="Invoices" description="Create, issue and track invoices and payments."
        actions={can(P.write) && <Button onClick={() => navigate(`${ROOT}/new`)}>New invoice</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Filter by status" className="flex flex-wrap gap-1">
          {FILTERS.map(([v, label]) => (
            <Button key={v} role="tab" aria-selected={status === v} size="sm" variant={status === v ? "secondary" : "ghost"} onClick={() => setStatus(v)}>{label}</Button>
          ))}
        </div>
        <Input aria-label="Search invoices" placeholder="Search number or customer" className="max-w-xs sm:ml-auto" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {list.isPending ? <Spinner /> : list.isError ? <Alert>{errorMessage(list.error)}</Alert> : rows.length === 0 ? (
        <EmptyState title={q || status ? "No matching invoices" : "No invoices yet"}>{!q && !status && can(P.write) && "Create your first invoice to get started."}</EmptyState>
      ) : (
        <Card>
          <Table>
            <THead><TR>
              <TH>Number</TH><TH>Customer</TH><TH className="hidden md:table-cell">Issued</TH><TH className="hidden sm:table-cell">Due</TH>
              <TH className="text-right">Total</TH><TH className="hidden sm:table-cell text-right">Balance</TH><TH>Status</TH>
            </TR></THead>
            <TBody>{rows.map((i) => (
              <TR key={i.id} className="cursor-pointer" onClick={() => navigate(`${ROOT}/${i.id}`)}>
                <TD className="font-medium"><a href={`${ROOT}/${i.id}`} onClick={(e) => { e.preventDefault(); navigate(`${ROOT}/${i.id}`); }}>{i.number ?? "Draft"}</a></TD>
                <TD>{i.customer?.name ?? <span className="text-muted">—</span>}</TD>
                <TD className="hidden md:table-cell">{fmtDay(i.issueDate)}</TD><TD className="hidden sm:table-cell">{fmtDay(i.dueDate)}</TD>
                <TD className="text-right tabular-nums">{money(i.total, i.currency)}</TD>
                <TD className="hidden sm:table-cell text-right tabular-nums">{i.status === "open" ? money(i.balance, i.currency) : "—"}</TD>
                <TD><StatusBadge inv={i} /></TD>
              </TR>
            ))}</TBody>
          </Table>
          {list.hasNextPage && <div className="p-3"><Button variant="outline" size="sm" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>Load more</Button></div>}
        </Card>
      )}
    </>
  );
}

// ───────────────────────── detail ─────────────────────────
function InvoiceDetail({ api, tenantId, can, navigate, errorMessage, id }: SlotProps & { id: string }) {
  const qc = useQueryClient();
  const key = ["tenant", tenantId, "invoicing"];
  const q = useQuery({ queryKey: [...key, "invoice", id], queryFn: () => api.get<InvoiceFull>(`/invoices/${id}`) });
  const [err, setErr] = useState<string>();
  const [dialog, setDialog] = useState<"pay" | "void" | null>(null);
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onMutate: () => setErr(undefined),
    onSuccess: (data) => { if (data && typeof data === "object" && "id" in data) qc.setQueryData([...key, "invoice", id], data); void qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => setErr(errorMessage(e)),
  });
  const download = async () => {
    try {
      const blob = await api.blob(`/invoices/${id}/pdf`);
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: `${q.data?.number ?? "draft"}.pdf` });
      a.click(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) { setErr(errorMessage(e)); }
  };
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert>{errorMessage(q.error)}</Alert>;
  const inv = q.data;
  const busy = act.isPending;
  return (
    <>
      <PageHeader
        title={inv.number ? `Invoice ${inv.number}` : "Draft invoice"}
        description={<span className="inline-flex items-center gap-2"><StatusBadge inv={inv} />{inv.customer?.name ?? ""}</span>}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={download}>Download PDF</Button>
            {inv.status === "draft" && can(P.write) && <Button variant="outline" onClick={() => navigate(`${ROOT}/${id}/edit`)}>Edit</Button>}
            {inv.status === "draft" && can(P.send) && <Button disabled={busy} onClick={() => act.mutate(() => api.post(`/invoices/${id}/issue`))}>Issue</Button>}
            {inv.status === "open" && can(P.pay) && <Button onClick={() => setDialog("pay")}>Record payment</Button>}
            {inv.status !== "void" && inv.status !== "draft" && !inv.sentAt && can(P.send) && <Button variant="outline" disabled={busy} onClick={() => act.mutate(() => api.post(`/invoices/${id}/send`))}>Mark as sent</Button>}
            {inv.status === "open" && can(P.send) && <Button variant="outline" disabled={busy} onClick={() => act.mutate(() => api.post(`/invoices/${id}/remind`))}>Send reminder</Button>}
            {inv.status === "open" && inv.amountPaid === 0 && can(P.void) && <Button variant="danger" onClick={() => setDialog("void")}>Void</Button>}
            {inv.status === "draft" && can(P.write) && <Button variant="danger" disabled={busy}
              onClick={() => act.mutate(async () => { await api.del(`/invoices/${id}`); navigate(ROOT); })}>Delete draft</Button>}
          </div>
        } />
      {err && <div className="mb-4"><Alert>{err}</Alert></div>}
      {inv.status === "void" && <div className="mb-4"><Alert tone="warning">Voided: {inv.voidReason}</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Items</CardTitle></CardHeader>
          <Table>
            <THead><TR><TH>Description</TH><TH className="text-right">Qty</TH><TH className="hidden sm:table-cell text-right">Unit price</TH><TH className="hidden sm:table-cell text-right">Tax</TH><TH className="text-right">Amount</TH></TR></THead>
            <TBody>{inv.lines.map((l, i) => (
              <TR key={l.id ?? i}>
                <TD>{l.description}</TD><TD className="text-right tabular-nums">{l.quantity}</TD>
                <TD className="hidden sm:table-cell text-right tabular-nums">{money(l.unitPrice, inv.currency)}</TD>
                <TD className="hidden sm:table-cell text-right tabular-nums">{l.taxRate}%</TD>
                <TD className="text-right tabular-nums">{money(l.net ?? 0, inv.currency)}</TD>
              </TR>
            ))}</TBody>
          </Table>
          <CardContent><Totals inv={inv} /></CardContent>
        </Card>
        <div className="grid content-start gap-4">
          <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-muted">Issued</dt><dd>{fmtDay(inv.issueDate)}</dd>
                <dt className="text-muted">Due</dt><dd className={cn(inv.overdue && "font-medium text-danger")}>{fmtDay(inv.dueDate)}</dd>
                <dt className="text-muted">Sent</dt><dd>{inv.sentAt ? new Date(inv.sentAt).toLocaleDateString() : "—"}</dd>
                <dt className="text-muted">Reminders</dt><dd>{inv.reminderCount}</dd>
                {inv.customer && <><dt className="text-muted">Bill to</dt><dd>{[inv.customer.name, inv.customer.address, inv.customer.taxId, inv.customer.email].filter(Boolean).join(", ")}</dd></>}
              </dl>
              {inv.notes && <p className="mt-3 whitespace-pre-wrap text-sm">{inv.notes}</p>}
            </CardContent>
          </Card>
          {inv.payments.length > 0 && (
            <Card><CardHeader><CardTitle>Payments</CardTitle></CardHeader>
              <CardContent className="grid gap-1 text-sm">
                {inv.payments.map((p) => (
                  <div key={p.id} className="flex justify-between gap-2"><span>{fmtDay(p.paidOn)} · {p.method.replace("_", " ")}{p.reference ? ` · ${p.reference}` : ""}</span><span className="tabular-nums">{money(p.amount, inv.currency)}</span></div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      {dialog === "pay" && <PaymentDialog inv={inv} onClose={() => setDialog(null)} onSubmit={(body) => act.mutateAsync(() => api.post(`/invoices/${id}/payments`, body))} errorMessage={errorMessage} />}
      {dialog === "void" && <VoidDialog onClose={() => setDialog(null)} onSubmit={(reason) => act.mutateAsync(() => api.post(`/invoices/${id}/void`, { reason }))} errorMessage={errorMessage} />}
    </>
  );
}

function Totals({ inv }: { inv: Pick<Invoice, "subtotal" | "taxTotal" | "total" | "amountPaid" | "currency" | "status"> & { balance?: number } }) {
  const row = (k: string, v: number, strong = false) => (
    <div className={cn("flex justify-between gap-4", strong && "font-semibold")}><span className={strong ? "" : "text-muted"}>{k}</span><span className="tabular-nums">{money(v, inv.currency)}</span></div>
  );
  return (
    <div className="ml-auto grid max-w-xs gap-1 text-sm" data-testid="totals">
      {row("Subtotal", inv.subtotal)}{row("Tax", inv.taxTotal)}{row("Total", inv.total, true)}
      {inv.amountPaid > 0 && <>{row("Paid", -inv.amountPaid)}{row("Balance due", inv.total - inv.amountPaid, true)}</>}
    </div>
  );
}

function PaymentDialog({ inv, onClose, onSubmit, errorMessage }: { inv: InvoiceFull; onClose(): void; onSubmit(b: unknown): Promise<unknown>; errorMessage(e: unknown): string }) {
  const [amount, setAmount] = useState(toMajor(inv.balance, inv.currency));
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [err, setErr] = useState<string>();
  const minor = parseMoney(amount, inv.currency);
  const submit = async () => {
    if (minor === null || minor <= 0) return setErr("Enter a positive amount");
    try { await onSubmit({ amount: minor, paidOn, method, ...(reference ? { reference } : {}) }); onClose(); } catch (e) { setErr(errorMessage(e)); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Record payment" description={`Balance due: ${money(inv.balance, inv.currency)}`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit}>Save payment</Button></>}>
      <div className="grid gap-3">
        {err && <Alert>{err}</Alert>}
        <Field label={`Amount (${inv.currency})`}>{(a) => <Input {...a} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
        <Field label="Paid on">{(a) => <Input {...a} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />}</Field>
        <Field label="Method">{(a) => (
          <Select {...a} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="cash">Cash</option><option value="other">Other</option>
          </Select>
        )}</Field>
        <Field label="Reference (optional)">{(a) => <Input {...a} value={reference} onChange={(e) => setReference(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

function VoidDialog({ onClose, onSubmit, errorMessage }: { onClose(): void; onSubmit(reason: string): Promise<unknown>; errorMessage(e: unknown): string }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string>();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Void invoice" description="The number stays used and the invoice is kept for your records. This cannot be undone."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={!reason.trim()} onClick={async () => { try { await onSubmit(reason.trim()); onClose(); } catch (e) { setErr(errorMessage(e)); } }}>Void invoice</Button></>}>
      {err && <Alert>{err}</Alert>}
      <Field label="Reason">{(a) => <Textarea {...a} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
    </Dialog>
  );
}

// ───────────────────────── editor ─────────────────────────
interface LineDraft { description: string; quantity: string; unitPrice: string; taxRate: string }
const emptyLine = (): LineDraft => ({ description: "", quantity: "1", unitPrice: "", taxRate: "0" });

function InvoiceEditor({ api, tenantId, navigate, errorMessage, id, prefillContact }: SlotProps & { id?: string; prefillContact?: string }) {
  const qc = useQueryClient();
  const existing = useQuery({ queryKey: ["tenant", tenantId, "invoicing", "invoice", id], enabled: !!id, queryFn: () => api.get<InvoiceFull>(`/invoices/${id}`) });
  const contacts = useQuery({ queryKey: ["tenant", tenantId, "contacts", "picker"], queryFn: () => api.core<Page<ContactLite>>("/contacts?limit=100") });
  const companies = useQuery({ queryKey: ["tenant", tenantId, "companies", "picker"], queryFn: () => api.core<Page<CompanyLite>>("/companies?limit=100") });
  const [contactId, setContactId] = useState(prefillContact ?? "");
  const [companyId, setCompanyId] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const e = existing.data;
    if (!e) return;
    setContactId(e.contactId ?? ""); setCompanyId(e.companyId ?? ""); setCurrency(e.currency); setDueDate(e.dueDate ?? ""); setNotes(e.notes ?? "");
    setLines(e.lines.length ? e.lines.map((l) => ({ description: l.description, quantity: String(l.quantity), unitPrice: toMajor(l.unitPrice, e.currency), taxRate: String(l.taxRate) })) : [emptyLine()]);
  }, [existing.data]);
  useEffect(() => { // default company from the chosen contact
    const c = contacts.data?.data.find((x) => x.id === contactId);
    if (c?.companyId && !companyId && !id) setCompanyId(c.companyId);
  }, [contactId, contacts.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (id && existing.isPending) return <Spinner />;
  if (existing.data && existing.data.status !== "draft") return <Alert>Only drafts can be edited.</Alert>;

  const parsed = lines.map((l) => ({
    description: l.description.trim(), quantity: Number(l.quantity), unitPrice: parseMoney(l.unitPrice, currency), taxRate: Number(l.taxRate),
  }));
  const valid = parsed.every((l) => l.description && l.quantity > 0 && l.unitPrice !== null && l.taxRate >= 0 && l.taxRate <= 100);
  const preview = valid ? computeTotals(parsed.map((l) => computeLine({ ...l, unitPrice: l.unitPrice! }))) : null;
  const set = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const name = (c: ContactLite) => [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || c.id;

  const save = async (then: "view" | "issue") => {
    if (!valid) return setErr("Each line needs a description, a quantity above 0, a price and a tax rate between 0 and 100.");
    setBusy(true); setErr(undefined);
    try {
      const body = {
        contactId: contactId || null, companyId: companyId || null, currency, dueDate: dueDate || null, notes: notes || null,
        lines: parsed.map((l) => ({ ...l, unitPrice: l.unitPrice! })),
      };
      const inv = id ? await api.put<InvoiceFull>(`/invoices/${id}`, body) : await api.post<InvoiceFull>("/invoices", body);
      if (then === "issue") await api.post(`/invoices/${inv.id}/issue`);
      await qc.invalidateQueries({ queryKey: ["tenant", tenantId, "invoicing"] });
      navigate(`${ROOT}/${inv.id}`);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title={id ? "Edit draft" : "New invoice"} description="Amounts are calculated on the server when you save." />
      {err && <div className="mb-4"><Alert>{err}</Alert></div>}
      <div className="grid gap-4">
        <Card><CardContent className="grid gap-3 pt-4 sm:grid-cols-2">
          <Field label="Contact">{(a) => (
            <Select {...a} value={contactId} onChange={(e) => setContactId(e.target.value)}>
              <option value="">—</option>
              {contacts.data?.data.map((c) => <option key={c.id} value={c.id}>{name(c)}</option>)}
            </Select>
          )}</Field>
          <Field label="Company" hint="Shown as the customer when set.">{(a) => (
            <Select {...a} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">—</option>
              {companies.data?.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}</Field>
          <Field label="Currency">{(a) => <Input {...a} maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />}</Field>
          <Field label="Due date" hint="Leave empty to use your payment terms.">{(a) => <Input {...a} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}</Field>
        </CardContent></Card>
        <Card>
          <CardHeader><CardTitle>Items</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {lines.map((l, i) => (
              <fieldset key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_5rem_8rem_5rem_auto] sm:items-end sm:border-0 sm:p-0">
                <legend className="sr-only">Line {i + 1}</legend>
                <Field label="Description">{(a) => <Input {...a} value={l.description} onChange={(e) => set(i, { description: e.target.value })} />}</Field>
                <Field label="Qty">{(a) => <Input {...a} inputMode="decimal" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />}</Field>
                <Field label={`Unit price (${currency})`}>{(a) => <Input {...a} inputMode="decimal" value={l.unitPrice} onChange={(e) => set(i, { unitPrice: e.target.value })} />}</Field>
                <Field label="Tax %">{(a) => <Input {...a} inputMode="decimal" value={l.taxRate} onChange={(e) => set(i, { taxRate: e.target.value })} />}</Field>
                <Button variant="ghost" size="sm" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>Remove</Button>
              </fieldset>
            ))}
            <div><Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}>Add line</Button></div>
            {preview && <Totals inv={{ ...preview, amountPaid: 0, currency, status: "draft" }} />}
          </CardContent>
        </Card>
        <Card><CardContent className="pt-4">
          <Field label="Notes (shown on the invoice)">{(a) => <Textarea {...a} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        </CardContent></Card>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => save("view")}>Save draft</Button>
          <Button variant="outline" disabled={busy} onClick={() => save("issue")}>Save and issue</Button>
          <Button variant="ghost" onClick={() => navigate(id ? `${ROOT}/${id}` : ROOT)}>Cancel</Button>
        </div>
      </div>
    </>
  );
}
