import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { ArrowDown, ArrowLeft, ArrowUp, ChevronRight, Filter, Play, Plus, Sparkles, Trash2, X, Zap } from "lucide-react";
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, EmptyState, ErrorState, Input, Label, PageHeader, SchemaForm, Select,
  Skeleton, Switch, Table, TBody, TD, TH, THead, TR, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, cn, toast,
} from "@office/ui";
import type { Catalog, Workflow, WorkflowAction, WorkflowInput, WorkflowRun } from "../../api/types.ts";
import { useTMutation, useTQuery } from "../../api/hooks.ts";
import { useTenant } from "../../lib/tenant.tsx";
import { fmtDateTime, fmtRelative } from "../../lib/format.ts";
import { OPS, logicToRows, rowsToLogic, type Op, type Rows } from "./conditions.ts";
import { toInput } from "./Workflows.tsx";
import { eventFields, eventGroup, eventLabel, fieldLabel, RECIPES, recipesFor, type EventField, type Recipe } from "./vocab.ts";

const blank: WorkflowInput = { name: "", enabled: true, trigger: { event: "" }, conditions: null, actions: [] };

function Step({ n, icon: Icon, title, hint, children }: { n: number; icon: typeof Zap; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="relative grid grid-cols-[2rem_1fr] gap-4">
      <div className="flex flex-col items-center">
        <span className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground"><Icon className="size-4" /></span>
        <span className="w-px flex-1 bg-border" aria-hidden />
      </div>
      <Card className="mb-5 min-w-0"><CardHeader className="pb-3"><CardTitle className="text-sm"><span className="text-muted-foreground">{n}.</span> {title}</CardTitle>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</CardHeader><CardContent>{children}</CardContent></Card>
    </div>
  );
}

const OTHER = "__other";

