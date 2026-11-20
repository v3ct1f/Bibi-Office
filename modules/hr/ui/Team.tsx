import { useState, type FormEvent } from "react";
import { ChevronDown, ChevronRight, ClipboardList, Plus, Search, Trash2, Users } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, Dialog, DialogContent, DialogFooter, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton, Table, TBody, TD, TH, THead, TR, toast } from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import {
  Avatar, CL_KIND, ModLink, OWNER, SectionTabs, errorMessage, fmtDate, fmtDays, useDebounced, useLoad,
  type Checklist, type ChecklistKind, type Config, type Person, type Template, type TemplateItem, type TaskOwner,
} from "./shared.tsx";

// ── Directory ────────────────────────────────────────────────────────────────
export function Directory(_: PageProps) {
  const host = useModuleHost();
  const cfg = useLoad(() => host.api.get<Config>("/config"), [host]);
  const [q, setQ] = useState("");
  const [department, setDepartment] = useState("");
  const [former, setFormer] = useState(false);
  const dq = useDebounced(q.trim());
  const list = useLoad(() => host.api.get<Person[]>("/people", { q: dq || undefined, department: department || undefined, includeFormer: former ? "true" : undefined }), [host, dq, department, former]);
  return (
    <>
      <PageHeader title="People" description="Everyone in the team, what they do and who they report to." />
      <SectionTabs current="/people" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input aria-label="Search people" className="pl-8" placeholder="Search by name, job title or department…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select aria-label="Department" className="w-48" value={department} onChange={(e) => setDepartment(e.target.value)}>
          <option value="">All departments</option>
          {cfg.data?.departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </Select>
        {cfg.data?.canManage && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={former} onChange={(e) => setFormer(e.target.checked)} /> Show people who left</label>
        )}
      </div>
      {list.error ? <Card><ErrorState error={list.error} onRetry={() => void list.reload()} /></Card>
        : !list.data ? <Skeleton className="h-64" />
        : !list.data.length ? <Card><EmptyState icon={<Users />} title={dq ? `Nobody matches “${dq}”` : "Nobody here"} /></Card>
        : (
          <ul aria-label="People" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.data.map((p) => (
              <li key={p.userId}>
                <Card className="h-full p-4">
                  <ModLink to={`/people/${p.userId}`} className="flex items-start gap-3">
                    <Avatar name={p.name} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium hover:underline">{p.name}</span>
                      <span className="block truncate text-sm text-muted-foreground">{[p.jobTitle, p.department].filter(Boolean).join(" · ") || "No job title yet"}</span>
                      {p.managerName && <span className="block truncate text-xs text-muted-foreground">Reports to {p.managerName}</span>}
                      {!p.active && <Badge variant="neutral" className="mt-1">Left {fmtDate(p.endDate)}</Badge>}
                    </span>
                  </ModLink>
                </Card>
              </li>
            ))}
          </ul>
        )}
    </>
  );
}

// ── Org chart ────────────────────────────────────────────────────────────────
export function OrgChart(_: PageProps) {
  const host = useModuleHost();
  const list = useLoad(() => host.api.get<Person[]>("/people"), [host]);
  const people = list.data ?? [];
  const ids = new Set(people.map((p) => p.userId));
  const children = (id: string | null) => people.filter((p) => (id === null ? !p.managerId || !ids.has(p.managerId) : p.managerId === id));
  const roots = children(null);
  return (
    <>
      <PageHeader title="Org chart" description="Who reports to whom. Set each person's manager on their profile." />
      <SectionTabs current="/people/org" />
      {list.error ? <Card><ErrorState error={list.error} onRetry={() => void list.reload()} /></Card>
        : !list.data ? <Skeleton className="h-64" />
        : (
          <Card className="overflow-x-auto p-4">
            <ul role="tree" aria-label="Org chart" className="grid gap-1">
              {roots.map((p) => <OrgNode key={p.userId} p={p} kids={children} depth={0} />)}
            </ul>
            {roots.length === people.length && people.length > 1 && (
              <p className="mt-3 text-sm text-muted-foreground">Nobody has a manager yet. Open a profile and choose who they report to.</p>
            )}
          </Card>
        )}
    </>
  );
}
function OrgNode({ p, kids, depth }: { p: Person; kids: (id: string) => Person[]; depth: number }) {
  const [open, setOpen] = useState(true);
  const reports = depth < 20 ? kids(p.userId) : [];
  return (
    <li role="treeitem" aria-expanded={reports.length ? open : undefined} aria-label={p.name}>
      <div className="flex items-center gap-2 rounded-md py-1 pr-2" style={{ paddingLeft: depth * 24 }}>
        {reports.length ? (
          <button type="button" aria-label={open ? `Hide ${p.name}'s team` : `Show ${p.name}'s team`} className="rounded p-0.5 hover:bg-accent" onClick={() => setOpen(!open)}>
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        ) : <span className="w-5" />}
        <Avatar name={p.name} size="sm" />
        <ModLink to={`/people/${p.userId}`} className="font-medium hover:underline">{p.name}</ModLink>
        <span className="truncate text-sm text-muted-foreground">{p.jobTitle ?? ""}{reports.length ? ` · ${reports.length} report${reports.length === 1 ? "" : "s"}` : ""}</span>
      </div>
      {open && reports.length > 0 && <ul role="group" className="grid gap-1">{reports.map((r) => <OrgNode key={r.userId} p={r} kids={kids} depth={depth + 1} />)}</ul>}
    </li>
  );
}

