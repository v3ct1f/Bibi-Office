import { useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Field, Input, PageHeader, Select, Switch, Table, TBody, TD, TH, THead, TR, Textarea } from "@office/ui";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { del, errorMessage, get, post, put } from "../lib/api.ts";
import { useSession } from "../lib/session.tsx";
import type { Catalog, JsonSchema, Workflow, WorkflowRun } from "../lib/types.ts";
import { ConfirmButton, QueryView, fmtDate } from "../components/common.tsx";

const runTone = (s: string) => (s === "succeeded" ? "success" : s === "failed" ? "danger" : s === "running" ? "primary" : "neutral") as "success";

export function WorkflowsPage() {
  const s = useSession();
  const list = useQuery({ queryKey: ["tenant", s.tenantId, "workflows"], queryFn: () => get<Workflow[]>("/workflows") });
  return (
    <>
      <PageHeader title="Workflows" description="When something happens, check conditions, then run actions."
        actions={s.can("core:workflows.manage") && <Button asChild><Link to="/admin/workflows/$id" params={{ id: "new" }}><Plus size={16} />New workflow</Link></Button>} />
      <QueryView q={list}>{(rows) => rows.length === 0 ? <EmptyState title="No workflows yet">Example: when a contact is created, create a follow-up task.</EmptyState> : (
        <Card><Table>
          <THead><TR><TH>Name</TH><TH>When</TH><TH className="hidden sm:table-cell">Actions</TH><TH>Status</TH></TR></THead>
          <TBody>{rows.map((w) => (
            <TR key={w.id}>
              <TD><Link to="/admin/workflows/$id" params={{ id: w.id }} className="font-medium text-primary hover:underline">{w.name}</Link></TD>
              <TD><code className="text-xs">{w.trigger.event}</code></TD>
              <TD className="hidden sm:table-cell">{w.actions.map((a) => a.key).join(" → ")}</TD>
              <TD><Badge tone={w.enabled ? "success" : "neutral"}>{w.enabled ? "On" : "Off"}</Badge></TD>
            </TR>))}
          </TBody>
        </Table></Card>
      )}</QueryView>
    </>
  );
}

/** Example input from an action's JSON Schema (required fields, with placeholders). */
function exampleInput(schema: JsonSchema): string {
  const out: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(schema.properties ?? {})) {
    if (!schema.required?.includes(k)) continue;
    out[k] = p.type === "number" || p.type === "integer" ? 1 : p.type === "object" ? {} : p.enum ? p.enum[0] : `{{payload.${k}}}`;
  }
  return JSON.stringify(out, null, 2);
}

interface Draft { name: string; enabled: boolean; event: string; conditions: string; actions: { key: string; input: string }[] }
const toDraft = (w?: Workflow): Draft => w
  ? { name: w.name, enabled: w.enabled, event: w.trigger.event, conditions: w.conditions ? JSON.stringify(w.conditions, null, 2) : "", actions: w.actions.map((a) => ({ key: a.key, input: JSON.stringify(a.input ?? {}, null, 2) })) }
  : { name: "", enabled: true, event: "", conditions: "", actions: [] };

function parseDraft(d: Draft) {
  const json = (s: string, what: string) => { try { return JSON.parse(s); } catch { throw new Error(`${what} is not valid JSON`); } };
  return {
    name: d.name, enabled: d.enabled, trigger: { event: d.event },
    conditions: d.conditions.trim() ? json(d.conditions, "Conditions") : null,
    actions: d.actions.map((a, i) => ({ key: a.key, input: a.input.trim() ? json(a.input, `Step ${i + 1} input`) : {} })),
  };
}

export function WorkflowEditorPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const isNew = id === "new";
  const s = useSession();
  const wf = useQuery({ queryKey: ["tenant", s.tenantId, "workflows", id], queryFn: () => get<Workflow>(`/workflows/${id}`), enabled: !isNew });
  const catalog = useQuery({ queryKey: ["tenant", s.tenantId, "workflow-catalog"], queryFn: () => get<Catalog>("/workflow-catalog") });
  if ((!isNew && wf.isPending) || catalog.isPending) return <QueryView q={catalog}>{() => null}</QueryView>;
  if (wf.isError || catalog.isError) return <Alert>{errorMessage(wf.error ?? catalog.error)}</Alert>;
  return <Editor key={id} id={isNew ? null : id} initial={toDraft(wf.data)} catalog={catalog.data!} />;
}

