import { useState } from "react";
import { CalendarClock, Globe, Plus, Search, UserPlus } from "lucide-react";
import {
  Button, Card, EmptyState, ErrorState, Input, PageHeader, Select, Skeleton, Table, TBody, TD, TH, THead, TR, Tabs, TabsList, TabsTrigger, cn,
} from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import { fmtDate, isOpen, SOURCES, sourceLabel, StatusBadge, today, useDebounced, useLoad, type Lead, type Source, type Summary } from "./shared.tsx";

const VIEWS = [
  { value: "open", label: "To work on" }, { value: "qualified", label: "Qualified" }, { value: "converted", label: "Converted" },
  { value: "disqualified", label: "Disqualified" }, { value: "all", label: "All" },
] as const;

export function LeadTable({ rows, onOpen }: { rows: Lead[]; onOpen: (l: Lead) => void }) {
  return (
    <Table>
      <THead><TR>
        <TH>Lead</TH><TH className="hidden md:table-cell">Company</TH><TH>Status</TH>
        <TH className="hidden lg:table-cell">Source</TH><TH className="hidden md:table-cell">Follow up</TH><TH className="hidden lg:table-cell">Owner</TH>
      </TR></THead>
      <TBody>
        {rows.map((l) => {
          const due = isOpen(l.status) && l.followUpOn && l.followUpOn <= today();
          return (
            <TR key={l.id} className="cursor-pointer" onClick={() => onOpen(l)}>
              <TD><span className="font-medium">{l.name}</span>{l.email && l.email !== l.name && <span className="block text-xs text-muted-foreground">{l.email}</span>}</TD>
              <TD className="hidden md:table-cell text-muted-foreground">{l.companyName ?? "—"}</TD>
              <TD><StatusBadge status={l.status} /></TD>
              <TD className="hidden lg:table-cell text-muted-foreground">{sourceLabel(l.source)}</TD>
              <TD className={cn("hidden md:table-cell", due ? "font-medium text-destructive" : "text-muted-foreground")}>{isOpen(l.status) ? fmtDate(l.followUpOn) : "—"}</TD>
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
  const [source, setSource] = useState<Source | "">("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const list = useLoad(() => host.api.get<{ data: Lead[] }>("/leads", { view, limit: 200, ...(source ? { source } : {}), ...(dq ? { q: dq } : {}) }), [host, view, source, dq]);
  const sum = useLoad(() => host.api.get<Summary>("/summary"), [host]);
  const s = sum.data;
  const filtered = !!(dq || source);

  return (
    <>
      <PageHeader title="Leads" description="People who might become customers. Follow up, qualify them, then convert the good ones into customers."
        actions={<>
          {host.can("leads:form.manage") && <Button variant="outline" onClick={() => host.navigate("/form")}><Globe /> Web form</Button>}
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
        {list.loading && !list.data ? <div className="grid gap-2 p-4"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
          : list.error ? <ErrorState error={list.error} onRetry={() => void list.reload()} />
          : !list.data?.data.length ? (
            filtered || view !== "open" ? <EmptyState icon={<Search />} title="No leads here" description="Try another tab or search." />
              : <EmptyState icon={<UserPlus />} title="No leads to work on"
                  description="Add someone you met, or turn on the web form so people can reach you from your website."
                  action={canWrite && <Button onClick={() => host.navigate("/leads/new")}><Plus /> New lead</Button>} />
          ) : <LeadTable rows={list.data.data} onOpen={(l) => host.navigate(`/leads/${l.id}`)} />}
      </Card>
      {s && s.followUpsDue > 0 && view === "open" && (
        <p className="mt-3 flex items-center gap-2 text-sm text-destructive"><CalendarClock className="size-4" /> Dates in red are follow-ups that are due.</p>
      )}
    </>
  );
}
