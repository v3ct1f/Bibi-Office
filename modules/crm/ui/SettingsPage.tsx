import { useEffect, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button, Card, ConfirmDialog, ErrorState, Field, Input, PageHeader, Select, Skeleton, toast } from "@office/ui";
import { useModuleHost } from "@office/ui/module-ui";
import { CURRENCIES, errorMessage, useLoad, type Pipeline, type Stage, type Status } from "./shared.tsx";

type Row = { id?: string; name: string; probability: string; kind: Status; dealCount?: number };
const toRows = (s: Stage[]): Row[] => s.map((x) => ({ id: x.id, name: x.name, probability: String(x.probability), kind: x.kind, dealCount: x.dealCount }));

function PipelineEditor({ pipeline, canDelete, readOnly, onSaved, onDelete }: {
  pipeline: Pipeline; canDelete: boolean; readOnly: boolean; onSaved: (p: Pipeline) => void; onDelete: () => void;
}) {
  const host = useModuleHost();
  const [name, setName] = useState(pipeline.name);
  const [rows, setRows] = useState<Row[]>(toRows(pipeline.stages));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setName(pipeline.name); setRows(toRows(pipeline.stages)); }, [pipeline]);
  const set = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const swap = (i: number, d: -1 | 1) => setRows((r) => { const n = [...r]; [n[i], n[i + d]] = [n[i + d]!, n[i]!]; return n; });

  const save = async () => {
    setSaving(true);
    try {
      const p = await host.api.patch<Pipeline>(`/pipelines/${pipeline.id}`, {
        name: name.trim(),
        stages: rows.map((r) => ({ ...(r.id ? { id: r.id } : {}), name: r.name.trim(), kind: r.kind, probability: Math.max(0, Math.min(100, Math.round(Number(r.probability) || 0))) })),
      });
      toast.success("Pipeline saved"); onSaved(p);
    } catch (e) { toast.error(errorMessage(e)); } finally { setSaving(false); }
  };

  return (
    <Card className="grid gap-4 p-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Pipeline name" className="min-w-56 flex-1">{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} disabled={readOnly} />}</Field>
        {!readOnly && canDelete && <Button variant="ghost" className="text-destructive" onClick={onDelete}><Trash2 /> Delete pipeline</Button>}
      </div>
      <div className="grid gap-2">
        <div className="hidden grid-cols-[1fr_7rem_8rem_auto] gap-2 px-1 text-xs font-medium text-muted-foreground sm:grid">
          <span>Stage</span><span>Chance to win</span><span>Type</span><span className="w-28" />
        </div>
        {rows.map((r, i) => (
          <div key={r.id ?? `new-${i}`} className="grid grid-cols-[1fr_auto] gap-2 rounded-md border p-2 sm:grid-cols-[1fr_7rem_8rem_auto] sm:border-0 sm:p-0">
            <Input aria-label={`Stage ${i + 1} name`} value={r.name} onChange={(e) => set(i, { name: e.target.value })} maxLength={60} disabled={readOnly} />
            <div className="relative">
              <Input aria-label={`Stage ${i + 1} chance`} type="number" min={0} max={100} value={r.probability} onChange={(e) => set(i, { probability: e.target.value })} disabled={readOnly} className="pr-6" />
              <span className="pointer-events-none absolute right-2 top-2 text-sm text-muted-foreground">%</span>
            </div>
            <Select aria-label={`Stage ${i + 1} type`} value={r.kind} disabled={readOnly || !!r.dealCount}
              title={r.dealCount ? "Move this stage's deals before changing its type" : undefined}
              onChange={(e) => set(i, { kind: e.target.value as Status, ...(e.target.value === "won" ? { probability: "100" } : e.target.value === "lost" ? { probability: "0" } : {}) })}>
              <option value="open">In progress</option><option value="won">Won</option><option value="lost">Lost</option>
            </Select>
            {!readOnly && (
              <div className="flex w-28 items-center">
                <Button variant="ghost" size="icon" aria-label={`Move stage ${i + 1} up`} disabled={i === 0} onClick={() => swap(i, -1)}><ArrowUp /></Button>
                <Button variant="ghost" size="icon" aria-label={`Move stage ${i + 1} down`} disabled={i === rows.length - 1} onClick={() => swap(i, 1)}><ArrowDown /></Button>
                <Button variant="ghost" size="icon" aria-label={`Remove stage ${i + 1}`} disabled={!!r.dealCount}
                  title={r.dealCount ? `${r.dealCount} deal(s) in this stage` : undefined} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>
            )}
          </div>
        ))}
      </div>
      {!readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" size="sm" disabled={rows.length >= 20}
            onClick={() => { const at = Math.max(0, rows.findIndex((r) => r.kind !== "open")); setRows((x) => [...x.slice(0, at), { name: "", probability: "50", kind: "open" }, ...x.slice(at)]); }}>
            <Plus /> Add stage
          </Button>
          <Button loading={saving} onClick={() => void save()}>Save pipeline</Button>
        </div>
      )}
    </Card>
  );
}

