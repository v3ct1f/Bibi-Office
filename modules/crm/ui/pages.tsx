import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Button, Card, CardContent, CardHeader, CardTitle, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner,
  Table, TBody, TD, TH, THead, TR, Textarea, cn,
} from "@office/ui";
import type { SlotProps } from "@office/sdk/ui";
import { Timeline } from "./activity.tsx";
import { DealStatus, fmtDay, money, P, parseMoney, personName, ROOT, toMajor } from "./common.tsx";
import type { BoardStage, CompanyLite, ContactLite, Deal, DealFull, Page, Stage } from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** /m/crm/deals[/<id>] */
export function DealsPage(props: SlotProps) {
  const seg = (props.subPath ?? "").split("/").filter(Boolean);
  if (seg[0] && UUID.test(seg[0])) return <DealDetail {...props} id={seg[0]} />;
  if (seg.length) return <EmptyState title="Page not found" />;
  return <Pipeline {...props} />;
}

// ───────────────────────── board + list ─────────────────────────
function Pipeline(props: SlotProps) {
  const { api, tenantId, can, errorMessage } = props;
  const qc = useQueryClient();
  const [view, setView] = useState<"board" | "list">("board");
  const [creating, setCreating] = useState<string | null>(null);   // stage id or "" for default
  const [editingStages, setEditingStages] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const b = useQuery({ queryKey: ["tenant", tenantId, "crm", "board"], queryFn: () => api.get<{ stages: BoardStage[] }>("/board") });
  const move = useMutation({
    mutationFn: ({ id, stageId }: { id: string; stageId: string }) => api.post(`/deals/${id}/move`, { stageId }),
    onMutate: async ({ id, stageId }) => {   // optimistic: move the card right away
      const key = ["tenant", tenantId, "crm", "board"];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<{ stages: BoardStage[] }>(key);
      if (prev) {
        const d = prev.stages.flatMap((s) => s.deals).find((x) => x.id === id);
        if (d) qc.setQueryData(key, { stages: prev.stages.map((s) => ({ ...s, deals: s.id === stageId ? [{ ...d, stageId }, ...s.deals.filter((x) => x.id !== id)] : s.deals.filter((x) => x.id !== id) })) });
      }
      return { prev };
    },
    onError: (_e, _v, c) => { if (c?.prev) qc.setQueryData(["tenant", tenantId, "crm", "board"], c.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["tenant", tenantId, "crm"] }),
  });
  return (
    <>
      <PageHeader title="Deals" description="Your sales pipeline. Drag a deal to another stage, or open it to log activity."
        actions={<div className="flex flex-wrap gap-2">
          <div role="tablist" aria-label="View" className="flex gap-1">
            {(["board", "list"] as const).map((v) => <Button key={v} role="tab" aria-selected={view === v} size="sm" variant={view === v ? "secondary" : "ghost"} onClick={() => setView(v)}>{v === "board" ? "Board" : "List"}</Button>)}
          </div>
          {can(P.pipeline) && <Button variant="outline" onClick={() => setEditingStages(true)}>Stages</Button>}
          {can(P.write) && <Button onClick={() => setCreating("")}>New deal</Button>}
        </div>} />
      {move.error && <div className="mb-3"><Alert>{errorMessage(move.error)}</Alert></div>}
      {view === "list" ? <DealList {...props} /> : b.isPending ? <Spinner /> : b.isError ? <Alert>{errorMessage(b.error)}</Alert> : (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          <div className="grid auto-cols-[minmax(15rem,1fr)] grid-flow-col gap-3">
            {b.data.stages.map((s) => (
              <section key={s.id} aria-label={s.name}
                onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(s.id); } }} onDragLeave={() => setOver(null)}
                onDrop={(e) => { e.preventDefault(); setOver(null); if (dragging) move.mutate({ id: dragging, stageId: s.id }); setDragging(null); }}
                className={cn("grid content-start gap-2 rounded-lg border bg-surface-2/50 p-2", over === s.id && "border-primary bg-primary/5")}>
                <header className="flex items-baseline justify-between gap-2 px-1">
                  <h2 className="text-sm font-semibold">{s.name} <span className="font-normal text-muted">{s.count}</span></h2>
                  <span className="text-xs tabular-nums text-muted">{Object.entries(s.totals).map(([c, v]) => money(v, c, true)).join(" · ") || "—"}</span>
                </header>
                {s.deals.map((d) => (
                  <a key={d.id} href={`${ROOT}/${d.id}`} draggable={can(P.write)}
                    onDragStart={(e) => { setDragging(d.id); e.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => setDragging(null)}
                    onClick={(e) => { e.preventDefault(); props.navigate(`${ROOT}/${d.id}`); }}
                    className={cn("grid gap-1 rounded-md border bg-surface p-3 text-sm shadow-sm hover:border-primary/60", dragging === d.id && "opacity-50")}>
                    <span className="font-medium">{d.title}</span>
                    <span className="flex items-center justify-between gap-2 text-muted">
                      <span className="tabular-nums">{money(d.value, d.currency)}</span>
                      {d.stale && <DealStatus d={d} />}
                    </span>
                  </a>
                ))}
                {can(P.write) && <Button variant="ghost" size="sm" onClick={() => setCreating(s.id)}>+ Add deal</Button>}
              </section>
            ))}
          </div>
        </div>
      )}
      {creating !== null && <NewDealDialog {...props} stageId={creating || undefined} onClose={() => setCreating(null)} />}
      {editingStages && <StagesDialog {...props} onClose={() => setEditingStages(false)} />}
    </>
  );
}

