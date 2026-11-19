import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Button, Card, CardContent, CardHeader, CardTitle, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Switch,
  Table, TBody, TD, TH, THead, TR, Textarea,
} from "@office/ui";
import type { SlotProps } from "@office/sdk/ui";
import { fmtDay, money, P, parseMoney, RECEIPT_ACCEPT, ROOT, StatusBadge, today, toMajor } from "./common.tsx";
import type { Category, Expense, Page } from "./types.ts";

/** One-time message carried to the detail page (e.g. why "Save and submit" only saved a draft). */
const flash = {
  set: (id: string, msg: string) => { try { sessionStorage.setItem(`expenses.flash.${id}`, msg); } catch { /* ignore */ } },
  take: (id: string) => { try { const m = sessionStorage.getItem(`expenses.flash.${id}`); sessionStorage.removeItem(`expenses.flash.${id}`); return m; } catch { return null; } },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const seesAll = (can: SlotProps["can"]) => can(P.readAll) || can(P.approve) || can(P.reimburse);

/** /m/expenses/expenses[/<id>] */
export function ExpensesPage(props: SlotProps) {
  const seg = (props.subPath ?? "").split("/").filter(Boolean);
  if (seg[0] && UUID.test(seg[0])) return <ExpenseDetail {...props} id={seg[0]} />;
  if (seg.length) return <EmptyState title="Page not found" />;
  return <Overview {...props} />;
}

// ───────────────────────── overview ─────────────────────────
type Tab = "mine" | "approve" | "reimburse" | "all";
function Overview(props: SlotProps) {
  const { can } = props;
  const tabs = ([
    ["mine", "My expenses", true], ["approve", "To approve", can(P.approve)],
    ["reimburse", "To reimburse", can(P.reimburse)], ["all", "All", seesAll(can)],
  ] as const).filter((t) => t[2]);
  const [tab, setTab] = useState<Tab>(() => {
    try { const t = sessionStorage.getItem("expenses.tab") as Tab | null; if (t && tabs.some((x) => x[0] === t)) return t; } catch { /* ignore */ }
    return "mine";
  });
  const pick = (t: Tab) => { setTab(t); try { sessionStorage.setItem("expenses.tab", t); } catch { /* ignore */ } };
  const [dialog, setDialog] = useState<"new" | "categories" | "export" | null>(null);
  return (
    <>
      <PageHeader title="Expenses" description="Add what you spent with a receipt and submit it. Approvers review, finance pays it back."
        actions={<div className="flex flex-wrap gap-2">
          {can(P.categories) && <Button variant="outline" onClick={() => setDialog("categories")}>Categories</Button>}
          {can(P.reimburse) && <Button variant="outline" onClick={() => setDialog("export")}>Export CSV</Button>}
          {can(P.submit) && <Button onClick={() => setDialog("new")}>New expense</Button>}
        </div>} />
      {tabs.length > 1 && (
        <div role="tablist" aria-label="Expenses view" className="mb-3 flex flex-wrap gap-1">
          {tabs.map(([k, label]) => <Button key={k} role="tab" aria-selected={tab === k} size="sm" variant={tab === k ? "secondary" : "ghost"} onClick={() => pick(k)}>{label}</Button>)}
        </div>
      )}
      {tab === "reimburse" ? <ReimburseList {...props} /> : <ExpenseList {...props} tab={tab} />}
      {dialog === "new" && <ExpenseDialog {...props} onClose={() => setDialog(null)} />}
      {dialog === "categories" && <CategoriesDialog {...props} onClose={() => setDialog(null)} />}
      {dialog === "export" && <ExportDialog {...props} onClose={() => setDialog(null)} />}
    </>
  );
}

const usePaged = (props: SlotProps, query: string) => useInfiniteQuery({
  queryKey: ["tenant", props.tenantId, "expenses", "list", query],
  initialPageParam: "",
  queryFn: ({ pageParam }) => props.api.get<Page<Expense>>(`/expenses?limit=50${query}${pageParam ? `&cursor=${pageParam}` : ""}`),
  getNextPageParam: (p) => p.nextCursor ?? undefined,
});

const FILTERS = [["", "Any status"], ["draft", "Draft"], ["submitted", "Awaiting approval"], ["approved", "Approved"], ["rejected", "Needs changes"], ["reimbursed", "Reimbursed"]] as const;

function ExpenseList(props: SlotProps & { tab: Exclude<Tab, "reimburse"> }) {
  const { tab, navigate, errorMessage } = props;
  const [status, setStatus] = useState("");
  const query = tab === "mine" ? "&mine=true" : tab === "approve" ? "&status=submitted" : status ? `&status=${status}` : "";
  const q = usePaged(props, query);
  const rows = (q.data?.pages.flatMap((p) => p.data) ?? []).filter((e) => tab !== "approve" || !e.mine);
  const showWho = tab !== "mine";
  return (
    <>
      {tab === "all" && (
        <div className="mb-3 max-w-56"><Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select></div>
      )}
      {q.isPending ? <Spinner /> : q.isError ? <Alert>{errorMessage(q.error)}</Alert> : rows.length === 0 ? (
        <EmptyState title={tab === "approve" ? "Nothing to approve" : tab === "mine" ? "No expenses yet" : "No expenses"}>
          {tab === "mine" ? "Add an expense, attach the receipt, and submit it for approval." : tab === "approve" ? "Submitted expenses from your team show up here." : null}
        </EmptyState>
      ) : (
        <Card className="overflow-x-auto"><Table>
          <THead><TR>
            <TH>Date</TH><TH>Merchant</TH>{showWho && <TH>Submitted by</TH>}<TH>Category</TH><TH className="text-right">Amount</TH><TH>Status</TH>
          </TR></THead>
          <TBody>{rows.map((e) => (
            <TR key={e.id} className="cursor-pointer" onClick={() => navigate(`${ROOT}/${e.id}`)}>
              <TD className="whitespace-nowrap">{fmtDay(e.spentOn)}</TD>
              <TD className="font-medium"><a href={`${ROOT}/${e.id}`} onClick={(ev) => { ev.preventDefault(); navigate(`${ROOT}/${e.id}`); }}>{e.merchant}</a>{!e.receipt && <span className="ml-2 text-xs text-muted">no receipt</span>}</TD>
              {showWho && <TD>{e.submitterName ?? "—"}</TD>}
              <TD>{e.categoryName ?? "—"}</TD>
              <TD className="text-right tabular-nums">{money(e.amount, e.currency)}</TD>
              <TD><StatusBadge s={e.status} /></TD>
            </TR>
          ))}</TBody>
        </Table></Card>
      )}
      {q.hasNextPage && <div className="mt-3"><Button variant="outline" size="sm" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Load more</Button></div>}
    </>
  );
}

/** Approved expenses waiting to be paid back; select some and mark them reimbursed in one go. */
function ReimburseList(props: SlotProps) {
  const { api, tenantId, navigate, errorMessage } = props;
  const qc = useQueryClient();
  const q = usePaged(props, "&status=approved");
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState("");
  const pay = useMutation({
    mutationFn: () => api.post<{ reimbursed: number }>("/reimburse", { ids: [...sel], ...(ref.trim() ? { reference: ref.trim() } : {}) }),
    onSuccess: () => { setSel(new Set()); setOpen(false); setRef(""); void qc.invalidateQueries({ queryKey: ["tenant", tenantId, "expenses"] }); },
  });
  const chosen = rows.filter((r) => sel.has(r.id));
  const totals = Object.entries(chosen.reduce<Record<string, number>>((a, r) => ({ ...a, [r.currency]: (a[r.currency] ?? 0) + r.amount }), {}));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert>{errorMessage(q.error)}</Alert>;
  if (!rows.length) return <EmptyState title="Nothing to reimburse">Approved expenses show up here until they are paid back.</EmptyState>;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Button disabled={!sel.size} onClick={() => setOpen(true)}>Mark {sel.size || ""} reimbursed</Button>
        {totals.length > 0 && <span className="text-sm tabular-nums text-muted">{totals.map(([c, v]) => money(v, c)).join(" · ")}</span>}
      </div>
      <Card className="overflow-x-auto"><Table>
        <THead><TR>
          <TH className="w-10"><input type="checkbox" aria-label="Select all" checked={sel.size === rows.length} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></TH>
          <TH>Date</TH><TH>Submitted by</TH><TH>Merchant</TH><TH className="text-right">Amount</TH>
        </TR></THead>
        <TBody>{rows.map((e) => (
          <TR key={e.id}>
            <TD><input type="checkbox" aria-label={`Select ${e.merchant}`} checked={sel.has(e.id)} onChange={() => toggle(e.id)} /></TD>
            <TD className="whitespace-nowrap">{fmtDay(e.spentOn)}</TD>
            <TD>{e.submitterName ?? "—"}</TD>
            <TD className="font-medium"><a href={`${ROOT}/${e.id}`} onClick={(ev) => { ev.preventDefault(); navigate(`${ROOT}/${e.id}`); }}>{e.merchant}</a></TD>
            <TD className="text-right tabular-nums">{money(e.amount, e.currency)}</TD>
          </TR>
        ))}</TBody>
      </Table></Card>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)} title={`Mark ${sel.size} expense${sel.size === 1 ? "" : "s"} reimbursed`}
          description="Use this after the money has been paid back, for example in a payroll or bank run."
          footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={pay.isPending} onClick={() => pay.mutate()}>Mark reimbursed</Button></>}>
          <div className="grid gap-3">
            {pay.error && <Alert>{errorMessage(pay.error)}</Alert>}
            <Field label="Payment reference (optional)">{(a) => <Input {...a} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. Payroll November" />}</Field>
          </div>
        </Dialog>
      )}
    </>
  );
}