// ── Leave overview ───────────────────────────────────────────────────────────
interface LeaveRow { userId: string; name: string; department: string | null; allowance: number; adjustments: number; total: number; vacationTaken: number; vacationBooked: number; remaining: number; sick: number; other: number }
export function LeaveOverview(_: PageProps) {
  const host = useModuleHost();
  const [year, setYear] = useState(new Date().getUTCFullYear());
  const list = useLoad(() => host.api.get<{ year: number; data: LeaveRow[] }>("/leave", { year }), [host, year]);
  return (
    <>
      <PageHeader title="Leave" description="Vacation allowance and what's taken, booked and left this year. Approved time off in Schedule is counted automatically (working days, Monday to Friday)." />
      <SectionTabs current="/people/leave" />
      <div className="mb-3 flex items-center gap-2">
        <Button size="sm" variant="outline" aria-label="Previous year" onClick={() => setYear(year - 1)}>‹</Button>
        <span className="min-w-14 text-center font-medium tabular-nums" aria-live="polite">{year}</span>
        <Button size="sm" variant="outline" aria-label="Next year" onClick={() => setYear(year + 1)}>›</Button>
      </div>
      {list.error ? <Card><ErrorState error={list.error} onRetry={() => void list.reload()} /></Card>
        : !list.data ? <Skeleton className="h-64" />
        : (
          <Card className="overflow-x-auto">
            <Table aria-label={`Leave ${year}`}>
              <THead><TR><TH>Person</TH><TH className="text-right">Allowance</TH><TH className="text-right">Taken</TH><TH className="text-right">Booked</TH><TH className="text-right">Left</TH><TH className="text-right">Sick</TH></TR></THead>
              <TBody>
                {list.data.data.map((r) => (
                  <TR key={r.userId}>
                    <TD><ModLink to={`/people/${r.userId}?tab=leave`} className="font-medium hover:underline">{r.name}</ModLink>{r.department && <span className="ml-2 text-xs text-muted-foreground">{r.department}</span>}</TD>
                    <TD className="text-right tabular-nums">{fmtDays(r.total)}{r.adjustments ? <span className="block text-xs text-muted-foreground">{r.allowance} {r.adjustments > 0 ? "+" : "−"} {Math.abs(r.adjustments)}</span> : null}</TD>
                    <TD className="text-right tabular-nums">{r.vacationTaken}</TD>
                    <TD className="text-right tabular-nums">{r.vacationBooked}</TD>
                    <TD className={`text-right font-medium tabular-nums ${r.remaining < 0 ? "text-destructive" : ""}`}>{r.remaining}</TD>
                    <TD className="text-right tabular-nums text-muted-foreground">{r.sick}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        )}
    </>
  );
}

// ── Checklists ───────────────────────────────────────────────────────────────
export function Checklists(_: PageProps) {
  const host = useModuleHost();
  const cfg = useLoad(() => host.api.get<Config>("/config"), [host]);
  const [status, setStatus] = useState<"active" | "done">("active");
  const list = useLoad(() => host.api.get<Checklist[]>("/checklists", { status }), [host, status]);
  const tpls = useLoad(() => host.api.get<Template[]>("/templates"), [host]);
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  const [deleting, setDeleting] = useState<Template | null>(null);
  const manage = !!cfg.data?.canManage;
  return (
    <>
      <PageHeader title="Checklists" description="Onboarding and offboarding steps, each with an owner and a due date. Assign one from a person's profile." />
      <SectionTabs current="/people/checklists" />
      <div role="tablist" aria-label="Which checklists" className="mb-3 flex gap-1.5">
        <Button role="tab" aria-selected={status === "active"} size="sm" variant={status === "active" ? "default" : "outline"} onClick={() => setStatus("active")}>In progress</Button>
        <Button role="tab" aria-selected={status === "done"} size="sm" variant={status === "done" ? "default" : "outline"} onClick={() => setStatus("done")}>Done</Button>
      </div>
      {list.error ? <Card><ErrorState error={list.error} onRetry={() => void list.reload()} /></Card>
        : !list.data ? <Skeleton className="h-40" />
        : !list.data.length ? <Card><EmptyState icon={<ClipboardList />} title={status === "active" ? "No checklists in progress" : "No finished checklists"} /></Card>
        : (
          <Card className="mb-6 overflow-x-auto">
            <Table aria-label="Checklists">
              <THead><TR><TH>Person</TH><TH>Checklist</TH><TH>Starts</TH><TH className="text-right">Progress</TH></TR></THead>
              <TBody>
                {list.data.map((c) => (
                  <TR key={c.id}>
                    <TD><ModLink to={`/people/${c.userId}?tab=checklists`} className="font-medium hover:underline">{c.personName}</ModLink></TD>
                    <TD>{c.name} <Badge variant="outline">{CL_KIND[c.kind]}</Badge></TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{fmtDate(c.startDate)}</TD>
                    <TD className="text-right tabular-nums">{c.done} / {c.total}{c.tasks.some((t) => t.overdue) && <Badge variant="destructive" className="ml-2">Overdue</Badge>}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        )}

      <Card className="mt-6 grid gap-3 p-5" role="group" aria-label="Checklist templates">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Checklist templates</h2>
            <p className="text-sm text-muted-foreground">Reusable lists, e.g. “New barista” or “Leaving the company”.</p>
          </div>
          {manage && <Button size="sm" onClick={() => setEditing("new")}><Plus /> New template</Button>}
        </div>
        {!tpls.data ? <Skeleton className="h-16" /> : !tpls.data.length ? <p className="text-sm text-muted-foreground">No templates yet.</p> : (
          <ul className="divide-y rounded-md border">
            {tpls.data.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span><span className="font-medium">{t.name}</span> <span className="text-sm text-muted-foreground">· {CL_KIND[t.kind]} · {t.items.length} task{t.items.length === 1 ? "" : "s"}</span></span>
                {manage && (
                  <span className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>Edit</Button>
                    <Button size="sm" variant="ghost" aria-label={`Delete ${t.name}`} onClick={() => setDeleting(t)}><Trash2 /></Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && <TemplateDialog tpl={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void tpls.reload(); }} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }} destructive confirmLabel="Delete" title={`Delete “${deleting?.name}”?`}
        description="Checklists already assigned from it stay as they are."
        onConfirm={async () => { await host.api.del(`/templates/${deleting!.id}`); toast.success("Template deleted"); setDeleting(null); await tpls.reload(); }} />
    </>
  );
}

function TemplateDialog({ tpl, onClose, onSaved }: { tpl: Template | null; onClose: () => void; onSaved: () => void }) {
  const host = useModuleHost();
  const [name, setName] = useState(tpl?.name ?? "");
  const [kind, setKind] = useState<ChecklistKind>(tpl?.kind ?? "onboarding");
  const [items, setItems] = useState<(TemplateItem & { days: string })[]>((tpl?.items ?? [{ title: "", owner: "employee" as TaskOwner, dueDays: 0 }]).map((i) => ({ ...i, days: String(i.dueDays) })));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (i: number, p: Partial<TemplateItem & { days: string }>) => setItems(items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  async function save(e: FormEvent) {
    e.preventDefault();
    const clean = items.filter((i) => i.title.trim());
    if (!name.trim()) { setError("Name the checklist"); return; }
    if (!clean.length) { setError("Add at least one task"); return; }
    if (clean.some((i) => !/^-?\d+$/.test(i.days.trim()))) { setError("Due days must be whole numbers (0 = the start day, -3 = three days before)"); return; }
    setBusy(true); setError(null);
    try {
      const body = { name: name.trim(), kind, items: clean.map((i) => ({ title: i.title.trim(), owner: i.owner, dueDays: Number(i.days) })) };
      if (tpl) await host.api.put(`/templates/${tpl.id}`, body); else await host.api.post("/templates", body);
      toast.success("Template saved");
      onSaved();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={tpl ? "Edit checklist template" : "New checklist template"} wide>
        <form className="grid gap-4" onSubmit={(e) => void save(e)} noValidate>
          <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
            <Field label="Name" required>{(a) => <Input {...a} maxLength={80} placeholder="e.g. New barista" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
            <Field label="Kind">{(a) => <Select {...a} value={kind} onChange={(e) => setKind(e.target.value as ChecklistKind)}>{(Object.keys(CL_KIND) as ChecklistKind[]).map((k) => <option key={k} value={k}>{CL_KIND[k]}</option>)}</Select>}</Field>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Tasks <span className="font-normal text-muted-foreground">(due = days after the start day; negative = before)</span></legend>
            {items.map((it, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_12rem_6rem_auto]">
                <Input aria-label={`Task ${i + 1}`} placeholder="What needs doing" value={it.title} onChange={(e) => set(i, { title: e.target.value })} />
                <Select aria-label={`Task ${i + 1} owner`} value={it.owner} onChange={(e) => set(i, { owner: e.target.value as TaskOwner })}>
                  {(Object.keys(OWNER) as TaskOwner[]).map((o) => <option key={o} value={o}>{OWNER[o]}</option>)}
                </Select>
                <Input aria-label={`Task ${i + 1} due days`} inputMode="numeric" value={it.days} onChange={(e) => set(i, { days: e.target.value })} />
                <Button type="button" variant="ghost" aria-label={`Remove task ${i + 1}`} onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>
            ))}
            <div><Button type="button" size="sm" variant="outline" onClick={() => setItems([...items, { title: "", owner: "employee", dueDays: 0, days: "0" }])}><Plus /> Add task</Button></div>
          </fieldset>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={busy}>Save template</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