const FILTERS = [["open", "Open"], ["won", "Won"], ["lost", "Lost"], ["", "All"]] as const;
function DealList({ api, tenantId, navigate, errorMessage }: SlotProps) {
  const [status, setStatus] = useState("open");
  const [q, setQ] = useState("");
  const l = useQuery({
    queryKey: ["tenant", tenantId, "crm", "deals", { status, q }],
    queryFn: () => api.get<Page<Deal>>(`/deals?limit=100${status ? `&status=${status}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  });
  const st = useQuery({ queryKey: ["tenant", tenantId, "crm", "stages"], queryFn: () => api.get<{ data: Stage[] }>("/stages") });
  const stageName = (id: string) => st.data?.data.find((s) => s.id === id)?.name ?? "—";
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Filter by status" className="flex gap-1">
          {FILTERS.map(([v, label]) => <Button key={v} role="tab" aria-selected={status === v} size="sm" variant={status === v ? "secondary" : "ghost"} onClick={() => setStatus(v)}>{label}</Button>)}
        </div>
        <Input aria-label="Search deals" placeholder="Search deals" className="max-w-xs sm:ml-auto" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {l.isPending ? <Spinner /> : l.isError ? <Alert>{errorMessage(l.error)}</Alert> : l.data.data.length === 0 ? <EmptyState title="No deals here" /> : (
        <Card><Table>
          <THead><TR><TH>Deal</TH><TH className="hidden sm:table-cell">Stage</TH><TH className="hidden md:table-cell">Expected close</TH><TH className="text-right">Value</TH><TH>Status</TH></TR></THead>
          <TBody>{l.data.data.map((d) => (
            <TR key={d.id} className="cursor-pointer" onClick={() => navigate(`${ROOT}/${d.id}`)}>
              <TD className="font-medium">{d.title}</TD><TD className="hidden sm:table-cell">{stageName(d.stageId)}</TD>
              <TD className="hidden md:table-cell">{fmtDay(d.expectedClose)}</TD>
              <TD className="text-right tabular-nums">{money(d.value, d.currency)}</TD><TD><DealStatus d={d} /></TD>
            </TR>
          ))}</TBody>
        </Table></Card>
      )}
    </>
  );
}

