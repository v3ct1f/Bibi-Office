import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, Sparkles, Workflow as WorkflowIcon, Zap } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton, Switch, Table, TBody, TD, TH, THead, TR } from "@office/ui";
import type { Catalog, Workflow, WorkflowInput } from "../../api/types.ts";
import { useTMutation, useTQuery } from "../../api/hooks.ts";
import { useTenant } from "../../lib/tenant.tsx";
import { fmtRelative } from "../../lib/format.ts";
import { eventLabel, recipesFor } from "./vocab.ts";

export const toInput = (w: Workflow): WorkflowInput => ({ name: w.name, enabled: w.enabled, trigger: w.trigger, conditions: w.conditions ?? null, actions: w.actions });

export function WorkflowsPage() {
  const { api, tenant, can } = useTenant();
  const navigate = useNavigate();
  const list = useTQuery<Workflow[]>(["workflows"], "/workflows");
  const catalog = useTQuery<Catalog>(["workflow-catalog"], "/workflow-catalog");
  const recipes = recipesFor(catalog.data?.events ?? []);
  const manage = can("core:workflows.manage");
  const toggle = useTMutation((w: Workflow) => api.put(`/workflows/${w.id}`, { ...toInput(w), enabled: !w.enabled }), {
    invalidate: [["workflows"]], success: (_r, w) => (w.enabled ? "Workflow paused" : "Workflow enabled"),
  });
  const base = `/t/${tenant.slug}/workflows`;
  return (
    <>
      <PageHeader title="Workflows" description="Let Office do routine follow-ups for you: when something happens (a contact is added, an invoice is overdue), it runs the actions you choose."
        actions={manage && <Button asChild><Link to={`${base}/new`}><Plus /> New workflow</Link></Button>} />
      <Card>
        {list.isPending ? <div className="grid gap-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
          : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} />
          : !list.data.length ? (
            <div>
              <EmptyState icon={<WorkflowIcon />} title="No workflows yet"
                description="Every workflow has three parts: what starts it, optional conditions, and the actions to run. Start from a recipe or build your own."
                action={manage && <Button asChild variant="outline"><Link to={`${base}/new`}><Plus /> Build your own</Link></Button>} />
              {manage && recipes.length > 0 && (
                <div className="grid gap-2 border-t p-4 sm:grid-cols-2">
                  {recipes.map((r) => (
                    <Link key={r.id} to={`${base}/new`} search={{ recipe: r.id }} className="rounded-md border p-3 hover:border-primary hover:bg-muted/40">
                      <span className="flex items-center gap-1.5 text-sm font-medium"><Sparkles className="size-3.5 text-primary" />{r.title}</span>
                      <span className="block text-xs text-muted-foreground">{r.description}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <Table>
              <THead><TR><TH>Name</TH><TH className="hidden md:table-cell">Starts when</TH><TH className="hidden sm:table-cell">Actions</TH><TH className="hidden lg:table-cell">Updated</TH><TH>On</TH></TR></THead>
              <TBody>
                {list.data.map((w) => (
                  <TR key={w.id} className="cursor-pointer" onClick={() => navigate({ to: `${base}/${w.id}` })}>
                    <TD className="font-medium">{w.name}</TD>
                    <TD className="hidden md:table-cell"><Badge variant="outline" title={w.trigger.event}><Zap className="size-3" />{eventLabel(w.trigger.event)}</Badge></TD>
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
