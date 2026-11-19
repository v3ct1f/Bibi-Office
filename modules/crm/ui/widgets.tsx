import { Handshake, Plus } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, Skeleton } from "@office/ui";
import { useModuleHost, type SlotProps } from "@office/ui/module-ui";
import { DealTable } from "./DealBoard.tsx";
import { fmtMoney, goWithQuery, useLoad, type Deal, type Summary } from "./shared.tsx";

/** Tab on company and contact pages. */
export function CustomerDealsTab({ entityType, entityId }: SlotProps) {
  const host = useModuleHost();
  const key = entityType === "company" ? "companyId" : "contactId";
  const list = useLoad(() => host.api.get<{ data: Deal[] }>("/deals", { [key]: entityId, limit: 100 }), [host, key, entityId]);
  const create = host.can("crm:deal.write") && (
    <Button size="sm" onClick={() => goWithQuery(host, "/deals/new", { [key]: entityId ?? "" })}><Plus /> New deal</Button>
  );
  const rows = list.data?.data ?? [];
  const open = new Map<string, number>();
  for (const r of rows) if (r.status === "open") open.set(r.currency, (open.get(r.currency) ?? 0) + r.valueCents);
  return (
    <Card>
      {list.loading && !list.data ? <div className="grid gap-2 p-4"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
        : list.error ? <ErrorState error={list.error} onRetry={() => void list.reload()} />
        : !rows.length ? <EmptyState icon={<Handshake />} title="No deals yet" description="Track a possible sale with this customer." action={create} />
        : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3 text-sm">
              <span className="text-muted-foreground">{open.size ? <>Open: {[...open].map(([c, v]) => fmtMoney(v, c)).join(" · ")}</> : "No open deals"}</span>
              {create}
            </div>
            <DealTable rows={rows} showCustomer={false} onOpen={(d) => host.navigate(`/deals/${d.id}`)} />
          </>
        )}
    </Card>
  );
}

/** Dashboard widget: open pipeline, weighted forecast and next steps due. */
export function PipelineWidget() {
  const host = useModuleHost();
  const s = useLoad(() => host.api.get<Summary>("/summary"), [host]);
  const c = s.data?.currencies[0];
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold">Sales pipeline</p>
        <Button variant="link" size="sm" onClick={() => host.navigate("/deals")}>Open board</Button>
      </div>
      {s.loading && !s.data ? <Skeleton className="h-12" />
        : s.error ? <p className="text-sm text-muted-foreground">Could not load the pipeline.</p>
        : !c ? <p className="text-sm text-muted-foreground">No deals yet.</p>
        : (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs text-muted-foreground">Open ({c.openCount})</p><p className="text-lg font-semibold tabular-nums" data-testid={`pipeline-${c.currency}`}>{fmtMoney(c.openCents, c.currency)}</p></div>
              <div><p className="text-xs text-muted-foreground">Won this month</p><p className="text-lg font-semibold tabular-nums text-success">{fmtMoney(c.wonMonthCents, c.currency)}</p></div>
            </div>
            {s.data!.nextStepsDue > 0 && (
              <p className="text-sm text-destructive">{s.data!.nextStepsDue} deal{s.data!.nextStepsDue === 1 ? " has a" : "s have"} next step due</p>
            )}
          </div>
        )}
    </Card>
  );
}
