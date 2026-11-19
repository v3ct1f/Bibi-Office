import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner } from "@office/ui";
import type { SlotProps } from "@office/sdk/ui";
import { fmtDay, presetRange, PRESETS, type Preset } from "./format.ts";
import { TileCard } from "./tile.tsx";
import type { Dashboard, MetricInfo, Tile, Values, View } from "./types.ts";

const ROOT = "/m/kpi/dashboards";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIEWS: [View, string][] = [["number", "Number"], ["line", "Line"], ["bar", "Bars"]];
const key = (tenantId: string, ...rest: unknown[]) => ["tenant", tenantId, "kpi", ...rest];

export function useMetricValues({ api, tenantId }: Pick<SlotProps, "api" | "tenantId">, metrics: string[], range: { from: string; to: string }) {
  const keys = [...new Set(metrics)].sort().join(",");
  return useQuery({
    queryKey: key(tenantId, "values", keys, range.from, range.to), enabled: keys.length > 0, placeholderData: keepPreviousData,
    queryFn: () => api.core<Values>(`/metrics/values?keys=${encodeURIComponent(keys)}&from=${range.from}&to=${range.to}`),
  });
}

/** /m/kpi/dashboards[/<dashboard id>] */
export function KpiPage(props: SlotProps) {
  const { api, tenantId, navigate, errorMessage } = props;
  const list = useQuery({ queryKey: key(tenantId, "dashboards"), queryFn: () => api.get<{ data: Dashboard[]; canManage: boolean }>("/dashboards") });
  const seg = (props.subPath ?? "").split("/").filter(Boolean);
  if (seg.length && !UUID.test(seg[0]!)) return <EmptyState title="Page not found" />;
  if (list.isPending) return <Spinner />;
  if (list.isError) return <Alert>{errorMessage(list.error)}</Alert>;
  const all = list.data.data, current = all.find((d) => d.id === seg[0]) ?? all[0];
  return (
    <>
      <PageHeader title="KPIs" description="Key numbers from your modules, for the period you pick." />
      {all.length > 1 && (
        <div role="tablist" aria-label="Dashboards" className="mb-4 flex flex-wrap gap-1">
          {all.map((d) => <Button key={d.id} role="tab" aria-selected={d.id === current?.id} size="sm" variant={d.id === current?.id ? "secondary" : "ghost"} onClick={() => navigate(`${ROOT}/${d.id}`)}>{d.name}</Button>)}
        </div>
      )}
      {current ? <Board key={current.id} {...props} d={current} canManage={list.data.canManage} count={all.length} />
        : <EmptyState title="No dashboards">{list.data.canManage ? <NewDashboard {...props} /> : "Ask an admin to set one up."}</EmptyState>}
    </>
  );
}

function RangePicker({ preset, setPreset, custom, setCustom }: {
  preset: Preset | "custom"; setPreset(p: Preset | "custom"): void; custom: { from: string; to: string }; setCustom(c: { from: string; to: string }): void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select aria-label="Period" className="w-auto" value={preset} onChange={(e) => setPreset(e.target.value as Preset | "custom")}>
        {PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        <option value="custom">Custom dates…</option>
      </Select>
      {preset === "custom" && (
        <>
          <Input type="date" aria-label="From" className="w-auto" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} />
          <Input type="date" aria-label="To" className="w-auto" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} />
        </>
      )}
    </div>
  );
}

