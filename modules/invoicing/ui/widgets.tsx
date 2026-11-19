import { Plus, Receipt } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, Skeleton } from "@office/ui";
import { useModuleHost, type SlotProps } from "@office/ui/module-ui";
import { InvoiceTable } from "./InvoiceList.tsx";
import { fmtMoney, goWithQuery, useLoad, type Invoice, type Summary } from "./shared.tsx";

/** Tab on company and contact pages. */
export function CustomerInvoicesTab({ entityType, entityId }: SlotProps) {
  const host = useModuleHost();
  const key = entityType === "company" ? "companyId" : "contactId";
  const list = useLoad(() => host.api.get<{ data: Invoice[] }>("/invoices", { [key]: entityId, limit: 100 }), [host, key, entityId]);
  const create = host.can("invoicing:invoice.write") && (
    <Button size="sm" onClick={() => goWithQuery(host, "/invoices/new", { [key]: entityId ?? "" })}>
      <Plus /> New invoice
    </Button>
  );
  const rows = list.data?.data ?? [];
  const byCur = new Map<string, number>();
  for (const r of rows) if (r.status === "sent") byCur.set(r.currency, (byCur.get(r.currency) ?? 0) + r.balanceCents);

  return (
    <Card>
      {list.loading && !list.data ? <div className="grid gap-2 p-4"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
        : list.error ? <ErrorState error={list.error} onRetry={() => void list.reload()} />
        : !rows.length ? <EmptyState icon={<Receipt />} title="No invoices yet" action={create} />
        : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3 text-sm">
              <span className="text-muted-foreground">
                {byCur.size ? <>Outstanding: {[...byCur].map(([c, v]) => fmtMoney(v, c)).join(" · ")}</> : "Nothing outstanding"}
              </span>
              {create}
            </div>
            <InvoiceTable rows={rows} showCustomer={false} onOpen={(i) => host.navigate(`/invoices/${i.id}`)} />
          </>
        )}
    </Card>
  );
}

/** Dashboard widget: outstanding and overdue totals. */
export function OutstandingWidget() {
  const host = useModuleHost();
  const s = useLoad(() => host.api.get<Summary>("/summary"), [host]);
  const open = (status: string) => (status ? goWithQuery(host, "/invoices", { status }) : host.navigate("/invoices"));
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold">Invoices</p>
        <Button variant="link" size="sm" onClick={() => open("")}>View all</Button>
      </div>
      {s.loading && !s.data ? <Skeleton className="h-12" />
        : s.error ? <p className="text-sm text-muted-foreground">Could not load invoice totals.</p>
        : !s.data?.currencies.length ? <p className="text-sm text-muted-foreground">No invoices yet.</p>
        : (
          <div className="grid gap-3">
            {s.data.currencies.map((c) => (
              <div key={c.currency} className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Outstanding</p>
                  <p className="text-lg font-semibold tabular-nums" data-testid={`outstanding-${c.currency}`}>{fmtMoney(c.outstandingCents, c.currency)}</p>
                </div>
                <div>
                  <button type="button" className="cursor-pointer text-xs text-muted-foreground hover:underline" onClick={() => open("overdue")}>Overdue ({c.overdueCount})</button>
                  <p className={`text-lg font-semibold tabular-nums ${c.overdueCents ? "text-destructive" : ""}`}>{fmtMoney(c.overdueCents, c.currency)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
    </Card>
  );
}
