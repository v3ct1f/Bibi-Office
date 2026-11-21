import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Button, Card, ConfirmDialog, Dialog, DialogContent, DialogFooter, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton,
  Table, TBody, TD, TH, THead, TR, Textarea, toast,
} from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import { Tile } from "./Board.tsx";
import {
  errorMessage, fmtDate, fmtValue, ModLink, SectionTabs, UNIT_LABEL, useLoad, type BoardRow, type Config, type Unit, type Values,
} from "./shared.tsx";

interface ManualRow { id: string; key: string; name: string; description: string | null; unit: Unit; currency: string | null; kind: "total" | "snapshot"; better: "up" | "down"; lastDate: string | null; lastValue: number | null; valueCount: number }
interface ManualDetail extends Omit<ManualRow, "lastDate" | "lastValue" | "valueCount"> { values: { date: string; value: number; note: string | null }[]; canWrite: boolean; canManage: boolean }

export function ManualListPage() {
  const host = useModuleHost();
  const cfg = useLoad(() => host.api.get<Config>("/config"), [host]);
  const rows = useLoad(() => host.api.get<ManualRow[]>("/manual"), [host]);
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader title="KPIs" description="Numbers no feature knows about, like visitors or followers. Type them in and put them on a board."
        actions={cfg.data?.canManage ? <Button onClick={() => setCreating(true)}><Plus className="size-4" />New number</Button> : undefined} />
      <SectionTabs current="/kpi/manual" />
      {rows.error ? <ErrorState title="Couldn't load your numbers" error={rows.error} onRetry={() => void rows.reload()} />
        : !rows.data ? <Skeleton className="h-40" />
        : !rows.data.length ? <EmptyState title="No numbers of your own yet" description="Track anything you count by hand: visitors, followers, reviews." />
        : (
          <ul aria-label="Your own numbers" className="grid gap-2">
            {rows.data.map((m) => (
              <li key={m.id}>
                <Card className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <div><ModLink to={`/kpi/manual/${m.id}`} className="font-medium hover:underline">{m.name}</ModLink>
                    <p className="text-xs text-muted-foreground">{m.valueCount} {m.valueCount === 1 ? "value" : "values"}{m.lastDate ? `, latest ${fmtDate(m.lastDate)}` : ""}</p></div>
                  <p className="font-semibold tabular-nums">{fmtValue(m.lastValue, m.unit, m.currency)}</p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      {creating && <NewManualDialog onClose={() => setCreating(false)} onCreated={(id) => host.navigate(`/kpi/manual/${id}`)} />}
    </>
  );
}

function NewManualDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const host = useModuleHost();
  const [f, setF] = useState({ name: "", description: "", unit: "count" as Unit, currency: "EUR", kind: "total" as "total" | "snapshot", better: "up" as "up" | "down" });
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const save = async () => {
    setBusy(true);
    try { const r = await host.api.post<{ id: string }>("/manual", { ...f, currency: f.unit === "money" ? f.currency : null }); toast.success("Number added"); onCreated(r.id); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="New number">
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <Field label="Name" required>{(a) => <Input {...a} value={f.name} maxLength={80} placeholder="Visitors" onChange={(e) => set({ name: e.target.value })} />}</Field>
          <Field label="What it measures">{(a) => <Textarea {...a} rows={2} value={f.description} maxLength={300} onChange={(e) => set({ description: e.target.value })} />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kind of number">{(a) => <Select {...a} value={f.unit} onChange={(e) => set({ unit: e.target.value as Unit })}>{(Object.keys(UNIT_LABEL) as Unit[]).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}</Select>}</Field>
            {f.unit === "money" && <Field label="Currency">{(a) => <Input {...a} value={f.currency} maxLength={3} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} />}</Field>}
          </div>
          <Field label="Over a period">{(a) => (
            <Select {...a} value={f.kind} onChange={(e) => set({ kind: e.target.value as "total" | "snapshot" })}>
              <option value="total">Add up the values (e.g. visitors)</option><option value="snapshot">Use the latest value (e.g. followers)</option>
            </Select>
          )}</Field>
          <Field label="Good news is">{(a) => <Select {...a} value={f.better} onChange={(e) => set({ better: e.target.value as "up" | "down" })}><option value="up">A higher number</option><option value="down">A lower number</option></Select>}</Field>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy} disabled={!f.name.trim()}>Add number</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ManualPage({ params }: PageProps) {
  const host = useModuleHost();
  const d = useLoad(() => host.api.get<ManualDetail>(`/manual/${params.id}`), [host, params.id]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10)), [value, setValue] = useState(""), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false);
  const put = async (on: string, v: number | null, n?: string) => {
    setBusy(true);
    try { await host.api.put(`/manual/${params.id}/values`, { date: on, value: v, note: n || null }); toast.success(v == null ? "Value removed" : "Value saved"); setValue(""); setNote(""); void d.reload(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  if (d.error) return <ErrorState title="Couldn't load this number" error={d.error} onRetry={() => void d.reload()} />;
  if (!d.data) return <Skeleton className="h-64" />;
  const m = d.data, n = Number(value.replace(",", "."));
  return (
    <>
      <PageHeader title={m.name} description={m.description ?? undefined}
        actions={m.canManage ? <Button variant="ghost" className="text-destructive" onClick={() => setConfirm(true)}><Trash2 className="size-4" />Delete</Button> : undefined} />
      <p className="mb-4 text-sm"><ModLink to="/kpi/manual">← Your own numbers</ModLink></p>
      {m.canWrite && (
        <Card className="mb-4 p-4">
          <form className="grid gap-3 sm:grid-cols-[10rem_10rem_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); if (value.trim() && Number.isFinite(n)) void put(date, n, note); }}>
            <Field label="Date">{(a) => <Input {...a} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
            <Field label="Value">{(a) => <Input {...a} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />}</Field>
            <Field label="Note">{(a) => <Input {...a} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />}</Field>
            <Button type="submit" loading={busy} disabled={!value.trim() || !Number.isFinite(n)}>Save value</Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">Saving a date that already has a value replaces it.</p>
        </Card>
      )}
      {!m.values.length ? <EmptyState title="No values yet" description="Type in the first one above." /> : (
        <div className="overflow-x-auto rounded-md border">
          <Table aria-label="Values">
            <THead><TR><TH>Date</TH><TH className="text-right">Value</TH><TH>Note</TH>{m.canWrite && <TH><span className="sr-only">Remove</span></TH>}</TR></THead>
            <TBody>{m.values.map((v) => (
              <TR key={v.date}><TD>{fmtDate(v.date)}</TD><TD className="text-right tabular-nums">{fmtValue(v.value, m.unit, m.currency)}</TD><TD>{v.note}</TD>
                {m.canWrite && <TD className="text-right"><Button variant="ghost" size="icon" aria-label={`Remove the value of ${fmtDate(v.date)}`} onClick={() => void put(v.date, null)}><Trash2 className="size-4" /></Button></TD>}</TR>
            ))}</TBody>
          </Table>
        </div>
      )}
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={`Delete “${m.name}”?`} destructive confirmLabel="Delete"
        description="Its values, targets and tiles on boards are removed too."
        onConfirm={async () => { await host.api.del(`/manual/${m.id}`); toast.success("Number deleted"); host.navigate("/kpi/manual"); }} />
    </>
  );
}

/** Dashboard widget: the first four numbers of the first board, this period. */
export function KpiWidget() {
  const host = useModuleHost();
  const v = useLoad(async () => {
    const boards = await host.api.get<BoardRow[]>("/boards");
    return boards[0] ? host.api.get<Values>(`/boards/${boards[0].id}/values`, { tiles: 4, chart: "no" }) : null;
  }, [host]);
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold">{v.data?.board.name ?? "Key numbers"}</p>
        <Button variant="link" size="sm" onClick={() => host.navigate("/kpi")}>View all</Button>
      </div>
      {v.loading && !v.data ? <Skeleton className="h-20" />
        : v.error ? <p className="text-sm text-muted-foreground">Could not load the numbers.</p>
        : !v.data ? <p className="text-sm text-muted-foreground">No KPI boards yet.</p>
        : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">{v.data.period.label}</p>
            <ul aria-label="Key numbers" className="grid grid-cols-2 gap-2">
              {v.data.tiles.map((t) => <li key={t.id}><Tile t={t} periodKind={v.data!.period.kind} compact /></li>)}
            </ul>
          </>
        )}
    </Card>
  );
}
