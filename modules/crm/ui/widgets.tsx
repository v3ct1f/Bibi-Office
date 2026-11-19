import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Spinner, Table, TBody, TD, TH, THead, TR } from "@office/ui";
import type { SlotProps } from "@office/sdk/ui";
import { Timeline } from "./activity.tsx";
import { DealStatus, money, P, ROOT } from "./common.tsx";
import { NewDealDialog } from "./pages.tsx";
import type { Deal, Page, Summary } from "./types.ts";

/** dashboard.widget: open pipeline, weighted forecast, won this month, tasks due. */
export function PipelineWidget({ api, tenantId, navigate, errorMessage }: SlotProps) {
  const q = useQuery({ queryKey: ["tenant", tenantId, "crm", "summary"], queryFn: () => api.get<Summary>("/summary") });
  return (
    <Card>
      <CardHeader><CardTitle>Pipeline</CardTitle></CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {q.isPending ? <Spinner /> : q.isError ? <Alert>{errorMessage(q.error)}</Alert> : (
          <>
            {q.data.data.length === 0 ? <p className="text-muted">No deals yet.</p> : q.data.data.map((r) => (
              <dl key={r.currency} className="grid grid-cols-2 gap-y-1">
                <dt className="text-muted">Open ({r.openCount})</dt><dd className="text-right font-medium tabular-nums">{money(r.openValue, r.currency)}</dd>
                <dt className="text-muted">Weighted</dt><dd className="text-right tabular-nums">{money(r.weighted, r.currency)}</dd>
                <dt className="text-muted">Won this month ({r.wonCount})</dt><dd className="text-right tabular-nums text-success">{money(r.wonValue, r.currency)}</dd>
              </dl>
            ))}
            {q.data.tasksDue > 0 && <p><span className="font-medium text-danger">{q.data.tasksDue}</span> task{q.data.tasksDue === 1 ? "" : "s"} due today or overdue</p>}
          </>
        )}
        <Button variant="outline" size="sm" onClick={() => navigate(ROOT)}>Open pipeline</Button>
      </CardContent>
    </Card>
  );
}

/** entity.tab:contact / entity.tab:company: deals for this contact or company. */
export function DealsTab(props: SlotProps) {
  const { api, tenantId, entity, navigate, can, errorMessage } = props;
  const field = entity!.type === "company" ? "companyId" : "contactId";
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ["tenant", tenantId, "crm", "deals", { [field]: entity!.id }],
    queryFn: () => api.get<Page<Deal>>(`/deals?${field}=${entity!.id}&limit=50`),
  });
  return (
    <div className="grid gap-3">
      {can(P.write) && <div><Button size="sm" onClick={() => setCreating(true)}>New deal</Button></div>}
      {q.isPending ? <Spinner /> : q.isError ? <Alert>{errorMessage(q.error)}</Alert> : q.data.data.length === 0 ? (
        <p className="text-sm text-muted">No deals yet.</p>
      ) : (
        <Table>
          <THead><TR><TH>Deal</TH><TH className="text-right">Value</TH><TH>Status</TH></TR></THead>
          <TBody>{q.data.data.map((d) => (
            <TR key={d.id} className="cursor-pointer" onClick={() => navigate(`${ROOT}/${d.id}`)}>
              <TD className="font-medium">{d.title}</TD><TD className="text-right tabular-nums">{money(d.value, d.currency)}</TD><TD><DealStatus d={d} /></TD>
            </TR>
          ))}</TBody>
        </Table>
      )}
      {creating && <NewDealDialog {...props} prefill={{ [field]: entity!.id } as Partial<Deal>} onClose={() => setCreating(false)} />}
    </div>
  );
}

/** entity.tab:contact / entity.tab:company: activity timeline. */
export function ActivityTab(props: SlotProps) {
  const field = props.entity!.type === "company" ? "companyId" : "contactId";
  return <Timeline {...props} filter={{ [field]: props.entity!.id }} />;
}
