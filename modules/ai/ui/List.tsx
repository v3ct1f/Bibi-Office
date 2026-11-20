import { useState } from "react";
import { BarChart3, Headphones, ListChecks, Lock, Plus, Search, Sparkles, Users } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, Input, PageHeader, Skeleton, Table, TBody, TD, TH, THead, TR, toast } from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import {
  errorMessage, fmtDate, fmtDateTime, fmtNum, ModLink, plural, SectionTabs, SetupNotice, useDebounced, useLoad, type Config, type Kind, type Row, type UsageMonth,
} from "./shared.tsx";

/** One summary in a list: title, date, first lines, action items. */
export function SummaryList({ rows, compact }: { rows: Row[]; compact?: boolean }) {
  return (
    <ul className="grid gap-2" aria-label="Summaries">
      {rows.map((r) => (
        <li key={r.id}>
          <Card className={compact ? "p-3" : "p-4"}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <ModLink to={`/ai/${r.id}`} className="font-medium hover:underline">{r.title}</ModLink>
              <span className="text-xs text-muted-foreground">
                {r.kind === "meeting" ? fmtDate(r.meetingDate ?? r.createdAt) : fmtDateTime(r.createdAt)}
                {r.createdByName ? ` · ${r.createdByName}` : ""}
              </span>
            </div>
            {!compact && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{r.summary}</p>}
            <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-muted-foreground">
              {r.actionItemCount > 0 && (
                <span className="inline-flex items-center gap-1"><ListChecks className="size-3.5" />
                  {plural(r.actionItemCount, "action item")}{r.openActionItems ? `, ${r.openActionItems} not yet a task` : ""}
                </span>
              )}
              {r.visibility === "private" && <span className="inline-flex items-center gap-1"><Lock className="size-3.5" /> Only you</span>}
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function ListPage({ kind }: { kind: Kind }) {
  const host = useModuleHost();
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const cfg = useLoad(() => host.api.get<Config>("/config"), [host]);
  const list = useLoad(() => host.api.get<Row[]>("/summaries", { kind, q: dq.trim() || undefined }), [host, kind, dq]);
  const canWrite = host.can("ai:summary.write");
  const newBtn = canWrite && kind === "meeting" && <Button onClick={() => host.navigate("/ai/new")}><Plus /> New meeting summary</Button>;
  return (
    <>
      <PageHeader title="AI summaries" description="Claude reads meeting notes and support tickets and pulls out what matters." actions={newBtn} />
      <SectionTabs current={kind === "meeting" ? "/ai" : "/ai/tickets"} />
      {cfg.data && !cfg.data.ready && <SetupNotice />}
      <div className="relative mb-3 max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input aria-label="Search summaries" className="pl-8" placeholder="Search summaries…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {list.error ? <Card><ErrorState error={list.error} onRetry={() => void list.reload()} /></Card>
        : !list.data ? <Skeleton className="h-48" />
        : list.data.length ? <SummaryList rows={list.data} />
        : (
          <Card>
            {kind === "meeting"
              ? <EmptyState icon={<Users />} title={dq ? "No meeting summaries found" : "No meeting summaries yet"}
                  description="Paste your notes or upload the transcript from Zoom, Teams or Google Meet. You get the key points, decisions, action items and a follow-up email."
                  action={newBtn} />
              : <EmptyState icon={<Headphones />} title={dq ? "No ticket summaries found" : "No ticket summaries yet"}
                  description="Open a long support ticket and use “Summarise” in its side panel. You get a short recap and a suggested reply." />}
          </Card>
        )}
    </>
  );
}

export const MeetingsPage = (_: PageProps) => <ListPage kind="meeting" />;
export const TicketsPage = (_: PageProps) => <ListPage kind="ticket" />;

/** Tokens used per month and an estimate of what Anthropic charges, for managers. */
export function UsagePage(_: PageProps) {
  const host = useModuleHost();
  const cfg = useLoad(() => host.api.get<Config>("/config"), [host]);
  const u = useLoad(() => host.api.get<{ limit: number; months: UsageMonth[] }>("/usage"), [host]);
  const [testing, setTesting] = useState(false);
  async function test() {
    setTesting(true);
    try { const r = await host.api.post<{ model: string }>("/test"); toast.success(`The API key works (${r.model})`); void u.reload(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setTesting(false); }
  }
  const used = cfg.data?.usage;
  return (
    <>
      <PageHeader title="AI summaries" description="What your company has used. Anthropic bills your account directly." />
      <SectionTabs current="/ai/usage" />
      {cfg.data && !cfg.data.ready && <SetupNotice />}
      {cfg.data && (
        <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center" role="group" aria-label="This month">
          <div className="grid gap-1 text-sm">
            <p><span className="font-medium">Model:</span> {cfg.data.modelLabel}</p>
            {used && <p><span className="font-medium">This month:</span> {fmtNum(used.usedThisMonth)} tokens
              {used.limit > 0 ? ` of ${fmtNum(used.limit)} (${Math.min(100, Math.round((used.usedThisMonth / used.limit) * 100))}%)` : " (no limit)"}</p>}
            <p className="text-muted-foreground">Change the model, the language and the monthly limit under Add features → AI summaries → Settings.</p>
          </div>
          {cfg.data.ready && <Button variant="outline" loading={testing} onClick={() => void test()}>Test the API key</Button>}
        </Card>
      )}
      {u.error ? <Card><ErrorState error={u.error} onRetry={() => void u.reload()} /></Card>
        : !u.data ? <Skeleton className="h-40" />
        : !u.data.months.length ? <Card><EmptyState icon={<BarChart3 />} title="Nothing used yet" description="Usage shows up here after the first summary." /></Card>
        : (
          <Card className="overflow-x-auto">
            <Table aria-label="Usage per month">
              <THead><TR><TH>Month</TH><TH className="text-right">Meetings</TH><TH className="text-right">Tickets</TH><TH className="text-right">Tokens in</TH><TH className="text-right">Tokens out</TH><TH className="text-right">About</TH></TR></THead>
              <TBody>
                {u.data.months.map((m) => (
                  <TR key={m.month}>
                    <TD>{new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m.month}-01T00:00:00Z`))}</TD>
                    <TD className="text-right tabular-nums">{m.meetings}</TD>
                    <TD className="text-right tabular-nums">{m.tickets}</TD>
                    <TD className="text-right tabular-nums">{fmtNum(m.inputTokens)}</TD>
                    <TD className="text-right tabular-nums">{fmtNum(m.outputTokens)}</TD>
                    <TD className="text-right tabular-nums">${m.costUsd.toFixed(2)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <p className="flex items-center gap-1.5 p-3 text-xs text-muted-foreground"><Sparkles className="size-3.5" /> “About” uses Anthropic's list prices. Your Anthropic invoice is the real figure.</p>
          </Card>
        )}
    </>
  );
}
