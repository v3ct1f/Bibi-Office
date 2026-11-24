import { useState } from "react";
import { CalendarClock, Globe, Plus, Upload, Search, UserPlus } from "lucide-react";
import {
  Button, Card, Checkbox, EmptyState, ErrorState, Input, PageHeader, Select, Skeleton, Table, TBody, TD, TH, THead, TR, Tabs, TabsList, TabsTrigger, cn, toast,
} from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import {
  errorMessage, fmtDate, inDays, isOpen, SNOOZES, SOURCES, sourceLabel, StatusBadge, today, useDebounced, useLoad, type Lead, type Person, type Source, type Summary,
} from "./shared.tsx";

const VIEWS = [
  { value: "due", label: "Follow up now" }, { value: "open", label: "To work on" }, { value: "qualified", label: "Qualified" }, { value: "converted", label: "Converted" },
  { value: "disqualified", label: "Disqualified" }, { value: "all", label: "All" },
] as const;

export function LeadTable({ rows, onOpen, selected, onSelect, onSnooze }: {
  rows: Lead[]; onOpen: (l: Lead) => void;
  selected?: Set<string>; onSelect?: (ids: string[], on: boolean) => void; onSnooze?: (l: Lead, days: number) => void;
}) {
  const selectable = rows.filter((l) => isOpen(l.status));
  const allOn = !!selected && selectable.length > 0 && selectable.every((l) => selected.has(l.id));
  return (
    <Table>
      <THead><TR>
        {onSelect && <TH className="w-10"><Checkbox checked={allOn} onCheckedChange={(v) => onSelect(selectable.map((l) => l.id), v === true)} aria-label="Select all" /></TH>}
        <TH>Lead</TH><TH className="hidden md:table-cell">Company</TH><TH>Status</TH>
        <TH className="hidden lg:table-cell">Source</TH><TH>Follow up</TH><TH className="hidden lg:table-cell">Owner</TH>
      </TR></THead>
      <TBody>
        {rows.map((l) => {
          const open = isOpen(l.status);
          const due = open && l.followUpOn && l.followUpOn <= today();
          return (
            <TR key={l.id} className="cursor-pointer" onClick={() => onOpen(l)}>
              {onSelect && <TD onClick={(e) => e.stopPropagation()}>{open && <Checkbox checked={!!selected?.has(l.id)} onCheckedChange={(v) => onSelect([l.id], v === true)} aria-label={`Select ${l.name}`} />}</TD>}
              <TD><span className="font-medium">{l.name}</span>{l.email && l.email !== l.name && <span className="block text-xs text-muted-foreground">{l.email}</span>}</TD>
              <TD className="hidden md:table-cell text-muted-foreground">{l.companyName ?? "—"}</TD>
              <TD><StatusBadge status={l.status} /></TD>
              <TD className="hidden lg:table-cell text-muted-foreground">{sourceLabel(l.source)}</TD>
              <TD className={cn(due ? "font-medium text-destructive" : "text-muted-foreground")}>
                {open ? fmtDate(l.followUpOn) : "—"}
                {open && onSnooze && (
                  <span className="mt-1 flex gap-1" onClick={(e) => e.stopPropagation()}>
                    {SNOOZES.map((n) => (
                      <button key={n.days} type="button" aria-label={`Follow up ${n.label.toLowerCase()}: ${l.name}`} onClick={() => onSnooze(l, n.days)}
                        className="cursor-pointer rounded border px-1.5 py-0.5 text-xs font-normal text-foreground hover:bg-muted">{n.short}</button>
                    ))}
                  </span>
                )}
              </TD>
              <TD className="hidden lg:table-cell text-muted-foreground">{l.ownerName ?? "Unassigned"}</TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

export function LeadList(_: PageProps) {
  const host = useModuleHost();
  const canWrite = host.can("leads:lead.write");
  const [view, setView] = useState<(typeof VIEWS)[number]["value"]>("open");
  const [mine, setMine] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignTo, setAssignTo] = useState("");
  const [source, setSource] = useState<Source | "">("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const list = useLoad(() => host.api.get<{ data: Lead[] }>("/leads", {
    view: view === "due" ? "open" : view, limit: 200, ...(view === "due" ? { due: "1" } : {}), ...(mine ? { mine: "1" } : {}),
    ...(source ? { source } : {}), ...(dq ? { q: dq } : {}),
  }), [host, view, source, dq, mine]);
  const people = useLoad(() => (canWrite ? host.api.get<Person[]>("/people").catch(() => [] as Person[]) : Promise.resolve([] as Person[])), [host, canWrite]);
  const toggle = (ids: string[], on: boolean) => setSelected((cur) => { const n = new Set(cur); for (const id of ids) { if (on) n.add(id); else n.delete(id); } return n; });
  const reloadAll = () => { void list.reload(); void sum.reload(); };
  const snooze = async (l: Lead, days: number) => {
    try { await host.api.patch(`/leads/${l.id}`, { followUpOn: inDays(days) }); toast.success(`Follow up with ${l.name} on ${fmtDate(inDays(days))}`); reloadAll(); }
    catch (e) { toast.error(errorMessage(e)); }
  };
  const assign = async () => {
    try {
      const r = await host.api.post<{ changed: number }>("/leads/assign", { ids: [...selected], ownerId: assignTo === "none" ? null : assignTo });
      toast.success(`${r.changed} lead${r.changed === 1 ? "" : "s"} reassigned`); setSelected(new Set()); setAssignTo(""); reloadAll();
    } catch (e) { toast.error(errorMessage(e)); }
  };
  const sum = useLoad(() => host.api.get<Summary>("/summary"), [host]);
  const s = sum.data;
  const filtered = !!(dq || source || mine);

  return (
    <>
      <PageHeader title="Leads" description="People who might become customers. Follow up, qualify them, then convert the good ones into customers."
        actions={<>
          {host.can("leads:form.manage") && <Button variant="outline" onClick={() => host.navigate("/form")}><Globe /> Web form</Button>}
          {canWrite && <Button variant="outline" onClick={() => host.navigate("/leads/import")}><Upload /> Import</Button>}
          {canWrite && <Button onClick={() => host.navigate("/leads/new")}><Plus /> New lead</Button>}
        </>} />
      {s && s.open + s.addedThisWeek > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: "New", value: s.byStatus.new, hint: "not contacted yet" },
            { label: "Being worked on", value: s.byStatus.contacted + s.byStatus.qualified, hint: `${s.byStatus.qualified} qualified` },
            { label: "Follow-ups due", value: s.followUpsDue, hint: "today or earlier", alert: s.followUpsDue > 0 },
            { label: "Converted (90 days)", value: s.conversionRate90d === null ? "—" : `${s.conversionRate90d}%`, hint: "of leads decided" },
          ].map((t) => (
            <Card key={t.label} className="p-4">
              <p className="text-xs text-muted-foreground">{t.label}</p>
              <p className={cn("text-2xl font-semibold tabular-nums", t.alert && "text-destructive")}>{t.value}</p>
              <p className="text-xs text-muted-foreground">{t.hint}</p>
            </Card>
          ))}
        </div>
      )}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
          <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
            <TabsList>{VIEWS.map((f) => <TabsTrigger key={f.value} value={f.value}>{f.label}</TabsTrigger>)}</TabsList>
          </Tabs>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <Button variant={mine ? "default" : "outline"} aria-pressed={mine} onClick={() => setMine((m) => !m)}>My leads</Button>
            <Select aria-label="Source" className="w-full sm:w-40" value={source} onChange={(e) => setSource(e.target.value as Source | "")}>
              <option value="">All sources</option>
              {SOURCES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input aria-label="Search leads" className="pl-8" placeholder="Name, email, company…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
        </div>
        {canWrite && selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 p-3 text-sm" role="region" aria-label="Selected leads">
            <span>{selected.size} selected</span>
            <Select aria-label="Give to" className="w-48" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
              <option value="">Give to…</option>
              {(people.data ?? []).map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
              <option value="none">Nobody (unassigned)</option>
            </Select>
            <Button disabled={!assignTo} onClick={() => void assign()}>Assign</Button>
            <Button variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        )}
        {list.loading && !list.data ? <div className="grid gap-2 p-4"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
          : list.error ? <ErrorState error={list.error} onRetry={() => void list.reload()} />
          : !list.data?.data.length ? (
            view === "due" && !filtered ? <EmptyState icon={<CalendarClock />} title="Nothing to follow up right now" description="Leads with a follow-up date of today or earlier show up here." />
              : filtered || view !== "open" ? <EmptyState icon={<Search />} title="No leads here" description="Try another tab or search." />
              : <EmptyState icon={<UserPlus />} title="No leads to work on"
                  description="Add someone you met, or turn on the web form so people can reach you from your website."
                  action={canWrite && <Button onClick={() => host.navigate("/leads/new")}><Plus /> New lead</Button>} />
          ) : <LeadTable rows={list.data.data} onOpen={(l) => host.navigate(`/leads/${l.id}`)} {...(canWrite ? { selected, onSelect: toggle, onSnooze: (l: Lead, d: number) => void snooze(l, d) } : {})} />}
      </Card>
      {s && s.followUpsDue > 0 && view === "open" && (
        <p className="mt-3 flex items-center gap-2 text-sm text-destructive"><CalendarClock className="size-4" /> Dates in red are follow-ups that are due.</p>
      )}
    </>
  );
}
