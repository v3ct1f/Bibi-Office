import { useState } from "react";
import { Banknote, CircleCheck, FilePen, Plus, Receipt, Search, Settings2 } from "lucide-react";
import {
  Button, Card, EmptyState, ErrorState, Input, PageHeader, Skeleton, Table, TBody, TD, TH, THead, TR, Tabs, TabsList, TabsTrigger,
} from "@office/ui";
import { useModuleHost } from "@office/ui/module-ui";
import { fmtDate, fmtMoney, StatusBadge, useDebounced, useLoad, type Config, type Invoice, type Summary } from "./shared.tsx";

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

const HOW = [
  { icon: <FilePen />, title: "1. Create a draft", text: "Pick the customer, add what you are billing for. Drafts can be changed freely." },
  { icon: <CircleCheck />, title: "2. Finalize and send", text: "Finalizing gives it a number and locks it. Print or save as PDF and send it to your customer." },
  { icon: <Banknote />, title: "3. Record payment", text: "When the money arrives, record it. Late invoices are flagged as overdue automatically." },
];

function HowItWorks() {
  return (
    <div className="grid gap-3 p-5 sm:grid-cols-3">
      {HOW.map((h) => (
        <div key={h.title} className="grid content-start gap-1.5 rounded-md border p-4">
          <div className="text-primary [&_svg]:size-5">{h.icon}</div>
          <p className="font-medium">{h.title}</p>
          <p className="text-sm text-muted-foreground">{h.text}</p>
        </div>
      ))}
    </div>
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
  const config = useLoad(() => host.api.get<Config>("/config"), [host]);
  const canSetup = host.can("core:modules.manage");
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
  const settingsBtn = canSetup && <Button variant="outline" onClick={() => host.navigate("/settings")}><Settings2 /> Invoice settings</Button>;
  const needsSetup = canSetup && config.data && !config.data.seller.name;

  return (
    <>
      <PageHeader title="Invoices" description="Bill customers, track payments and follow up on overdue invoices." actions={<>{settingsBtn}{newBtn}</>} />
      {needsSetup && (
        <Card className="mb-4 flex flex-wrap items-center gap-4 border-primary/30 bg-primary/5 p-4" role="status">
          <Settings2 className="size-5 text-primary" />
          <div className="grid min-w-60 flex-1 gap-0.5">
            <p className="font-semibold">Set up your invoice details first</p>
            <p className="text-sm text-muted-foreground">Add your logo, business name, address and bank details once. They are printed on every invoice.</p>
          </div>
          <Button onClick={() => host.navigate("/settings")}>Set up invoice details</Button>
        </Card>
      )}
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
            filter === "all" && !dq ? (
              <>
                <EmptyState icon={<Receipt />} title="No invoices yet" description="Here is how invoicing works:" className="pb-0" />
                <HowItWorks />
                <div className="flex justify-center pb-6">{newBtn}</div>
              </>
            ) : <EmptyState icon={<Receipt />} title="No matching invoices" />
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