// ───────────────────────── create / edit ─────────────────────────
const useCategories = ({ api, tenantId }: Pick<SlotProps, "api" | "tenantId">, archived = false) => useQuery({
  queryKey: ["tenant", tenantId, "expenses", "categories", archived],
  queryFn: () => api.get<{ data: Category[] }>(`/categories${archived ? "?archived=true" : ""}`),
});

type Body = { spentOn: string; merchant: string; categoryId: string | null; amount: number; tax: number; currency: string; description: string | null };
function ExpenseForm(props: Pick<SlotProps, "api" | "tenantId" | "errorMessage"> & {
  initial?: Expense; withReceipt?: boolean; onSubmit(body: Body, receipt: File | null, andSubmit: boolean): Promise<unknown>; onCancel(): void;
}) {
  const { initial: i, withReceipt, errorMessage } = props;
  const cats = useCategories(props);
  const cur0 = i?.currency ?? "EUR";
  const [f, setF] = useState({
    spentOn: i?.spentOn ?? today(), merchant: i?.merchant ?? "", categoryId: i?.categoryId ?? "", currency: cur0,
    amount: i ? toMajor(i.amount, cur0) : "", tax: i?.tax ? toMajor(i.tax, cur0) : "", description: i?.description ?? "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const go = async (andSubmit: boolean) => {
    const amount = parseMoney(f.amount, f.currency), tax = parseMoney(f.tax, f.currency);
    if (!f.merchant.trim()) return setErr("Enter where you spent it");
    if (amount === null || amount <= 0) return setErr("Enter the amount");
    if (tax === null || tax > amount) return setErr("Tax must be a valid amount, not more than the total");
    if (!/^[A-Z]{3}$/.test(f.currency)) return setErr("Currency is a 3-letter code, e.g. EUR");
    setBusy(true); setErr(undefined);
    try {
      await props.onSubmit({ spentOn: f.spentOn, merchant: f.merchant.trim(), categoryId: f.categoryId || null, amount, tax, currency: f.currency, description: f.description.trim() || null }, file, andSubmit);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void go(false); }}>
      {err && <Alert>{err}</Alert>}
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Field label="Date">{(a) => <Input {...a} type="date" required max={today()} value={f.spentOn} onChange={set("spentOn")} />}</Field>
        <Field label="Merchant">{(a) => <Input {...a} value={f.merchant} onChange={set("merchant")} placeholder="e.g. Rail Co" />}</Field>
      </div>
      <Field label="Category">{(a) => (
        <Select {...a} value={f.categoryId} onChange={set("categoryId")}>
          <option value="">Choose…</option>{cats.data?.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      )}</Field>
      <div className="grid grid-cols-[1fr_1fr_5.5rem] gap-3">
        <Field label="Amount">{(a) => <Input {...a} inputMode="decimal" value={f.amount} onChange={set("amount")} placeholder="0.00" />}</Field>
        <Field label="Of which tax">{(a) => <Input {...a} inputMode="decimal" value={f.tax} onChange={set("tax")} placeholder="0.00" />}</Field>
        <Field label="Currency">{(a) => <Input {...a} maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} />}</Field>
      </div>
      <Field label="Description (optional)">{(a) => <Textarea {...a} rows={2} value={f.description} onChange={set("description")} placeholder="Business purpose, attendees…" />}</Field>
      {withReceipt && (
        <Field label="Receipt" hint="PDF or photo, up to 10 MB">{(a) => <Input {...a} type="file" accept={RECEIPT_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}</Field>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={props.onCancel}>Cancel</Button>
        <Button type="submit" variant={withReceipt ? "outline" : "primary"} disabled={busy}>{i ? "Save" : "Save draft"}</Button>
        {withReceipt && <Button disabled={busy} onClick={() => void go(true)}>Save and submit</Button>}
      </div>
    </form>
  );
}

function ExpenseDialog(props: SlotProps & { onClose(): void }) {
  const qc = useQueryClient();
  const { api, tenantId, navigate, errorMessage } = props;
  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()} title="New expense">
      <ExpenseForm {...props} withReceipt onCancel={props.onClose} onSubmit={async (body, receipt, andSubmit) => {
        const e = await api.post<Expense>("/expenses", body);
        try {
          if (receipt) await api.upload(`/expenses/${e.id}/receipt`, receipt, receipt.name);
          if (andSubmit) await api.post(`/expenses/${e.id}/submit`);
        } catch (err) {
          flash.set(e.id, errorMessage(err));   // saved as a draft; the detail page says what is missing
        } finally {
          await qc.invalidateQueries({ queryKey: ["tenant", tenantId, "expenses"] });
          props.onClose();
          navigate(`${ROOT}/${e.id}`);   // the detail page shows what is still missing
        }
      }} />
    </Dialog>
  );
}

function CategoriesDialog({ api, tenantId, errorMessage, onClose }: SlotProps & { onClose(): void }) {
  const qc = useQueryClient();
  const cats = useCategories({ api, tenantId }, true);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string>();
  const run = async (fn: () => Promise<unknown>) => {
    setErr(undefined);
    try { await fn(); await qc.invalidateQueries({ queryKey: ["tenant", tenantId, "expenses", "categories"] }); } catch (e) { setErr(errorMessage(e)); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Expense categories"
      description="Account codes appear in the CSV export for your bookkeeping. Archive a category to hide it from new expenses."
      footer={<Button onClick={onClose}>Done</Button>}>
      <div className="grid gap-3">
        {err && <Alert>{err}</Alert>}
        {cats.isPending ? <Spinner /> : cats.data?.data.map((c) => (
          <div key={c.id} className="grid grid-cols-[1fr_6rem_auto] items-center gap-2">
            <Input aria-label="Category name" defaultValue={c.name} disabled={c.archived} onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && run(() => api.patch(`/categories/${c.id}`, { name: e.target.value }))} />
            <Input aria-label={`${c.name} account code`} placeholder="Code" defaultValue={c.code ?? ""} onBlur={(e) => e.target.value !== (c.code ?? "") && run(() => api.patch(`/categories/${c.id}`, { code: e.target.value || null }))} />
            <Switch label={`${c.name} active`} checked={!c.archived} onCheckedChange={(v) => void run(() => api.patch(`/categories/${c.id}`, { archived: !v }))} />
          </div>
        ))}
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void run(async () => { await api.post("/categories", { name }); setName(""); }); }}>
          <Input aria-label="New category" placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" variant="outline">Add</Button>
        </form>
      </div>
    </Dialog>
  );
}