function Editor({ id, initial, catalog }: { id: string | null; initial: Draft; catalog: Catalog }) {
  const s = useSession();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [d, setD] = useState<Draft>(initial);
  const [err, setErr] = useState<string>();
  const readOnly = !s.can("core:workflows.manage");
  const save = useMutation({
    mutationFn: async () => {
      const body = parseDraft(d);
      return id ? put<Workflow>(`/workflows/${id}`, body) : post<Workflow>("/workflows", body);
    },
    onMutate: () => setErr(undefined),
    onError: (e) => setErr(errorMessage(e)),
    onSuccess: async (w) => {
      await qc.invalidateQueries({ queryKey: ["tenant", s.tenantId, "workflows"] });
      if (!id) nav({ to: "/admin/workflows/$id", params: { id: w.id }, replace: true });
    },
  });
  const setAction = (i: number, a: Partial<Draft["actions"][number]>) => setD({ ...d, actions: d.actions.map((x, j) => (j === i ? { ...x, ...a } : x)) });
  const move = (i: number, by: number) => { const a = [...d.actions]; const [x] = a.splice(i, 1); a.splice(i + by, 0, x!); setD({ ...d, actions: a }); };

  return (
    <>
      <PageHeader title={id ? d.name || "Workflow" : "New workflow"} description={<Link to="/admin/workflows" className="hover:underline">← Workflows</Link>}
        actions={!readOnly && <>
          {id && <ConfirmButton variant="outline" size="md" label="Delete" title="Delete workflow?" body="Run history is kept."
            onConfirm={async () => { await del(`/workflows/${id}`); await qc.invalidateQueries({ queryKey: ["tenant", s.tenantId, "workflows"] }); nav({ to: "/admin/workflows" }); }} />}
          <Button disabled={save.isPending || !d.name || !d.event || !d.actions.length} onClick={() => save.mutate()}>Save</Button>
        </>} />
      {err && <div className="mb-4"><Alert>{err}</Alert></div>}
      {save.isSuccess && <div className="mb-4"><Alert tone="success">Saved.</Alert></div>}
      <fieldset disabled={readOnly} className="grid gap-4">
        <Card><CardContent className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Name">{(a) => <Input {...a} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />}</Field>
          <label className="flex items-center gap-2 text-sm"><Switch label="Enabled" checked={d.enabled} onCheckedChange={(v) => setD({ ...d, enabled: v })} />Enabled</label>
        </CardContent></Card>

        <Card><CardHeader><CardTitle>1. When</CardTitle></CardHeader><CardContent>
          <Field label="Event">{(a) => (
            <Select {...a} value={d.event} onChange={(e) => setD({ ...d, event: e.target.value })}>
              <option value="">Choose an event…</option>
              {catalog.events.map((e) => <option key={e} value={e}>{e}</option>)}
            </Select>)}
          </Field>
        </CardContent></Card>

        <Card><CardHeader><CardTitle>2. Only if (optional)</CardTitle></CardHeader><CardContent>
          <Field label="Conditions (JSONLogic)" hint={<>Data: <code>event</code>, <code>payload</code>. Example: <code>{`{"in": ["@vip.com", {"var": "payload.email"}]}`}</code></>}>
            {(a) => <Textarea {...a} rows={4} value={d.conditions} onChange={(e) => setD({ ...d, conditions: e.target.value })} placeholder="Always run" />}
          </Field>
        </CardContent></Card>

        <Card><CardHeader><CardTitle>3. Then</CardTitle></CardHeader><CardContent className="grid gap-4">
          {d.actions.map((a, i) => {
            const spec = catalog.actions.find((x) => x.key === a.key);
            return (
              <div key={i} className="grid gap-2 rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Step {i + 1}</span>
                  <Select aria-label={`Step ${i + 1} action`} className="flex-1" value={a.key} onChange={(e) => {
                    const sp = catalog.actions.find((x) => x.key === e.target.value);
                    setAction(i, { key: e.target.value, input: sp ? exampleInput(sp.input) : "{}" });
                  }}>
                    {catalog.actions.map((x) => <option key={x.key} value={x.key}>{x.label} ({x.key})</option>)}
                  </Select>
                  <Button variant="ghost" size="icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></Button>
                  <Button variant="ghost" size="icon" aria-label="Move down" disabled={i === d.actions.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></Button>
                  <Button variant="ghost" size="icon" aria-label={`Remove step ${i + 1}`} onClick={() => setD({ ...d, actions: d.actions.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>
                </div>
                <Field label="Input (JSON)" hint={<>Templates: <code>{"{{payload.field}}"}</code>, <code>{"{{steps.0.taskId}}"}</code>. Fields: {Object.keys(spec?.input.properties ?? {}).join(", ") || "none"}</>}>
                  {(f) => <Textarea {...f} rows={4} value={a.input} onChange={(e) => setAction(i, { input: e.target.value })} />}
                </Field>
              </div>
            );
          })}
          <Button variant="outline" onClick={() => {
            const first = catalog.actions[0]!;
            setD({ ...d, actions: [...d.actions, { key: first.key, input: exampleInput(first.input) }] });
          }}><Plus size={16} />Add step</Button>
        </CardContent></Card>
      </fieldset>
      {id && <Runs id={id} />}
    </>
  );
}

function Runs({ id }: { id: string }) {
  const s = useSession();
  const runs = useQuery({ queryKey: ["tenant", s.tenantId, "workflows", id, "runs"], queryFn: () => get<WorkflowRun[]>(`/workflows/${id}/runs?limit=25`), refetchInterval: 10_000 });
  return (
    <Card className="mt-4"><CardHeader><CardTitle>Recent runs</CardTitle></CardHeader>
      <QueryView q={runs}>{(rows) => rows.length === 0 ? <p className="p-4 text-sm text-muted">No runs yet.</p> : (
        <Table>
          <THead><TR><TH>Started</TH><TH>Status</TH><TH>Steps</TH><TH className="hidden md:table-cell">Error</TH></TR></THead>
          <TBody>{rows.map((r) => (
            <TR key={r.id}>
              <TD className="whitespace-nowrap">{fmtDate(r.startedAt)}</TD>
              <TD><Badge tone={runTone(r.status)}>{r.status}</Badge></TD>
              <TD><div className="flex flex-wrap gap-1">{r.steps.map((st, i) => <Badge key={i} tone={runTone(st.status)} title={st.error ?? JSON.stringify(st.output)}>{i + 1}</Badge>)}</div></TD>
              <TD className="hidden max-w-sm truncate md:table-cell text-xs text-danger">{r.error ?? ""}</TD>
            </TR>))}
          </TBody>
        </Table>
      )}</QueryView>
    </Card>
  );
}
