import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, Workflow as WorkflowIcon, Zap } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton, Switch, Table, TBody, TD, TH, THead, TR } from "@office/ui";
import type { Workflow, WorkflowInput } from "../../api/types.ts";
import { useTMutation, useTQuery } from "../../api/hooks.ts";
import { useTenant } from "../../lib/tenant.tsx";
import { fmtRelative } from "../../lib/format.ts";

export const toInput = (w: Workflow): WorkflowInput => ({ name: w.name, enabled: w.enabled, trigger: w.trigger, conditions: w.conditions ?? null, actions: w.actions });

export function WorkflowsPage() {
  const { api, tenant, can } = useTenant();
  const navigate = useNavigate();
  const list = useTQuery<Workflow[]>(["workflows"], "/workflows");
  const manage = can("core:workflows.manage");
  const toggle = useTMutation((w: Workflow) => api.put(`/workflows/${w.id}`, { ...toInput(w), enabled: !w.enabled }), {
    invalidate: [["workflows"]], success: (_r, w) => (w.enabled ? "Workflow paused" : "Workflow enabled"),
  });
  const base = `/t/${tenant.slug}/workflows`;
  return (
    <>
      <PageHeader title="Workflows" description="When something happens, check conditions, then run actions automatically."
        actions={manage && <Button asChild><Link to={`${base}/new`}><Plus /> New workflow</Link></Button>} />
      <Card>
        {list.isPending ? <div className="grid gap-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
          : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} />
          : !list.data.length ? (
            <EmptyState icon={<WorkflowIcon />} title="No workflows yet"
              description="Example: when a contact is created, create a follow-up task for sales."
              action={manage && <Button asChild variant="outline"><Link to={`${base}/new`}><Plus /> New workflow</Link></Button>} />
          ) : (
            <Table>
              <THead><TR><TH>Name</TH><TH className="hidden md:table-cell">Trigger</TH><TH className="hidden sm:table-cell">Steps</TH><TH className="hidden lg:table-cell">Updated</TH><TH>On</TH></TR></THead>
              <TBody>
                {list.data.map((w) => (
                  <TR key={w.id} className="cursor-pointer" onClick={() => navigate({ to: `${base}/${w.id}` })}>
                    <TD className="font-medium">{w.name}</TD>
                    <TD className="hidden md:table-cell"><Badge variant="outline" className="font-mono"><Zap className="size-3" />{w.trigger.event}</Badge></TD>
                    <TD className="hidden sm:table-cell text-muted-foreground">{w.actions.length}</TD>
                    <TD className="hidden lg:table-cell text-muted-foreground">{fmtRelative(w.updatedAt)} · v{w.version}</TD>
                    <TD onClick={(e) => e.stopPropagation()}><Switch aria-label={`Toggle ${w.name}`} checked={w.enabled} disabled={!manage} onCheckedChange={() => toggle.mutate(w)} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
      </Card>
    </>
  );
}
