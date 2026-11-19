import { useState } from "react";
import { Plus, Receipt, Search } from "lucide-react";
import {
  Button, Card, EmptyState, ErrorState, Input, PageHeader, Skeleton, Table, TBody, TD, TH, THead, TR, Tabs, TabsList, TabsTrigger,
} from "@office/ui";
import { useModuleHost } from "@office/ui/module-ui";
import { fmtDate, fmtMoney, StatusBadge, useDebounced, useLoad, type Invoice, type Summary } from "./shared.tsx";

const FILTERS = [
  { value: "all", label: "All" }, { value: "draft", label: "Drafts" }, { value: "outstanding", label: "Outstanding" },
  { value: "overdue", label: "Overdue" }, { value: "paid", label: "Paid" }, { value: "void", label: "Void" },
] as const;

export function SummaryCards({ summary }: { summary: Summary | undefined }) {
  if (!summary?.currencies.length) return null;
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-3">
      {summary.currencies.map((c) => (
        <div key={c.currency} className="contents">
          <Card className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Outstanding {summary.currencies.length > 1 ? c.currency : ""}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{fmtMoney(c.outstandingCents, c.currency)}</p>
            <p className="text-xs text-muted-foreground">{c.openCount} open invoice{c.openCount === 1 ? "" : "s"}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Overdue</p>
            <p className={`mt-1 text-xl font-semibold tabular-nums ${c.overdueCents ? "text-destructive" : ""}`}>{fmtMoney(c.overdueCents, c.currency)}</p>
            <p className="text-xs text-muted-foreground">{c.overdueCount} invoice{c.overdueCount === 1 ? "" : "s"}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Paid, last 30 days</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{fmtMoney(c.paidLast30Cents, c.currency)}</p>
            <p className="text-xs text-muted-foreground">{c.draftCount} draft{c.draftCount === 1 ? "" : "s"}</p>
          </Card>
        </div>
      ))}
    </div>
  );
}

export function InvoiceTable({ rows, onOpen, showCustomer = true }: { rows: Invoice[]; onOpen: (i: Invoice) => void; showCustomer?: boolean }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Number</TH>{showCustomer && <TH>Customer</TH>}<TH>Status</TH><TH>Issued</TH><TH>Due</TH>
          <TH className="text-right">Total</TH><TH className="text-right">Balance</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((i) => (
          <TR key={i.id} className="cursor-pointer" onClick={() => onOpen(i)}>
            <TD className="font-medium">
              <a href="#" onClick={(e) => { e.preventDefault(); onOpen(i); }} className="hover:underline">{i.number ?? "Draft"}</a>
            </TD>
            {showCustomer && <TD>{i.billTo.name}</TD>}
            <TD><StatusBadge status={i.displayStatus} /></TD>
            <TD className="text-muted-foreground">{fmtDate(i.issueDate)}</TD>
            <TD className="text-muted-foreground">{fmtDate(i.dueDate)}</TD>
            <TD className="text-right tabular-nums">{fmtMoney(i.totalCents, i.currency)}</TD>
            <TD className="text-right tabular-nums">{i.status === "void" || i.status === "draft" ? "—" : fmtMoney(i.balanceCents, i.currency)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export function InvoiceList() {
  const host = useModuleHost();
  const [filter, setFilter] = useState<string>(() => {
    const s = new URLSearchParams(window.location.search).get("status");
    return FILTERS.some((f) => f.value === s) ? s! : "all";
  });
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const [extra, setExtra] = useState<Invoice[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);

  const summary = useLoad(() => host.api.get<Summary>("/summary"), [host]);
  const list = useLoad(async () => {
    const r = await host.api.get<{ data: Invoice[]; nextCursor: string | null }>("/invoices", {
      status: filter === "all" ? undefined : filter, q: dq || undefined, limit: 50,
    });
    setExtra([]); setCursor(r.nextCursor);
    return r.data;
  }, [host, filter, dq]);

  const more = async () => {
    if (!cursor) return;
    const r = await host.api.get<{ data: Invoice[]; nextCursor: string | null }>("/invoices", {
      status: filter === "all" ? undefined : filter, q: dq || undefined, limit: 50, cursor,
    });
    setExtra((x) => [...x, ...r.data]); setCursor(r.nextCursor);
  };

  const rows = [...(list.data ?? []), ...extra];
  const canWrite = host.can("invoicing:invoice.write");
  const newBtn = canWrite && <Button onClick={() => host.navigate("/invoices/new")}><Plus /> New invoice</Button>;

  return (
    <>
      <PageHeader title="Invoices" description="Bill customers, track payments and follow up on overdue invoices." actions={newBtn} />
      <SummaryCards summary={summary.data} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList>{FILTERS.map((f) => <TabsTrigger key={f.value} value={f.value}>{f.label}</TabsTrigger>)}</TabsList>
        </Tabs>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search invoices" placeholder="Number or customer" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <Card>
        {list.loading && !list.data ? <div className="grid gap-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8" />)}</div>
          : list.error ? <ErrorState error={list.error} onRetry={() => void list.reload()} />
          : !rows.length ? (
            <EmptyState icon={<Receipt />} title={filter === "all" && !dq ? "No invoices yet" : "No matching invoices"}
              description={filter === "all" && !dq ? "Create your first invoice to start getting paid." : undefined}
              action={filter === "all" && !dq ? newBtn : undefined} />
          ) : (
            <>
              <InvoiceTable rows={rows} onOpen={(i) => host.navigate(`/invoices/${i.id}`)} />
              {cursor && <div className="border-t p-3 text-center"><Button variant="ghost" size="sm" onClick={() => void more()}>Load more</Button></div>}
            </>
          )}
      </Card>
    </>
  );
}