// ───────────────────────── create / edit ─────────────────────────
function DealForm({ api, tenantId, errorMessage, initial, submitLabel, onSubmit, onCancel }: Pick<SlotProps, "api" | "tenantId" | "errorMessage"> & {
  initial: Partial<Deal>; submitLabel: string; onSubmit(body: Record<string, unknown>): Promise<unknown>; onCancel(): void;
}) {
  const contacts = useQuery({ queryKey: ["tenant", tenantId, "contacts", "picker"], queryFn: () => api.core<Page<ContactLite>>("/contacts?limit=100") });
  const companies = useQuery({ queryKey: ["tenant", tenantId, "companies", "picker"], queryFn: () => api.core<Page<CompanyLite>>("/companies?limit=100") });
  const [f, setF] = useState({
    title: initial.title ?? "", currency: initial.currency ?? "EUR", value: initial.value ? toMajor(initial.value, initial.currency ?? "EUR") : "",
    contactId: initial.contactId ?? "", companyId: initial.companyId ?? "", expectedClose: initial.expectedClose ?? "", notes: initial.notes ?? "",
  });
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    const value = parseMoney(f.value, f.currency);
    if (!f.title.trim()) return setErr("Give the deal a title");
    if (value === null) return setErr("Enter a valid value");
    setBusy(true); setErr(undefined);
    try {
      await onSubmit({
        title: f.title, value, currency: f.currency, contactId: f.contactId || null, companyId: f.companyId || null,
        expectedClose: f.expectedClose || null, notes: f.notes || null,
      });
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      {err && <Alert>{err}</Alert>}
      <Field label="Title">{(a) => <Input {...a} value={f.title} onChange={set("title")} />}</Field>
      <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
        <Field label="Value">{(a) => <Input {...a} inputMode="decimal" value={f.value} onChange={set("value")} />}</Field>
        <Field label="Currency">{(a) => <Input {...a} maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} />}</Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Contact">{(a) => (
          <Select {...a} value={f.contactId} onChange={(e) => {
            const c = contacts.data?.data.find((x) => x.id === e.target.value);
            setF({ ...f, contactId: e.target.value, companyId: f.companyId || c?.companyId || "" });
          }}>
            <option value="">—</option>{contacts.data?.data.map((c) => <option key={c.id} value={c.id}>{personName(c)}</option>)}
          </Select>
        )}</Field>
        <Field label="Company">{(a) => (
          <Select {...a} value={f.companyId} onChange={set("companyId")}>
            <option value="">—</option>{companies.data?.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        )}</Field>
      </div>
      <Field label="Expected close">{(a) => <Input {...a} type="date" value={f.expectedClose} onChange={set("expectedClose")} />}</Field>
      <Field label="Notes">{(a) => <Textarea {...a} rows={3} value={f.notes} onChange={set("notes")} />}</Field>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={busy}>{submitLabel}</Button>
      </div>
    </form>
  );
}

function NewDealDialog(props: SlotProps & { stageId?: string | undefined; onClose(): void; prefill?: Partial<Deal> }) {
  const qc = useQueryClient();
  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()} title="New deal">
      <DealForm {...props} initial={props.prefill ?? {}} submitLabel="Create deal" onCancel={props.onClose}
        onSubmit={async (body) => {
          const d = await props.api.post<DealFull>("/deals", { ...body, ...(props.stageId ? { stageId: props.stageId } : {}) });
          await qc.invalidateQueries({ queryKey: ["tenant", props.tenantId, "crm"] });
          props.onClose();
          props.navigate(`${ROOT}/${d.id}`);
        }} />
    </Dialog>
  );
}
export { NewDealDialog };

