import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Spinner, Table, TBody, TD, TH, THead, TR } from "@office/ui";
import type { SlotProps } from "@office/sdk/ui";
import { fmtDay, money, P, ROOT, StatusBadge } from "./common.tsx";
import type { Invoice, Page, Summary } from "./types.ts";

/** dashboard.widget: outstanding and overdue amounts per currency. */
export function OutstandingWidget({ api, tenantId, navigate, errorMessage }: SlotProps) {
  const q = useQuery({ queryKey: ["tenant", tenantId, "invoicing", "summary"], queryFn: () => api.get<Summary>("/summary") });
  return (
    <Card>
      <CardHeader><CardTitle>Invoices</CardTitle></CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {q.isPending ? <Spinner /> : q.isError ? <Alert>{errorMessage(q.error)}</Alert> : q.data.data.length === 0 ? (
          <p className="text-muted">No invoices yet.</p>
        ) : q.data.data.map((r) => (
          <div key={r.currency} className="grid grid-cols-2 gap-y-1">
            <span className="text-muted">Outstanding</span><span className="text-right font-medium tabular-nums">{money(r.outstanding, r.currency)}</span>
            <span className="text-muted">Overdue ({r.overdueCount})</span>
            <span className={`text-right tabular-nums ${r.overdue ? "font-medium text-danger" : ""}`}>{money(r.overdue, r.currency)}</span>
            <span className="text-muted">Paid, last 30 days</span><span className="text-right tabular-nums">{money(r.paid30d, r.currency)}</span>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => navigate(ROOT)}>Open invoices</Button>
      </CardContent>
    </Card>
  );
}

/** entity.tab:contact: this contact's invoices. */
export function ContactInvoicesTab({ api, tenantId, entity, navigate, can, errorMessage }: SlotProps) {
  const id = entity!.id;
  const q = useQuery({
    queryKey: ["tenant", tenantId, "invoicing", "invoices", { contactId: id }],
    queryFn: () => api.get<Page<Invoice>>(`/invoices?contactId=${id}&limit=50`),
  });
  return (
    <div className="grid gap-3">
      {can(P.write) && <div><Button size="sm" onClick={() => navigate(`${ROOT}/new/${id}`)}>New invoice</Button></div>}
      {q.isPending ? <Spinner /> : q.isError ? <Alert>{errorMessage(q.error)}</Alert> : q.data.data.length === 0 ? (
        <p className="text-sm text-muted">No invoices for this contact.</p>
      ) : (
        <Table>
          <THead><TR><TH>Number</TH><TH>Due</TH><TH className="text-right">Total</TH><TH>Status</TH></TR></THead>
          <TBody>{q.data.data.map((i) => (
            <TR key={i.id} className="cursor-pointer" onClick={() => navigate(`${ROOT}/${i.id}`)}>
              <TD className="font-medium">{i.number ?? "Draft"}</TD><TD>{fmtDay(i.dueDate)}</TD>
              <TD className="text-right tabular-nums">{money(i.total, i.currency)}</TD><TD><StatusBadge inv={i} /></TD>
            </TR>
          ))}</TBody>
        </Table>
      )}
    </div>
  );
}
