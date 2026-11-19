import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Table, TBody, TD, TH, THead, TR, Textarea,
} from "@office/ui";
import type { SlotProps } from "@office/sdk/ui";
import type { Kind, Status, Summary, SummaryRow } from "./types.ts";

const P = { create: "ai:summaries.create" } as const;
const ROOT = "/m/ai/summaries";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: [Kind, string][] = [["meeting", "Meeting notes or transcript"], ["email", "Email thread"], ["notes", "Other notes"]];
const KIND_LABEL: Record<Kind, string> = { meeting: "Meeting", email: "Email", notes: "Notes" };
const key = (tenantId: string, ...rest: unknown[]) => ["tenant", tenantId, "ai", ...rest];
const lang = () => (typeof navigator !== "undefined" && navigator.language) || "en";
const fmtWhen = (iso: string) => new Date(iso).toLocaleString(lang(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtNum = (n: number) => n.toLocaleString(lang());

/** /m/ai/summaries[/<summary id>] */
export function SummariesPage(props: SlotProps) {
  const seg = (props.subPath ?? "").split("/").filter(Boolean);
  if (seg[0] && UUID.test(seg[0])) return <SummaryPage {...props} id={seg[0]} />;
  if (seg.length) return <EmptyState title="Page not found" />;
  return <Overview {...props} />;
}

function useStatus({ api, tenantId }: SlotProps) {
  return useQuery({ queryKey: key(tenantId, "status"), queryFn: () => api.get<Status>("/status") });
}

function Usage({ s }: { s: Status }) {
  const pct = Math.min(100, Math.round((s.usage.used / s.usage.limit) * 100));
  return (
    <Card>
      <CardContent className="grid gap-2 pt-5 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-3"><span className="font-medium">This month</span>
          <span className="tabular-nums text-muted">{fmtNum(s.usage.used)} of {fmtNum(s.usage.limit)} tokens · {s.usage.requests} {s.usage.requests === 1 ? "summary" : "summaries"}</span></div>
        <div className="h-2 overflow-hidden rounded bg-surface-2" role="progressbar" aria-label="Monthly AI usage" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={pct >= 90 ? "h-full bg-danger" : "h-full bg-primary"} style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-muted">Text is sent to Claude ({s.model}) only when someone clicks Summarize, using your organization's own Anthropic API key.</p>
      </CardContent>
    </Card>
  );
}

function Overview(props: SlotProps) {
  const { api, tenantId, can, navigate, errorMessage } = props;
  const status = useStatus(props);
  const [adding, setAdding] = useState(false);
  const list = useInfiniteQuery({
    queryKey: key(tenantId, "summaries"), initialPageParam: "",
    queryFn: ({ pageParam }) => api.get<{ data: SummaryRow[]; nextCursor: string | null }>(`/summaries${pageParam ? `?cursor=${pageParam}` : ""}`),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const configured = status.data?.configured ?? false;
  return (
    <>
      <PageHeader title="Summaries" description="Turn meeting notes, transcripts and email threads into key points, decisions and tasks."
        actions={can(P.create) && configured ? <Button onClick={() => setAdding(true)}>New summary</Button> : undefined} />
      <div className="grid gap-4">
        {status.isError && <Alert>{errorMessage(status.error)}</Alert>}
        {status.data && !configured && (
          <Alert tone="warning">AI isn't set up yet. An admin adds an Anthropic API key under Modules → AI summaries settings. Nothing is sent to an AI service until then.</Alert>
        )}
        {status.data && configured && <Usage s={status.data} />}
        {list.isPending ? <Spinner /> : list.isError ? <Alert>{errorMessage(list.error)}</Alert> : rows.length === 0 ? (
          <EmptyState title="No summaries yet">{configured && can(P.create) ? "Paste meeting notes or upload a transcript to get a summary with action items." : null}</EmptyState>
        ) : (
          <>
            <Card className="overflow-x-auto"><Table aria-label="Summaries">
              <THead><TR><TH>Title</TH><TH>Type</TH><TH>Action items</TH><TH>By</TH><TH>When</TH></TR></THead>
              <TBody>{rows.map((r) => (
                <TR key={r.id} className="cursor-pointer" onClick={() => navigate(`${ROOT}/${r.id}`)}>
                  <TD className="font-medium">{r.title}{r.status === "refused" && <Badge tone="warning" className="ml-2">Not summarized</Badge>}</TD>
                  <TD className="text-muted">{KIND_LABEL[r.kind]}</TD>
                  <TD className="tabular-nums text-muted">{r.result ? r.result.actionItems.length : "—"}{r.tasksCreated > 0 && ` (${r.tasksCreated} as tasks)`}</TD>
                  <TD className="text-muted">{r.createdByName ?? "Automation"}</TD>
                  <TD className="whitespace-nowrap text-muted">{fmtWhen(r.createdAt)}</TD>
                </TR>
              ))}</TBody>
            </Table></Card>
            {list.hasNextPage && <div className="flex justify-center"><Button variant="outline" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Load more</Button></div>}
          </>
        )}
      </div>
      {adding && <NewSummaryDialog {...props} onClose={() => setAdding(false)} />}
    </>
  );
}

function NewSummaryDialog({ api, tenantId, navigate, errorMessage, onClose }: SlotProps & { onClose(): void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>("meeting"), [title, setTitle] = useState(""), [text, setText] = useState(""), [fileObj, setFile] = useState<File | null>(null);
  const m = useMutation({
    mutationFn: () => {
      if (fileObj) return api.upload<Summary>(`/summaries/upload?kind=${kind}${title.trim() ? `&title=${encodeURIComponent(title.trim())}` : ""}`, fileObj, fileObj.name);
      return api.post<Summary>("/summaries", { kind, text, ...(title.trim() ? { title: title.trim() } : {}) });
    },
    onSuccess: (s) => { void qc.invalidateQueries({ queryKey: key(tenantId) }); onClose(); navigate(`${ROOT}/${s.id}`); },
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !m.isPending) onClose(); }} title="New summary"
      description="The text is sent to Claude once, when you click Summarize."
      footer={<><Button variant="ghost" disabled={m.isPending} onClick={onClose}>Cancel</Button>
        <Button type="submit" form="ai-new" disabled={m.isPending || (!fileObj && text.trim().length < 20)}>{m.isPending ? "Summarizing…" : "Summarize"}</Button></>}>
      <form id="ai-new" className="grid gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        {m.error && <Alert>{errorMessage(m.error)}</Alert>}
        <Field label="What is it?">{(a) => <Select {...a} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
        <Field label="Title (optional)">{(a) => <Input {...a} maxLength={200} placeholder="e.g. Weekly ops sync" value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        {fileObj ? (
          <div className="flex items-center gap-2 text-sm"><span className="truncate">{fileObj.name}</span><Button type="button" size="sm" variant="ghost" onClick={() => setFile(null)}>Remove file</Button></div>
        ) : (
          <>
            <Field label="Paste the text">{(a) => <Textarea {...a} rows={10} maxLength={200000} placeholder="Meeting notes, a call transcript, or an email thread" value={text} onChange={(e) => setText(e.target.value)} />}</Field>
            <Field label="Or upload a file (.txt, .md, .vtt, .srt, .eml)">{(a) => <Input {...a} type="file" accept=".txt,.md,.vtt,.srt,.eml,.csv,text/plain" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}</Field>
          </>
        )}
      </form>
    </Dialog>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <section className="grid gap-1.5"><h2 className="font-semibold">{title}</h2><ul className="list-disc space-y-1 pl-5 text-sm">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></section>;
}

function SummaryPage({ api, tenantId, can, navigate, errorMessage, id }: SlotProps & { id: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: key(tenantId, "summary", id), queryFn: () => api.get<Summary>(`/summaries/${id}`) });
  const [sel, setSel] = useState<Set<number>>(new Set()), [showSource, setShowSource] = useState(false), [made, setMade] = useState<number | null>(null);
  const tasks = useMutation({
    mutationFn: () => api.post<{ created: { id: string; title: string }[] }>(`/summaries/${id}/tasks`, { items: [...sel] }),
    onSuccess: (r) => { setMade(r.created.length); setSel(new Set()); void qc.invalidateQueries({ queryKey: key(tenantId) }); },
  });
  const del = useMutation({ mutationFn: () => api.del(`/summaries/${id}`), onSuccess: () => { void qc.invalidateQueries({ queryKey: key(tenantId) }); navigate(ROOT); } });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert>{errorMessage(q.error)}</Alert>;
  const s = q.data, r = s.result;
  const toggle = (i: number) => setSel((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  return (
    <>
      <PageHeader title={s.title} description={`${KIND_LABEL[s.kind]} · ${s.createdByName ?? "Automation"} · ${fmtWhen(s.createdAt)}`}
        actions={<div className="flex gap-2"><Button variant="ghost" onClick={() => navigate(ROOT)}>All summaries</Button>
          {(s.mine || can("ai:summaries.manage")) && <Button variant="danger" disabled={del.isPending} onClick={() => del.mutate()}>Delete</Button>}</div>} />
      <div className="grid gap-4">
        {del.error && <Alert>{errorMessage(del.error)}</Alert>}
        {!r ? <Alert tone="warning">Claude declined to summarize this text, so there's no summary. Nothing else happened.</Alert> : (
          <>
            <Card><CardContent className="grid gap-4 pt-5">
              <p className="text-base">{r.tldr}</p>
              <Section title="Key points" items={r.keyPoints} />
              <Section title="Decisions" items={r.decisions} />
              <Section title="Open questions" items={r.openQuestions} />
            </CardContent></Card>
            <Card>
              <CardHeader><CardTitle>Action items</CardTitle></CardHeader>
              <CardContent className="grid gap-3">
                {r.actionItems.length === 0 ? <p className="text-sm text-muted">No action items found.</p> : (
                  <>
                    {made !== null && <Alert tone="success">{made === 1 ? "1 task created" : `${made} tasks created`}. They are listed under Open tasks on Home.</Alert>}
                    {tasks.error && <Alert>{errorMessage(tasks.error)}</Alert>}
                    <ul className="grid gap-2" aria-label="Action items">{r.actionItems.map((a, i) => (
                      <li key={i}><label className="flex items-start gap-2 text-sm">
                        {can(P.create) && <input type="checkbox" className="mt-1" checked={sel.has(i)} onChange={() => toggle(i)} aria-label={`Select: ${a.task}`} />}
                        <span><span className="font-medium">{a.task}</span>
                          {(a.owner || a.due) && <span className="text-muted"> · {[a.owner, a.due && `due ${a.due}`].filter(Boolean).join(" · ")}</span>}</span>
                      </label></li>
                    ))}</ul>
                    {can(P.create) && <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setSel(new Set(r.actionItems.map((_, i) => i)))}>Select all</Button>
                      <Button size="sm" disabled={!sel.size || tasks.isPending} onClick={() => tasks.mutate()}>{sel.size > 1 ? `Create ${sel.size} tasks` : "Create task"}</Button>
                    </div>}
                  </>
                )}
              </CardContent>
            </Card>
          </>
        )}
        <p className="text-xs text-muted">{s.model} · {fmtNum(s.inputTokens + s.outputTokens)} tokens · {fmtNum(s.sourceChars)} characters of text. AI can make mistakes, so check anything important.</p>
        {s.sourceText && (
          <div className="grid gap-2">
            <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setShowSource((v) => !v)}>{showSource ? "Hide original text" : "Show original text"}</Button>
            {showSource && <Card><CardContent className="pt-5"><pre className="max-h-96 overflow-auto whitespace-pre-wrap text-sm">{s.sourceText}</pre></CardContent></Card>}
          </div>
        )}
      </div>
    </>
  );
}