function StagesDialog({ api, tenantId, errorMessage, onClose }: SlotProps & { onClose(): void }) {
  const qc = useQueryClient();
  const key = ["tenant", tenantId, "crm"];
  const st = useQuery({ queryKey: [...key, "stages"], queryFn: () => api.get<{ data: Stage[] }>("/stages") });
  const [name, setName] = useState("");
  const [err, setErr] = useState<string>();
  const run = async (fn: () => Promise<unknown>) => {
    setErr(undefined);
    try { await fn(); await qc.invalidateQueries({ queryKey: key }); } catch (e) { setErr(errorMessage(e)); }
  };
  const ids = st.data?.data.map((s) => s.id) ?? [];
  const swap = (i: number, j: number) => { const n = [...ids]; [n[i], n[j]] = [n[j]!, n[i]!]; return run(() => api.put("/stages/order", { ids: n })); };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Pipeline stages" description="Won and lost are outcomes, not stages. Probability weights the pipeline forecast."
      footer={<Button onClick={onClose}>Done</Button>}>
      <div className="grid gap-3">
        {err && <Alert>{err}</Alert>}
        {st.isPending ? <Spinner /> : st.data?.data.map((s, i) => (
          <div key={s.id} className="grid grid-cols-[1fr_5rem_auto] items-end gap-2">
            <Field label={`Stage ${i + 1}`}>{(a) => <Input {...a} defaultValue={s.name} onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && run(() => api.patch(`/stages/${s.id}`, { name: e.target.value }))} />}</Field>
            <Field label="Prob. %">{(a) => <Input {...a} inputMode="numeric" defaultValue={String(s.probability)} onBlur={(e) => { const v = Number(e.target.value); if (Number.isInteger(v) && v >= 0 && v <= 100 && v !== s.probability) void run(() => api.patch(`/stages/${s.id}`, { probability: v })); }} />}</Field>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" aria-label={`Move ${s.name} up`} disabled={i === 0} onClick={() => swap(i, i - 1)}>↑</Button>
              <Button size="sm" variant="ghost" aria-label={`Move ${s.name} down`} disabled={i === ids.length - 1} onClick={() => swap(i, i + 1)}>↓</Button>
              <Button size="sm" variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => run(() => api.del(`/stages/${s.id}`))}>✕</Button>
            </div>
          </div>
        ))}
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void run(async () => { await api.post("/stages", { name }); setName(""); }); }}>
          <div className="flex-1"><Field label="New stage">{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} />}</Field></div>
          <Button type="submit" variant="outline" disabled={!name.trim()}>Add</Button>
        </form>
      </div>
    </Dialog>
  );
}