function Board(props: SlotProps & { d: Dashboard; canManage: boolean; count: number }) {
  const { api, tenantId, errorMessage, d, canManage, navigate } = props;
  const qc = useQueryClient();
  const [preset, setPreset] = useState<Preset | "custom">("this_month");
  const [custom, setCustom] = useState(() => presetRange("last_30", props.timeZone));
  const range = preset === "custom" ? custom : presetRange(preset, props.timeZone);
  const [draft, setDraft] = useState<Tile[] | null>(null), [name, setName] = useState(d.name), [adding, setAdding] = useState(false);
  const tiles = draft ?? d.tiles;
  const values = useMetricValues(props, tiles.map((t) => t.metric), range);
  const byKey = useMemo(() => new Map((values.data?.data ?? []).map((r) => [r.key, r])), [values.data]);
  const save = useMutation({
    mutationFn: () => api.patch<Dashboard>(`/dashboards/${d.id}`, { name, tiles: draft ?? d.tiles }),
    onSuccess: () => { setDraft(null); void qc.invalidateQueries({ queryKey: key(tenantId, "dashboards") }); },
  });
  const del = useMutation({ mutationFn: () => api.del(`/dashboards/${d.id}`), onSuccess: () => { void qc.invalidateQueries({ queryKey: key(tenantId, "dashboards") }); navigate(ROOT); } });
  const editing = draft !== null;
  const shown = editing ? tiles : tiles.filter((t) => byKey.get(t.metric)?.ok !== false || canManage);
  const set = (i: number, patch: Partial<Tile>) => setDraft(tiles.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const move = (i: number, by: number) => { const n = [...tiles]; const [t] = n.splice(i, 1); n.splice(i + by, 0, t!); setDraft(n); };
  const v = values.data;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <RangePicker preset={preset} setPreset={setPreset} custom={custom} setCustom={setCustom} />
        {v && <p className="text-xs text-muted">{fmtDay(v.range.from)} – {fmtDay(v.range.to)}, compared with {fmtDay(v.previous.from)} – {fmtDay(v.previous.to)} · {props.timeZone}</p>}
        <span className="flex-1" />
        {canManage && !editing && <Button variant="outline" onClick={() => { setDraft(d.tiles); setName(d.name); }}>Edit dashboard</Button>}
        {editing && <>
          <Button variant="ghost" disabled={save.isPending} onClick={() => setDraft(null)}>Cancel</Button>
          <Button disabled={save.isPending || !name.trim()} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save"}</Button>
        </>}
      </div>
      {editing && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3">
          <Field label="Dashboard name">{(a) => <Input {...a} className="w-64" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Button variant="outline" onClick={() => setAdding(true)} disabled={tiles.length >= 24}>Add a number</Button>
          <NewDashboard {...props} />
          {props.count > 1 && <Button variant="danger" disabled={del.isPending} onClick={() => del.mutate()}>Delete dashboard</Button>}
        </div>
      )}
      {(save.error || del.error || values.error) && <Alert>{errorMessage(save.error ?? del.error ?? values.error)}</Alert>}
      {shown.length === 0 ? <EmptyState title="No numbers on this dashboard">{canManage ? "Edit the dashboard to add some." : null}</EmptyState> : (
        <ul aria-label="KPIs" className={`grid gap-4 sm:grid-cols-2 xl:grid-cols-3 ${values.isPlaceholderData ? "opacity-60 transition-opacity" : ""}`}>
          {shown.map((t, i) => (
            <li key={t.id} className={t.view !== "number" ? "sm:col-span-2 xl:col-span-1" : ""}>
              <TileCard tile={t} r={byKey.get(t.metric)} values={v} editing={editing}>
                {editing && (
                  <div className="flex flex-wrap items-end gap-2 border-t pt-3">
                    <Select aria-label="Show as" className="w-auto" value={t.view} onChange={(e) => set(i, { view: e.target.value as View })}>{VIEWS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
                    <Input aria-label="Target" type="number" className="w-28" placeholder="Target" value={t.target ?? ""} onChange={(e) => set(i, { target: e.target.value === "" ? null : Number(e.target.value) })} />
                    <Button size="sm" variant="ghost" aria-label="Move earlier" disabled={i === 0} onClick={() => move(i, -1)}>←</Button>
                    <Button size="sm" variant="ghost" aria-label="Move later" disabled={i === tiles.length - 1} onClick={() => move(i, 1)}>→</Button>
                    <Button size="sm" variant="ghost" onClick={() => setDraft(tiles.filter((_, j) => j !== i))}>Remove</Button>
                  </div>
                )}
              </TileCard>
            </li>
          ))}
        </ul>
      )}
      {adding && <AddTile {...props} have={tiles.map((t) => t.metric)} onAdd={(m, view) => { setDraft([...tiles, { id: Math.random().toString(36).slice(2, 10), metric: m, view, target: null }]); setAdding(false); }} onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddTile({ api, tenantId, errorMessage, have, onAdd, onClose }: SlotProps & { have: string[]; onAdd(metric: string, view: View): void; onClose(): void }) {
  const cat = useQuery({ queryKey: key(tenantId, "catalog"), queryFn: () => api.core<{ data: MetricInfo[] }>("/metrics") });
  const free = (cat.data?.data ?? []).filter((m) => !have.includes(m.key));
  const [metric, setMetric] = useState(""), [view, setView] = useState<View>("number");
  const groups = [...new Set(free.map((m) => m.moduleName))];
  const chosen = free.find((m) => m.key === metric);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }} title="Add a number" description="Numbers come from the modules you have turned on."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!chosen} onClick={() => onAdd(metric, chosen?.kind === "stock" ? "number" : view)}>Add</Button></>}>
      {cat.isPending ? <Spinner /> : cat.isError ? <Alert>{errorMessage(cat.error)}</Alert> : free.length === 0 ? <p className="text-sm text-muted">Every available number is already on this dashboard.</p> : (
        <div className="grid gap-3">
          <Field label="Number">{(a) => (
            <Select {...a} value={metric} onChange={(e) => setMetric(e.target.value)}>
              <option value="">Choose…</option>
              {groups.map((g) => <optgroup key={g} label={g}>{free.filter((m) => m.moduleName === g).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</optgroup>)}
            </Select>
          )}</Field>
          {chosen?.description && <p className="text-sm text-muted">{chosen.description}</p>}
          {chosen?.kind === "flow" && <Field label="Show as">{(a) => <Select {...a} value={view} onChange={(e) => setView(e.target.value as View)}>{VIEWS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>}
        </div>
      )}
    </Dialog>
  );
}

function NewDashboard({ api, tenantId, navigate, errorMessage }: SlotProps) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false), [name, setName] = useState("");
  const m = useMutation({
    mutationFn: () => api.post<Dashboard>("/dashboards", { name, tiles: [] }),
    onSuccess: (d) => { setOpen(false); setName(""); void qc.invalidateQueries({ queryKey: key(tenantId, "dashboards") }); navigate(`${ROOT}/${d.id}`); },
  });
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>New dashboard</Button>
      {open && (
        <Dialog open onOpenChange={setOpen} title="New dashboard"
          footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" form="kpi-new" disabled={!name.trim() || m.isPending}>Create</Button></>}>
          <form id="kpi-new" className="grid gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
            {m.error && <Alert>{errorMessage(m.error)}</Alert>}
            <Field label="Name">{(a) => <Input {...a} required maxLength={80} placeholder="e.g. Sales" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          </form>
        </Dialog>
      )}
    </>
  );
}