export function SettingsPage() {
  const host = useModuleHost();
  const canManage = host.can("crm:pipeline.manage");
  const canModules = host.can("core:modules.manage");
  const list = useLoad(() => host.api.get<Pipeline[]>("/pipelines"), [host]);
  const config = useLoad(() => host.api.get<{ currency: string }>("/config"), [host]);
  const [currency, setCurrency] = useState("");
  const [deleting, setDeleting] = useState<Pipeline | null>(null);
  const [newName, setNewName] = useState("");
  useEffect(() => { if (config.data) setCurrency(config.data.currency); }, [config.data]);

  if (list.loading && !list.data) return <><Skeleton className="h-8 w-56" /><Skeleton className="mt-6 h-96" /></>;
  if (list.error || !list.data) return <ErrorState error={list.error} onRetry={() => void list.reload()} />;
  const pipelines = list.data;

  return (
    <div className="grid gap-4">
      <a href={host.href("/deals")} onClick={(e) => { e.preventDefault(); host.navigate("/deals"); }} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Deals
      </a>
      <PageHeader className="mb-2" title="Pipeline settings"
        description="The stages your deals move through. “Chance to win” drives the weighted forecast. Deals in a Won stage count as won (and get an invoice when Invoicing is on)." />
      {!canManage && <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Only admins can change pipelines.</p>}

      {pipelines.map((p) => (
        <PipelineEditor key={p.id} pipeline={p} readOnly={!canManage} canDelete={pipelines.length > 1}
          onSaved={(np) => list.set(pipelines.map((x) => (x.id === np.id ? np : x)))} onDelete={() => setDeleting(p)} />
      ))}

      {canManage && (
        <Card className="flex flex-wrap items-end gap-3 p-5">
          <Field label="Add another pipeline" hint="e.g. a separate process for partnerships or renewals" className="min-w-56 flex-1">
            {(a) => <Input {...a} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Pipeline name" maxLength={100} />}
          </Field>
          <Button variant="outline" disabled={!newName.trim()} onClick={async () => {
            try { const p = await host.api.post<Pipeline>("/pipelines", { name: newName.trim() }); list.set([...pipelines, p]); setNewName(""); toast.success("Pipeline added with the default stages"); }
            catch (e) { toast.error(errorMessage(e)); }
          }}><Plus /> Add pipeline</Button>
        </Card>
      )}

      {canModules && (
        <Card className="flex flex-wrap items-end gap-3 p-5">
          <Field label="Default currency for new deals" className="w-56">{(a) => (
            <Select {...a} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {[...new Set([currency || "EUR", ...CURRENCIES])].map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          )}</Field>
          <Button variant="outline" disabled={!config.data || currency === config.data.currency} onClick={async () => {
            try { await host.core.patch(`/modules/${host.moduleKey}/settings`, { currency }); await config.reload(); toast.success("Default currency saved"); }
            catch (e) { toast.error(errorMessage(e)); }
          }}>Save currency</Button>
        </Card>
      )}

      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} destructive confirmLabel="Delete pipeline"
        title={`Delete the “${deleting?.name}” pipeline?`} description="Only empty pipelines can be deleted. Move or delete its deals first."
        onConfirm={async () => {
          try { await host.api.del(`/pipelines/${deleting!.id}`); list.set(pipelines.filter((x) => x.id !== deleting!.id)); toast.success("Pipeline deleted"); }
          catch (e) { toast.error(errorMessage(e)); throw e; }
        }} />
    </div>
  );
}
