import { useState } from "react";
import { Download, Paperclip, Plus, Receipt, X } from "lucide-react";
import {
  Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton, Table, TBody, TD, TH, THead, TR, toast,
} from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import {
  STATUS, StatusBadge, downloadText, errorMessage, fmtDate, fmtMoney, fmtTotals, useDebounced, useLoad,
  type Config, type ListResult, type Status,
} from "./shared.tsx";

const PAGE = 50;
type View = "review" | "mine" | "all";

export function ExpenseList(_: PageProps) {
  const host = useModuleHost();
  const cfg = useLoad(() => host.api.get<Config>("/config"), []);
  if (cfg.error) return <Card><ErrorState error={cfg.error} onRetry={() => void cfg.reload()} /></Card>;
  if (!cfg.data) return <div className="grid gap-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64" /></div>;
  return <List cfg={cfg.data} />;
}

function List({ cfg }: { cfg: Config }) {
  const host = useModuleHost();
  const [view, setView] = useState<View>(cfg.canReview ? "review" : "mine");
  const [status, setStatus] = useState<Status | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [vendor, setVendor] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [category, setCategory] = useState("");
  const [offset, setOffset] = useState(0);
  const [exporting, setExporting] = useState(false);
  const vendorQ = useDebounced(vendor.trim(), 300);

  const people = useLoad(() => (cfg.canReview ? host.api.get<{ userId: string; name: string }[]>("/people") : Promise.resolve([])), [cfg.canReview]);
  const query = {
    status: view === "review" ? "submitted" : status || undefined,
    mine: view === "mine" ? "true" : undefined,
    from: from || undefined, to: to || undefined, vendor: vendorQ || undefined,
    employeeId: view === "all" && employeeId ? employeeId : undefined, category: category || undefined,
  };
  const key = JSON.stringify(query);
  const list = useLoad(() => host.api.get<ListResult>("/expenses", { ...query, limit: PAGE, offset }), [key, offset]);
  const filtered = !!(status || from || to || vendor || employeeId || category);
  const reset = () => { setStatus(""); setFrom(""); setTo(""); setVendor(""); setEmployeeId(""); setCategory(""); setOffset(0); };
  const set = <T,>(f: (v: T) => void) => (v: T) => { f(v); setOffset(0); };

  async function exportCsv() {
    setExporting(true);
    try {
      const r = await host.api.get<{ filename: string; csv: string; rows: number }>("/export", query);
      downloadText(r.filename, r.csv);
      toast.success(`Exported ${r.rows} expense${r.rows === 1 ? "" : "s"}`);
    } catch (e) { toast.error(errorMessage(e)); } finally { setExporting(false); }
  }

  const views: { key: View; label: string }[] = cfg.canReview
    ? [{ key: "review", label: "To approve" }, { key: "all", label: "Everyone" }, { key: "mine", label: "Mine" }]
    : [{ key: "mine", label: "My expenses" }];

  return (
    <>
      <PageHeader title="Expenses" description={cfg.canReview
        ? "Receipts and supplier invoices from your team. Approve or reject what's waiting, then mark it paid."
        : "Your receipts and supplier invoices. Submit them for approval to get paid back."}
        actions={<>
          <Button variant="outline" loading={exporting} onClick={() => void exportCsv()}><Download /> Export CSV</Button>
          {cfg.canSubmit && <Button onClick={() => host.navigate("/expenses/new")}><Plus /> New expense</Button>}
        </>} />

      {views.length > 1 && (
        <div role="tablist" aria-label="Which expenses" className="mb-4 flex gap-1.5 overflow-x-auto">
          {views.map((v) => (
            <Button key={v.key} role="tab" aria-selected={view === v.key} size="sm" variant={view === v.key ? "default" : "outline"}
              onClick={() => { setView(v.key); setOffset(0); }}>{v.label}</Button>
          ))}
        </div>
      )}

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6" role="group" aria-label="Filters">
          <Field label="From">{(a) => <Input {...a} type="date" value={from} onChange={(e) => set(setFrom)(e.target.value)} />}</Field>
          <Field label="To">{(a) => <Input {...a} type="date" value={to} onChange={(e) => set(setTo)(e.target.value)} />}</Field>
          <Field label="Vendor search">{(a) => <Input {...a} placeholder="Any vendor" value={vendor} onChange={(e) => set(setVendor)(e.target.value)} />}</Field>
          {view !== "review" && (
            <Field label="Status">{(a) => (
              <Select {...a} value={status} onChange={(e) => set(setStatus)(e.target.value as Status | "")}>
                <option value="">Any status</option>
                {(Object.keys(STATUS) as Status[]).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
              </Select>
            )}</Field>
          )}
          {view === "all" && (
            <Field label="Employee">{(a) => (
              <Select {...a} value={employeeId} onChange={(e) => set(setEmployeeId)(e.target.value)}>
                <option value="">Everyone</option>
                {(people.data ?? []).map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
              </Select>
            )}</Field>
          )}
          <Field label="Category">{(a) => (
            <Select {...a} value={category} onChange={(e) => set(setCategory)(e.target.value)}>
              <option value="">Any category</option>
              {cfg.categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          )}</Field>
        </div>
        {filtered && <Button variant="ghost" size="sm" className="mt-2" onClick={reset}><X /> Clear filters</Button>}
      </Card>

      {list.error ? <Card><ErrorState error={list.error} onRetry={() => void list.reload()} /></Card>
        : !list.data ? <Skeleton className="h-64" />
        : !list.data.data.length ? (
          <Card><EmptyState icon={<Receipt />}
            title={view === "review" && !filtered ? "Nothing waiting for approval" : filtered ? "No expenses match these filters" : "No expenses yet"}
            description={view === "review" && !filtered ? "When someone submits an expense, it shows up here." : filtered ? "Try a wider date range or clear the filters." : "Snap a receipt to add your first one."}
            action={!filtered && cfg.canSubmit && view !== "review" ? <Button onClick={() => host.navigate("/expenses/new")}><Plus /> New expense</Button> : undefined} /></Card>
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <Table aria-label="Expenses">
                <THead><TR>
                  <TH>Date</TH><TH>Vendor</TH>{view !== "mine" && <TH>Employee</TH>}<TH className="hidden md:table-cell">Category</TH><TH>Status</TH><TH className="text-right">Total</TH>
                </TR></THead>
                <TBody>
                  {list.data.data.map((x) => (
                    <TR key={x.id} className="cursor-pointer" onClick={() => host.navigate(`/expenses/${x.id}`)}>
                      <TD className="whitespace-nowrap">{fmtDate(x.docDate)}</TD>
                      <TD>
                        <a href={host.href(`/expenses/${x.id}`)} onClick={(e) => { e.preventDefault(); e.stopPropagation(); host.navigate(`/expenses/${x.id}`); }} className="font-medium hover:underline">{x.vendor}</a>
                        {x.fileId && <Paperclip className="ml-1 inline size-3.5 text-muted-foreground" aria-label="Has receipt" />}
                        {x.kind === "invoice" && <span className="ml-2 text-xs text-muted-foreground">Invoice</span>}
                      </TD>
                      {view !== "mine" && <TD>{x.employeeName}</TD>}
                      <TD className="hidden md:table-cell">{x.category ?? "—"}</TD>
                      <TD><StatusBadge status={x.status} /></TD>
                      <TD className="text-right tabular-nums">{fmtMoney(x.totalCents, x.currency)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-sm">
              <span className="text-muted-foreground">{list.data.total} expense{list.data.total === 1 ? "" : "s"} · <strong className="text-foreground" data-testid="list-total">{fmtTotals(list.data.totals)}</strong></span>
              {list.data.total > PAGE && (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
                  <span className="text-muted-foreground">{offset + 1}–{Math.min(offset + PAGE, list.data.total)}</span>
                  <Button size="sm" variant="outline" disabled={offset + PAGE >= list.data.total} onClick={() => setOffset(offset + PAGE)}>Next</Button>
                </div>
              )}
            </div>
          </Card>
        )}
    </>
  );
}