function ExportDialog({ api, errorMessage, onClose }: SlotProps & { onClose(): void }) {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const [f, setF] = useState({ from: first, to: today(), status: "all_decided" });
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true); setErr(undefined);
    try {
      const b = await api.blob(`/export.csv?from=${f.from}&to=${f.to}&status=${f.status}`);
      const url = URL.createObjectURL(b);
      const a = document.createElement("a");
      a.href = url; a.download = `expenses-${f.from}-${f.to}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onClose();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Export expenses" description="A CSV of approved expenses for your accounting software or spreadsheet."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={() => void download()}>Download CSV</Button></>}>
      <div className="grid gap-3">
        {err && <Alert>{err}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="From">{(a) => <Input {...a} type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />}</Field>
          <Field label="To">{(a) => <Input {...a} type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />}</Field>
        </div>
        <Field label="Include">{(a) => (
          <Select {...a} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="all_decided">Approved and reimbursed</option><option value="approved">Approved, not yet reimbursed</option><option value="reimbursed">Reimbursed</option>
          </Select>
        )}</Field>
      </div>
    </Dialog>
  );
}

// ───────────────────────── detail ─────────────────────────
function ReceiptPreview({ api, tenantId, e, errorMessage }: Pick<SlotProps, "api" | "tenantId" | "errorMessage"> & { e: Expense }) {
  const q = useQuery({
    queryKey: ["tenant", tenantId, "expenses", "receipt", e.receipt?.id],
    enabled: !!e.receipt, staleTime: Infinity,
    queryFn: () => api.blob(`/expenses/${e.id}/receipt`),
  });
  const url = useMemo(() => (q.data ? URL.createObjectURL(q.data) : null), [q.data]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  if (!e.receipt) return <p className="text-sm text-muted">No receipt attached.</p>;
  if (q.isPending) return <Spinner label="Loading receipt" />;
  if (q.isError) return <Alert>{errorMessage(q.error)}</Alert>;
  const isImage = e.receipt.mime?.startsWith("image/");
  return (
    <div className="grid gap-2">
      {isImage && <img src={url!} alt={`Receipt from ${e.merchant}`} className="max-h-[28rem] w-full rounded-md border bg-surface-2 object-contain" />}
      <a className="text-sm text-primary hover:underline" href={url!} target="_blank" rel="noopener noreferrer" download={e.receipt.filename ?? "receipt"}>
        {isImage ? "Download" : "Open"} {e.receipt.filename ?? "receipt"}
      </a>
    </div>
  );
}

function ExpenseDetail(props: SlotProps & { id: string }) {
  const { api, tenantId, can, navigate, errorMessage, id } = props;
  const qc = useQueryClient();
  const key = ["tenant", tenantId, "expenses"];
  const q = useQuery({ queryKey: [...key, "one", id], queryFn: () => api.get<Expense>(`/expenses/${id}`) });
  const [dialog, setDialog] = useState<"edit" | "reject" | "reimburse" | null>(null);
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [notice] = useState(() => flash.take(id));
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: (d) => { if (d && typeof d === "object" && "id" in d) qc.setQueryData([...key, "one", id], d); void qc.invalidateQueries({ queryKey: key }); },
  });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert>{errorMessage(q.error)}</Alert>;
  const e = q.data;
  const editable = e.mine && (e.status === "draft" || e.status === "rejected");
  const canDecide = e.canDecide;
  const close = () => { setDialog(null); setText(""); };
  return (
    <>
      <PageHeader title={e.merchant}
        description={<span className="inline-flex flex-wrap items-center gap-2"><StatusBadge s={e.status} /><span className="tabular-nums">{money(e.amount, e.currency)}</span>
          <a href={ROOT} className="hover:underline" onClick={(ev) => { ev.preventDefault(); navigate(ROOT); }}>← Expenses</a></span>}
        actions={<div className="flex flex-wrap gap-2">
          {editable && <Button disabled={act.isPending} onClick={() => act.mutate(() => api.post(`/expenses/${id}/submit`))}>Submit for approval</Button>}
          {editable && <Button variant="outline" onClick={() => setDialog("edit")}>Edit</Button>}
          {editable && <Button variant="danger" disabled={act.isPending} onClick={() => act.mutate(async () => { await api.del(`/expenses/${id}`); navigate(ROOT); })}>Delete</Button>}
          {canDecide && <Button disabled={act.isPending} onClick={() => act.mutate(() => api.post(`/expenses/${id}/approve`, {}))}>Approve</Button>}
          {canDecide && <Button variant="outline" onClick={() => setDialog("reject")}>Send back</Button>}
          {can(P.reimburse) && e.status === "approved" && <Button onClick={() => setDialog("reimburse")}>Mark reimbursed</Button>}
        </div>} />
      {act.error ? <div className="mb-3"><Alert>{errorMessage(act.error)}</Alert></div>
        : notice && e.status === "draft" && !act.isSuccess && <div className="mb-3"><Alert tone="warning">Saved as a draft, not submitted yet: {notice}</Alert></div>}
      {e.decisionNote && e.status !== "approved" && e.status !== "reimbursed" && <div className="mb-3"><Alert tone="warning">Sent back: {e.decisionNote}</Alert></div>}
      {e.status === "submitted" && e.mine && !e.canDecide && <div className="mb-3"><Alert tone="success">Submitted. An approver will review it.</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted">Date</dt><dd>{fmtDay(e.spentOn)}</dd>
              <dt className="text-muted">Category</dt><dd>{e.categoryName ?? "—"}</dd>
              <dt className="text-muted">Amount</dt><dd className="tabular-nums">{money(e.amount, e.currency)}</dd>
              <dt className="text-muted">Tax</dt><dd className="tabular-nums">{money(e.tax, e.currency)}</dd>
              <dt className="text-muted">Submitted by</dt><dd>{e.submitterName ?? "—"}</dd>
              {e.submittedAt && <><dt className="text-muted">Submitted</dt><dd>{fmtDay(e.submittedAt)}</dd></>}
              {e.decidedAt && <><dt className="text-muted">{e.status === "rejected" || e.status === "draft" ? "Sent back" : "Approved"}</dt><dd>{fmtDay(e.decidedAt)}</dd></>}
              {e.reimbursedAt && <><dt className="text-muted">Reimbursed</dt><dd>{fmtDay(e.reimbursedAt)}{e.reimbursementRef ? ` · ${e.reimbursementRef}` : ""}</dd></>}
            </dl>
            {e.description && <p className="mt-3 whitespace-pre-wrap text-sm">{e.description}</p>}
            {e.status === "approved" && e.decisionNote && <p className="mt-3 text-sm text-muted">Approver note: {e.decisionNote}</p>}
          </CardContent>
        </Card>
        <Card><CardHeader className="flex flex-row items-center justify-between gap-2"><CardTitle>Receipt</CardTitle>
          {editable && <div className="flex gap-2">
            <input ref={fileRef} type="file" accept={RECEIPT_ACCEPT} className="sr-only" aria-label="Receipt file"
              onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ""; if (f) act.mutate(() => api.upload(`/expenses/${id}/receipt`, f, f.name)); }} />
            <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => fileRef.current?.click()}>{e.receipt ? "Replace" : "Attach receipt"}</Button>
            {e.receipt && <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate(() => api.del(`/expenses/${id}/receipt`))}>Remove</Button>}
          </div>}
        </CardHeader>
          <CardContent><ReceiptPreview {...props} e={e} /></CardContent>
        </Card>
      </div>
      {dialog === "edit" && (
        <Dialog open onOpenChange={(o) => !o && close()} title="Edit expense">
          <ExpenseForm {...props} initial={e} onCancel={close}
            onSubmit={async (body) => { await act.mutateAsync(() => api.patch(`/expenses/${id}`, body)); close(); }} />
        </Dialog>
      )}
      {dialog === "reject" && (
        <Dialog open onOpenChange={(o) => !o && close()} title="Send back for changes" description="The submitter sees your reason, fixes the expense and submits it again."
          footer={<><Button variant="outline" onClick={close}>Cancel</Button>
            <Button variant="danger" disabled={!text.trim() || act.isPending} onClick={async () => { await act.mutateAsync(() => api.post(`/expenses/${id}/reject`, { note: text })); close(); }}>Send back</Button></>}>
          <Field label="Reason">{(a) => <Textarea {...a} rows={3} value={text} onChange={(ev) => setText(ev.target.value)} placeholder="e.g. Receipt is unreadable" />}</Field>
        </Dialog>
      )}
      {dialog === "reimburse" && (
        <Dialog open onOpenChange={(o) => !o && close()} title="Mark reimbursed"
          footer={<><Button variant="outline" onClick={close}>Cancel</Button>
            <Button disabled={act.isPending} onClick={async () => { await act.mutateAsync(() => api.post("/reimburse", { ids: [id], ...(text.trim() ? { reference: text.trim() } : {}) })); close(); }}>Mark reimbursed</Button></>}>
          <Field label="Payment reference (optional)">{(a) => <Input {...a} value={text} onChange={(ev) => setText(ev.target.value)} />}</Field>
        </Dialog>
      )}
    </>
  );
}