// ───────────────────────── detail ─────────────────────────
function DealDetail(props: SlotProps & { id: string }) {
  const { api, tenantId, can, navigate, errorMessage, id } = props;
  const qc = useQueryClient();
  const key = ["tenant", tenantId, "crm"];
  const q = useQuery({ queryKey: [...key, "deal", id], queryFn: () => api.get<DealFull>(`/deals/${id}`) });
  const st = useQuery({ queryKey: [...key, "stages"], queryFn: () => api.get<{ data: Stage[] }>("/stages") });
  const contact = useQuery({ queryKey: ["tenant", tenantId, "contacts", "one", q.data?.contactId], enabled: !!q.data?.contactId, queryFn: () => api.core<ContactLite>(`/contacts/${q.data!.contactId}`) });
  const company = useQuery({ queryKey: ["tenant", tenantId, "companies", "one", q.data?.companyId], enabled: !!q.data?.companyId, queryFn: () => api.core<CompanyLite>(`/companies/${q.data!.companyId}`) });
  const [dialog, setDialog] = useState<"edit" | "lost" | null>(null);
  const [reason, setReason] = useState("");
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: (d) => { if (d && typeof d === "object" && "id" in d) qc.setQueryData([...key, "deal", id], d); void qc.invalidateQueries({ queryKey: key }); },
  });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert>{errorMessage(q.error)}</Alert>;
  const d = q.data, open = d.status === "open", stages = st.data?.data ?? [];
  const idx = stages.findIndex((s) => s.id === d.stageId);
  return (
    <>
      <PageHeader title={d.title}
        description={<span className="inline-flex flex-wrap items-center gap-2"><DealStatus d={d} /><span className="tabular-nums">{money(d.value, d.currency)}</span>
          <a href={ROOT} className="hover:underline" onClick={(e) => { e.preventDefault(); navigate(ROOT); }}>← Deals</a></span>}
        actions={can(P.write) && <div className="flex flex-wrap gap-2">
          {open && <Button disabled={act.isPending} onClick={() => act.mutate(() => api.post(`/deals/${id}/won`))}>Mark won</Button>}
          {open && <Button variant="outline" onClick={() => setDialog("lost")}>Mark lost</Button>}
          {!open && <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate(() => api.post(`/deals/${id}/reopen`))}>Reopen</Button>}
          <Button variant="outline" onClick={() => setDialog("edit")}>Edit</Button>
          <Button variant="danger" disabled={act.isPending} onClick={() => act.mutate(async () => { await api.del(`/deals/${id}`); navigate(ROOT); })}>Delete</Button>
        </div>} />
      {act.error && <div className="mb-3"><Alert>{errorMessage(act.error)}</Alert></div>}
      {d.status === "lost" && d.lostReason && <div className="mb-3"><Alert tone="warning">Lost: {d.lostReason}</Alert></div>}
      <ol aria-label="Stage" className="mb-4 flex flex-wrap gap-1">
        {stages.map((s, i) => (
          <li key={s.id}>
            <button type="button" disabled={!open || !can(P.write) || s.id === d.stageId || act.isPending}
              aria-current={s.id === d.stageId ? "step" : undefined}
              onClick={() => act.mutate(() => api.post(`/deals/${id}/move`, { stageId: s.id }))}
              className={cn("rounded-md border px-3 py-1.5 text-sm", s.id === d.stageId ? "border-primary bg-primary text-primary-fg" : i < idx ? "bg-primary/10" : "bg-surface", open && can(P.write) && s.id !== d.stageId && "hover:border-primary")}>
              {s.name}
            </button>
          </li>
        ))}
      </ol>
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted">Contact</dt><dd>{d.contactId ? <a className="text-primary hover:underline" href={`/contacts/${d.contactId}`} onClick={(e) => { e.preventDefault(); navigate(`/contacts/${d.contactId}`); }}>{contact.data ? personName(contact.data) : "…"}</a> : "—"}</dd>
              <dt className="text-muted">Company</dt><dd>{d.companyId ? <a className="text-primary hover:underline" href={`/companies/${d.companyId}`} onClick={(e) => { e.preventDefault(); navigate(`/companies/${d.companyId}`); }}>{company.data?.name ?? "…"}</a> : "—"}</dd>
              <dt className="text-muted">Expected close</dt><dd>{fmtDay(d.expectedClose)}</dd>
              <dt className="text-muted">Probability</dt><dd>{d.stage ? `${d.stage.probability}%` : "—"}</dd>
              {d.closedAt && <><dt className="text-muted">Closed</dt><dd>{fmtDay(d.closedAt)}</dd></>}
            </dl>
            {d.notes && <p className="mt-3 whitespace-pre-wrap text-sm">{d.notes}</p>}
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle>Activity</CardTitle></CardHeader>
          <CardContent><Timeline {...props} filter={{ dealId: id }} /></CardContent>
        </Card>
      </div>
      {dialog === "edit" && (
        <Dialog open onOpenChange={(o) => !o && setDialog(null)} title="Edit deal">
          <DealForm {...props} initial={d} submitLabel="Save" onCancel={() => setDialog(null)}
            onSubmit={async (body) => { await act.mutateAsync(() => api.patch(`/deals/${id}`, body)); setDialog(null); }} />
        </Dialog>
      )}
      {dialog === "lost" && (
        <Dialog open onOpenChange={(o) => !o && setDialog(null)} title="Mark deal as lost"
          footer={<><Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="danger" onClick={async () => { await act.mutateAsync(() => api.post(`/deals/${id}/lost`, { reason })); setDialog(null); }}>Mark lost</Button></>}>
          <Field label="Reason (optional)">{(a) => <Input {...a} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Price, timing, competitor" />}</Field>
        </Dialog>
      )}
    </>
  );
}