function FieldPicker({ i, path, fields, disabled, onChange }: { i: number; path: string; fields: EventField[]; disabled: boolean; onChange: (p: string) => void }) {
  const known = fields.some((f) => f.path === path);
  if (!fields.length) {
    return <Input aria-label={`Condition ${i + 1} field`} className="font-mono text-xs" disabled={disabled} value={path} placeholder="payload.email" onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <div className="grid gap-2">
      <Select aria-label={`Condition ${i + 1} field`} disabled={disabled} value={known ? path : OTHER} onChange={(e) => onChange(e.target.value === OTHER ? "payload." : e.target.value)}>
        {fields.map((f) => <option key={f.path} value={f.path}>{f.label}</option>)}
        <option value={OTHER}>Other detail…</option>
      </Select>
      {!known && <Input aria-label={`Condition ${i + 1} custom field`} className="font-mono text-xs" disabled={disabled} value={path} placeholder="payload.someField" onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

function ConditionEditor({ value, onChange, disabled, fields }: { value: unknown; onChange: (v: unknown) => void; disabled: boolean; fields: EventField[] }) {
  const parsed = useMemo(() => logicToRows(value), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [advanced, setAdvanced] = useState(parsed === null);
  const [rows, setRows] = useState<Rows>(parsed ?? { mode: "all", rows: [] });
  const [raw, setRaw] = useState(value == null ? "" : JSON.stringify(value, null, 2));
  const [rawErr, setRawErr] = useState<string | null>(null);
  const update = (r: Rows) => { setRows(r); onChange(rowsToLogic(r)); };

  if (advanced) {
    return (
      <div className="grid gap-2">
        <Textarea aria-label="JSONLogic conditions" rows={6} className="font-mono text-xs" disabled={disabled} value={raw}
          placeholder='{"==": [{"var": "payload.status"}, "won"]}'
          onChange={(e) => {
            setRaw(e.target.value);
            if (!e.target.value.trim()) { setRawErr(null); return onChange(null); }
            try { onChange(JSON.parse(e.target.value)); setRawErr(null); } catch { setRawErr("Invalid JSON"); }
          }} />
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className={rawErr ? "text-destructive" : "text-muted-foreground"}>{rawErr ?? <>JSONLogic over <code>{"{ event, payload }"}</code></>}</span>
          <Button size="sm" variant="link" disabled={logicToRows(value) === null}
            onClick={() => { const r = logicToRows(value); if (r) { setRows(r); setAdvanced(false); } }}>Use simple editor</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      {rows.rows.length === 0 && <p className="text-sm text-muted-foreground">No conditions: runs every time. Add one to run only in some cases, e.g. only invoices above a certain amount.</p>}
      {rows.rows.length > 1 && (
        <div className="flex items-center gap-2 text-sm">Match
          <Select aria-label="Match mode" className="h-8 w-24" value={rows.mode} disabled={disabled} onChange={(e) => update({ ...rows, mode: e.target.value as Rows["mode"] })}>
            <option value="all">all</option><option value="any">any</option>
          </Select>of these:
        </div>
      )}
      {rows.rows.map((r, i) => (
        <div key={i} className="grid items-start gap-2 sm:grid-cols-[1fr_10rem_1fr_auto]">
          <FieldPicker i={i} path={r.path} fields={fields} disabled={disabled}
            onChange={(path) => update({ ...rows, rows: rows.rows.map((x, j) => (j === i ? { ...x, path } : x)) })} />
          <Select aria-label={`Condition ${i + 1} operator`} disabled={disabled} value={r.op}
            onChange={(e) => update({ ...rows, rows: rows.rows.map((x, j) => (j === i ? { ...x, op: e.target.value as Op } : x)) })}>
            {OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
          </Select>
          <Input aria-label={`Condition ${i + 1} value`} disabled={disabled || r.op === "exists"} value={r.op === "exists" ? "" : r.value} placeholder="value"
            onChange={(e) => update({ ...rows, rows: rows.rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
          <Button variant="ghost" size="icon" aria-label={`Remove condition ${i + 1}`} disabled={disabled} onClick={() => update({ ...rows, rows: rows.rows.filter((_, j) => j !== i) })}><X /></Button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => update({ ...rows, rows: [...rows.rows, { path: fields[0]?.path ?? "payload.", op: "==", value: "" }] })}><Plus /> Add condition</Button>
        <Button size="sm" variant="link" onClick={() => { setRaw(JSON.stringify(rowsToLogic(rows), null, 2)); setAdvanced(true); }}>Advanced (JSONLogic)</Button>
      </div>
    </div>
  );
}

function ActionCard({ i, count, action, catalog, onChange, onMove, onRemove, disabled }: {
  i: number; count: number; action: WorkflowAction; catalog: Catalog; disabled: boolean;
  onChange: (a: WorkflowAction) => void; onMove: (d: -1 | 1) => void; onRemove: () => void;
}) {
  const spec = catalog.actions.find((a) => a.key === action.key);
  const modules = [...new Set(catalog.actions.map((a) => a.module))];
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="mb-3 flex items-center gap-2">
        <Badge variant="neutral" className="font-mono">#{i}</Badge>
        <Select aria-label={`Step ${i + 1} action`} className="flex-1" disabled={disabled} value={action.key} onChange={(e) => onChange({ key: e.target.value, input: {} })}>
          <option value="">Choose an action…</option>
          {modules.map((m) => (
            <optgroup key={m} label={m === "core" ? "Core" : m}>
              {catalog.actions.filter((a) => a.module === m).map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </optgroup>
          ))}
        </Select>
        <Button variant="ghost" size="icon" aria-label="Move up" disabled={disabled || i === 0} onClick={() => onMove(-1)}><ArrowUp /></Button>
        <Button variant="ghost" size="icon" aria-label="Move down" disabled={disabled || i === count - 1} onClick={() => onMove(1)}><ArrowDown /></Button>
        <Button variant="ghost" size="icon" aria-label={`Remove step ${i + 1}`} disabled={disabled} onClick={onRemove}><Trash2 /></Button>
      </div>
      {spec ? <SchemaForm schema={spec.input} value={action.input} onChange={(input) => onChange({ ...action, input })} template disabled={disabled} />
        : action.key ? <p className="text-sm text-destructive">Unknown action “{action.key}” (module disabled or removed).</p> : null}
    </div>
  );
}

/** Put `text` at the cursor of the last focused field (React-safe), or copy it when no field was focused. */
function insertInto(el: HTMLInputElement | HTMLTextAreaElement | null, text: string) {
  if (!el || !el.isConnected || el.disabled) {
    void navigator.clipboard?.writeText(text).then(() => toast.success("Copied. Click into a field and paste it."), () => toast.error("Click into a field first"));
    return;
  }
  const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? el.value.length;
  const next = el.value.slice(0, start) + text + el.value.slice(end);
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, next);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.focus();
  el.setSelectionRange(start + text.length, start + text.length);
}

function ValueChips({ fields, onPick }: { fields: EventField[]; onPick: (token: string) => void }) {
  if (!fields.length) return null;
  return (
    <div className="grid gap-2 rounded-md border border-dashed p-3">
      <p className="text-xs text-muted-foreground">Click into a field above, then pick a detail to fill it in from the event:</p>
      <div className="flex flex-wrap gap-1.5">
        {fields.map((f) => (
          <button key={f.path} type="button" title={`{{${f.path}}}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(`{{${f.path}}}`)}
            className="rounded-full border bg-background px-2.5 py-0.5 text-xs hover:border-primary hover:text-primary">
            + {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const OP_WORDS: Record<Op, string> = { "==": "is", "!=": "is not", ">": "is more than", ">=": "is at least", "<": "is less than", "<=": "is at most", in: "contains", exists: "is set" };

/** One plain-English sentence describing the whole workflow. */
export function describeWorkflow(wf: WorkflowInput, cat: Catalog): string | null {
  if (!wf.trigger.event) return null;
  let s = `When ${eventLabel(wf.trigger.event).replace(/^(A|An|The|Someone)\b/, (m) => m.toLowerCase())}`;
  const rows = logicToRows(wf.conditions);
  if (rows === null) s += ", and the advanced conditions match";
  else if (rows.rows.length) {
    const parts = rows.rows.filter((r) => r.path.trim()).map((r) => `${fieldLabel(wf.trigger.event, r.path).toLowerCase()} ${OP_WORDS[r.op]}${r.op === "exists" ? "" : ` “${r.value}”`}`);
    if (parts.length) s += `, and ${parts.join(rows.mode === "all" ? " and " : " or ")}`;
  }
  const acts = wf.actions.filter((a) => a.key).map((a) => (cat.actions.find((x) => x.key === a.key)?.label ?? a.key).toLowerCase());
  s += acts.length ? `, then ${acts.join(", then ")}.` : ", then … (add an action below).";
  return s;
}

function RecipePicker({ recipes, onPick }: { recipes: Recipe[]; onPick: (r: Recipe) => void }) {
  if (!recipes.length) return null;
  return (
    <Card className="mb-5">
      <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><Sparkles className="size-4 text-primary" /> Start from a recipe</CardTitle>
        <p className="text-xs text-muted-foreground">Pick one to fill in the steps for you, then change anything you like. Or build your own below.</p></CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {recipes.map((r) => (
          <button key={r.id} type="button" onClick={() => onPick(r)} className="rounded-md border p-3 text-left hover:border-primary hover:bg-muted/40">
            <span className="block text-sm font-medium">{r.title}</span>
            <span className="block text-xs text-muted-foreground">{r.description}</span>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

const RUN: Record<WorkflowRun["status"], "success" | "destructive" | "warning" | "neutral"> = {
  succeeded: "success", failed: "destructive", pending: "warning", running: "warning", skipped: "neutral", cancelled: "neutral",
};

function Runs({ id }: { id: string }) {
  const runs = useTQuery<WorkflowRun[]>(["workflows", id, "runs"], `/workflows/${id}/runs`, { limit: 50 });
  const [open, setOpen] = useState<string | null>(null);
  if (runs.isPending) return <Skeleton className="h-24" />;
  if (runs.isError) return <ErrorState error={runs.error} onRetry={() => runs.refetch()} />;
  if (!runs.data.length) return <Card><EmptyState icon={<Play />} title="No runs yet" description="Runs appear when the trigger event happens and conditions match." /></Card>;
  return (
    <Card>
      <Table>
        <THead><TR><TH className="w-8" /><TH>Status</TH><TH>Started</TH><TH className="hidden sm:table-cell">Duration</TH><TH className="hidden md:table-cell">Version</TH></TR></THead>
        <TBody>
          {runs.data.map((r) => (
            <Fragment key={r.id}>
              <TR className="cursor-pointer" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                <TD><ChevronRight className={cn("size-4 text-muted-foreground transition-transform", open === r.id && "rotate-90")} /></TD>
                <TD><Badge variant={RUN[r.status]}>{r.status}</Badge></TD>
                <TD title={fmtDateTime(r.startedAt)}>{fmtRelative(r.startedAt)}</TD>
                <TD className="hidden sm:table-cell text-muted-foreground">{r.endedAt ? `${((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 1000).toFixed(1)}s` : "—"}</TD>
                <TD className="hidden md:table-cell text-muted-foreground">v{r.workflowVersion}</TD>
              </TR>
              {open === r.id && (
                <TR className="hover:bg-transparent"><TD colSpan={5} className="bg-muted/40">
                  {r.error && <p className="mb-2 text-sm text-destructive">{r.error}</p>}
                  <ol className="grid gap-1.5 text-xs">
                    {r.steps.map((s, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-2">
                        <Badge variant={s.status === "succeeded" ? "success" : s.status === "failed" ? "destructive" : "neutral"}>#{i} {s.status}</Badge>
                        <code className="font-mono">{s.key}</code>
                        {s.error && <span className="text-destructive">{s.error}</span>}
                        {s.output != null && <code className="max-w-full truncate font-mono text-muted-foreground">{JSON.stringify(s.output)}</code>}
                      </li>
                    ))}
                    {!r.steps.length && <li className="text-muted-foreground">No steps executed.</li>}
                  </ol>
                  <p className="mt-2 font-mono text-[11px] text-muted-foreground">event {r.eventId}</p>
                </TD></TR>
              )}
            </Fragment>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

export function WorkflowEditor() {
  const { id } = useParams({ strict: false }) as { id?: string };
  const isNew = !id;
  const { api, tenant, can } = useTenant();
  const navigate = useNavigate();
  const catalog = useTQuery<Catalog>(["workflow-catalog"], "/workflow-catalog");
  const existing = useTQuery<Workflow>(["workflows", id], `/workflows/${id}`, undefined, { enabled: !isNew });
  const search = useSearch({ strict: false }) as { recipe?: string };
  const [wf, setWf] = useState<WorkflowInput | null>(isNew ? (RECIPES.find((r) => r.id === search.recipe)?.build() ?? blank) : null);
  const lastField = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => { if (existing.data) setWf(toInput(existing.data)); }, [existing.data]);
  const manage = can("core:workflows.manage");
  const base = `/t/${tenant.slug}/workflows`;

  const save = useTMutation((w: WorkflowInput) => (isNew ? api.post<Workflow>("/workflows", w) : api.put<Workflow>(`/workflows/${id}`, w)), {
    invalidate: [["workflows"]], success: isNew ? "Workflow created" : "Workflow saved",
    onSuccess: (r) => { if (isNew) void navigate({ to: `${base}/${r.id}`, replace: true }); },
  });
  const del = useTMutation(() => api.del(`/workflows/${id}`), { invalidate: [["workflows"]], success: "Workflow deleted", onSuccess: () => navigate({ to: base }) });

  const back = <Link to={base} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Workflows</Link>;
  if (catalog.isError || existing.isError) return <>{back}<Card><ErrorState error={catalog.error ?? existing.error} /></Card></>;
  if (!wf || !catalog.data) return <>{back}<Skeleton className="h-10 w-72" /><Skeleton className="mt-6 h-64" /></>;
  const cat = catalog.data;
  const groups = [...new Set(cat.events.map(eventGroup))];
  const fields = eventFields(wf.trigger.event);
  const summary = describeWorkflow(wf, cat);
  const isBlank = isNew && !wf.trigger.event && !wf.actions.length;
  const setActions = (actions: WorkflowAction[]) => setWf({ ...wf, actions });
  const valid = wf.name.trim() && wf.trigger.event && wf.actions.length > 0 && wf.actions.every((a) => a.key);

  const builder = (
    <form onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(wf); }}>
      {isBlank && manage && <RecipePicker recipes={recipesFor(cat.events, cat.actions.map((a) => a.key))} onPick={(r) => setWf(r.build())} />}
      {summary && (
        <p data-testid="workflow-summary" className="mb-5 rounded-md border-l-4 border-primary bg-muted/40 px-4 py-3 text-sm">{summary}</p>
      )}
      <Step n={1} icon={Zap} title="When this happens" hint="The event that starts this workflow.">
        <Select aria-label="Trigger event" disabled={!manage} value={wf.trigger.event} onChange={(e) => setWf({ ...wf, trigger: { event: e.target.value } })}>
          <option value="">Choose what starts it…</option>
          {groups.map((g) => <optgroup key={g} label={g}>{cat.events.filter((e) => eventGroup(e) === g).map((e) => <option key={e} value={e}>{eventLabel(e)}</option>)}</optgroup>)}
        </Select>
      </Step>
      <Step n={2} icon={Filter} title="Only if (optional)" hint="Skip the actions unless these details match.">
        <ConditionEditor key={wf.trigger.event} value={wf.conditions} onChange={(conditions) => setWf({ ...wf, conditions })} disabled={!manage} fields={fields} />
      </Step>
      <Step n={3} icon={Play} title="Then do this" hint="Actions run in order, top to bottom.">
        <div className="grid gap-3" onFocusCapture={(e) => {
          const t = e.target;
          if ((t instanceof HTMLInputElement && t.type === "text") || t instanceof HTMLTextAreaElement) lastField.current = t;
        }}>
          {wf.actions.map((a, i) => (
            <ActionCard key={i} i={i} count={wf.actions.length} action={a} catalog={cat} disabled={!manage}
              onChange={(na) => setActions(wf.actions.map((x, j) => (j === i ? na : x)))}
              onRemove={() => setActions(wf.actions.filter((_, j) => j !== i))}
              onMove={(d) => { const n = [...wf.actions]; [n[i], n[i + d]] = [n[i + d]!, n[i]!]; setActions(n); }} />
          ))}
          {manage && wf.actions.length < 50 && <Button variant="outline" className="justify-self-start" onClick={() => setActions([...wf.actions, { key: "", input: {} }])}><Plus /> Add action</Button>}
          {manage && wf.actions.some((a) => a.key) && <ValueChips fields={fields} onPick={(t) => insertInto(lastField.current, t)} />}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">How do the {"{{ }}"} values work?</summary>
            <p className="mt-1">Text like <code className="font-mono">{"{{payload.email}}"}</code> is replaced with that detail of the event when the workflow runs.
              You can also use results of earlier actions, e.g. <code className="font-mono">{"{{steps.0.taskId}}"}</code> for the task created by action #0.</p>
          </details>
        </div>
      </Step>
      {manage && (
        <div className="flex justify-end gap-2 pl-12">
          <Button variant="outline" asChild><Link to={base}>Cancel</Link></Button>
          <Button type="submit" loading={save.isPending} disabled={!valid}>{isNew ? "Create workflow" : "Save changes"}</Button>
        </div>
      )}
    </form>
  );

  return (
    <>
      {back}
      <PageHeader
        title={
          <div className="flex items-center gap-3">
            <Label htmlFor="wf-name" className="sr-only">Workflow name</Label>
            <Input id="wf-name" disabled={!manage} className="h-9 w-[min(28rem,70vw)] text-lg font-semibold" placeholder="Untitled workflow"
              value={wf.name} onChange={(e) => setWf({ ...wf, name: e.target.value })} maxLength={200} />
          </div>
        }
        actions={<>
          <label className="flex items-center gap-2 text-sm">Enabled<Switch disabled={!manage} checked={wf.enabled} onCheckedChange={(enabled) => setWf({ ...wf, enabled })} /></label>
          {!isNew && manage && <Button variant="ghost" className="text-destructive" onClick={() => setDeleting(true)}><Trash2 /> Delete</Button>}
        </>}
      />
      {isNew ? builder : (
        <Tabs defaultValue="builder">
          <TabsList><TabsTrigger value="builder">Builder</TabsTrigger><TabsTrigger value="runs">Runs</TabsTrigger></TabsList>
          <TabsContent value="builder">{builder}</TabsContent>
          <TabsContent value="runs"><Runs id={id!} /></TabsContent>
        </Tabs>
      )}
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} destructive confirmLabel="Delete" title="Delete this workflow?"
        description="It stops running immediately. Past runs remain in history." onConfirm={() => del.mutateAsync(undefined)} />
    </>
  );
}
