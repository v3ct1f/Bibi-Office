import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, CardContent, Dialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea, cn } from "@office/ui";
import type { SlotProps } from "@office/sdk/ui";
import { ago, fmtDateTime, P, PRIORITIES, PriorityBadge, ROOT, StatusBadge, who } from "./common.tsx";
import type { Counts, InboxInfo, Member, Page, Priority, Ticket, TicketDetail, TicketStatus } from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const key = (tenantId: string, ...rest: unknown[]) => ["tenant", tenantId, "support", ...rest];

/** /m/support/inbox[/<ticket id>] */
export function InboxPage(props: SlotProps) {
  const seg = (props.subPath ?? "").split("/").filter(Boolean);
  if (seg[0] && UUID.test(seg[0])) return <TicketView {...props} id={seg[0]} />;
  if (seg.length) return <EmptyState title="Page not found" />;
  return <Inbox {...props} />;
}

// ───────────────────────── inbox ─────────────────────────
type View = "open" | "mine" | "unassigned" | "pending" | "breached" | "solved" | "all";
const VIEWS: [View, string, keyof Counts | null][] = [
  ["open", "Open", "open"], ["mine", "Mine", "mine"], ["unassigned", "Unassigned", "unassigned"], ["pending", "Waiting", "pending"],
  ["breached", "Overdue", "breached"], ["solved", "Solved", null], ["all", "All", null],
];

function Inbox(props: SlotProps) {
  const { api, tenantId, can, navigate, errorMessage } = props;
  const [view, setView] = useState<View>(() => {
    try { const v = sessionStorage.getItem("support.view") as View | null; if (v && VIEWS.some((x) => x[0] === v)) return v; } catch { /* ignore */ }
    return "open";
  });
  const pick = (v: View) => { setView(v); try { sessionStorage.setItem("support.view", v); } catch { /* ignore */ } };
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 250); return () => clearTimeout(t); }, [search]);
  const [dialog, setDialog] = useState<"new" | "setup" | null>(null);
  const counts = useQuery({ queryKey: key(tenantId, "counts"), queryFn: () => api.get<Counts>("/counts"), refetchInterval: 60_000 });
  const list = useInfiniteQuery({
    queryKey: key(tenantId, "list", view, q),
    initialPageParam: "",
    queryFn: ({ pageParam }) => api.get<Page<Ticket>>(`/tickets?view=${q ? "all" : view}&limit=50${q ? `&q=${encodeURIComponent(q)}` : ""}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    refetchInterval: 60_000,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <>
      <PageHeader title="Support" description="Customer requests from email and your contact form. Reply, add notes, and close them when solved."
        actions={<div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setDialog("setup")}>Inbox address</Button>
          {can(P.work) && <Button onClick={() => setDialog("new")}>New ticket</Button>}
        </div>} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Ticket view" className="flex flex-wrap gap-1">
          {VIEWS.map(([v, label, c]) => {
            const n = c ? counts.data?.[c] : undefined;
            return (
              <Button key={v} role="tab" aria-selected={!q && view === v} size="sm" variant={!q && view === v ? "secondary" : "ghost"} onClick={() => { setSearch(""); pick(v); }}>
                {label}{n ? <span className={cn("ml-1.5 rounded px-1.5 text-xs tabular-nums", v === "breached" ? "bg-danger/15 text-danger" : "bg-surface-2")}>{n}</span> : null}
              </Button>
            );
          })}
        </div>
        <Input type="search" aria-label="Search tickets" placeholder="Search subject, email or #number" className="w-full sm:w-72" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {list.isPending ? <Spinner /> : list.isError ? <Alert>{errorMessage(list.error)}</Alert> : rows.length === 0 ? (
        <EmptyState title={q ? "No tickets match" : view === "breached" ? "Nothing overdue" : view === "mine" ? "Nothing assigned to you" : "No tickets here"}>
          {!q && view === "open" ? "New requests show up here. Use “Inbox address” to see where customers can write to you." : null}
        </EmptyState>
      ) : (
        <Card><ul className="divide-y" aria-label="Tickets">
          {rows.map((t) => (
            <li key={t.id}>
              <a href={`${ROOT}/${t.id}`} onClick={(e) => { e.preventDefault(); navigate(`${ROOT}/${t.id}`); }}
                className="grid gap-1 px-4 py-3 hover:bg-surface-2 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-4">
                <span className="grid min-w-0 gap-0.5">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0 text-xs tabular-nums text-muted">{t.reference}</span>
                    <span className={cn("truncate", t.status === "new" ? "font-semibold" : "font-medium")}>{t.subject}</span>
                  </span>
                  <span className="truncate text-sm text-muted">{who(t)} · {t.assigneeName ? `with ${t.assigneeName}` : "unassigned"} · {ago(t.lastMessageAt)}</span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                  {t.overdue && <span className="rounded bg-danger/15 px-2 py-0.5 text-xs font-medium text-danger">Overdue</span>}
                  <PriorityBadge p={t.priority} />
                  <StatusBadge s={t.status} />
                </span>
              </a>
            </li>
          ))}
        </ul></Card>
      )}
      {list.hasNextPage && <div className="mt-3"><Button variant="outline" size="sm" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Load more</Button></div>}
      {dialog === "new" && <NewTicketDialog {...props} onClose={() => setDialog(null)} />}
      {dialog === "setup" && <SetupDialog {...props} onClose={() => setDialog(null)} />}
    </>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-1">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex gap-2">
        <Input readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
        <Button variant="outline" onClick={() => { void navigator.clipboard?.writeText(value).then(() => setCopied(true)); }}>{copied ? "Copied" : "Copy"}</Button>
      </div>
    </div>
  );
}

function SetupDialog({ api, tenantId, errorMessage, onClose }: SlotProps & { onClose(): void }) {
  const q = useQuery({ queryKey: key(tenantId, "info"), queryFn: () => api.get<InboxInfo>("/meta") });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Where customers reach you" footer={<Button onClick={onClose}>Done</Button>}>
      {q.isPending ? <Spinner /> : q.isError ? <Alert>{errorMessage(q.error)}</Alert> : (
        <div className="grid gap-4 text-sm">
          {q.data.address ? (
            <>
              <CopyRow label="Inbox email address" value={q.data.address} />
              <p className="text-muted">Forward your support address (for example help@yourcompany.com) to this address. Each new email becomes a ticket; replies stay in the same ticket.</p>
            </>
          ) : <Alert tone="warning">Receiving email is not set up on this server. Ask your administrator to configure inbound mail.</Alert>}
          {q.data.formUrl ? <CopyRow label="Contact form link" value={q.data.formUrl} /> : <p className="text-muted">The public contact form is off. Turn it on in the module settings.</p>}
          <p className="text-muted">First reply targets: urgent {q.data.sla.urgent} h, high {q.data.sla.high} h, normal {q.data.sla.normal} h, low {q.data.sla.low} h.</p>
        </div>
      )}
    </Dialog>
  );
}

function NewTicketDialog({ api, tenantId, navigate, errorMessage, onClose }: SlotProps & { onClose(): void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ subject: "", requesterEmail: "", requesterName: "", body: "", priority: "normal" as Priority });
  const save = useMutation({
    mutationFn: () => api.post<TicketDetail>("/tickets", { ...f, requesterName: f.requesterName || undefined }),
    onSuccess: (t) => { void qc.invalidateQueries({ queryKey: key(tenantId) }); onClose(); navigate(`${ROOT}/${t.id}`); },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="New ticket" description="Log a request you got by phone or in person. The customer is not emailed until you reply.">
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Customer email">{(a) => <Input {...a} type="email" required value={f.requesterEmail} onChange={(e) => setF({ ...f, requesterEmail: e.target.value })} />}</Field>
          <Field label="Customer name (optional)">{(a) => <Input {...a} value={f.requesterName} onChange={(e) => setF({ ...f, requesterName: e.target.value })} />}</Field>
        </div>
        <Field label="Subject">{(a) => <Input {...a} required maxLength={300} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />}</Field>
        <Field label="What do they need?">{(a) => <Textarea {...a} required rows={4} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />}</Field>
        <Field label="Priority">{(a) => <Select {...a} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Priority })}>{PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}</Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? "Creating…" : "Create ticket"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

// ───────────────────────── one ticket ─────────────────────────
function TicketView(props: SlotProps & { id: string }) {
  const { api, tenantId, id, can, navigate, errorMessage } = props;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: key(tenantId, "ticket", id), queryFn: () => api.get<TicketDetail>(`/tickets/${id}`), refetchInterval: 30_000 });
  const done = (t: TicketDetail) => { qc.setQueryData(key(tenantId, "ticket", id), t); void qc.invalidateQueries({ queryKey: key(tenantId, "list") }); void qc.invalidateQueries({ queryKey: key(tenantId, "counts") }); };
  const patch = useMutation({ mutationFn: (b: Record<string, unknown>) => api.patch<TicketDetail>(`/tickets/${id}`, b), onSuccess: done });
  const back = <a href={ROOT} onClick={(e) => { e.preventDefault(); navigate(ROOT); }} className="text-sm text-primary hover:underline">← Support</a>;
  if (q.isPending) return <div className="grid gap-4">{back}<Spinner /></div>;
  if (q.isError) return <div className="grid gap-4">{back}<Alert>{errorMessage(q.error)}</Alert></div>;
  const t = q.data;
  return (
    <div className="grid gap-4">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight"><span className="mr-2 text-muted tabular-nums">{t.reference}</span>{t.subject}</h1>
          <p className="mt-1 text-sm text-muted">From {who(t)}{t.requesterName ? ` <${t.requesterEmail}>` : ""} · via {t.channel === "web" ? "contact form" : t.channel === "email" ? "email" : "the team"} · {fmtDateTime(t.createdAt)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {t.overdue && <span className="rounded bg-danger/15 px-2 py-0.5 text-xs font-medium text-danger">First reply overdue</span>}
          <PriorityBadge p={t.priority} /><StatusBadge s={t.status} />
        </div>
      </div>
      {patch.error && <Alert>{errorMessage(patch.error)}</Alert>}
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_18rem]">
        <div className="grid gap-3">
          <ol className="grid gap-3" aria-label="Conversation">
            {t.messages.map((m) => (
              <li key={m.id} className={cn("rounded-md border p-4", m.kind === "reply" && "border-primary/30 bg-primary/5", m.kind === "note" && "border-warning/40 bg-warning/10", m.kind === "customer" && "bg-surface")}>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">
                    {m.kind === "customer" ? (m.fromName || m.fromEmail) : m.authorName}
                    <span className="ml-2 font-normal text-muted">{m.kind === "note" ? "Internal note" : m.kind === "reply" ? "Replied" : "Customer"}</span>
                  </span>
                  <time className="text-muted" dateTime={m.createdAt}>{fmtDateTime(m.createdAt)}</time>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
              </li>
            ))}
          </ol>
          {can(P.work) && <Composer {...props} ticket={t} onDone={done} />}
        </div>
        <TicketSide {...props} ticket={t} busy={patch.isPending} onChange={(b) => patch.mutate(b)} />
      </div>
    </div>
  );
}

function Composer({ api, id, ticket: t, errorMessage, onDone }: SlotProps & { id: string; ticket: TicketDetail; onDone(t: TicketDetail): void }) {
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [body, setBody] = useState("");
  const [after, setAfter] = useState<Exclude<TicketStatus, "new">>("pending");
  const send = useMutation({
    mutationFn: () => mode === "reply" ? api.post<TicketDetail>(`/tickets/${id}/reply`, { body, status: after }) : api.post<TicketDetail>(`/tickets/${id}/notes`, { body }),
    onSuccess: (r) => { setBody(""); onDone(r); },
  });
  return (
    <Card><CardContent className="grid gap-3">
      <div role="tablist" aria-label="Message type" className="flex gap-1">
        <Button role="tab" aria-selected={mode === "reply"} size="sm" variant={mode === "reply" ? "secondary" : "ghost"} onClick={() => setMode("reply")}>Reply to customer</Button>
        <Button role="tab" aria-selected={mode === "note"} size="sm" variant={mode === "note" ? "secondary" : "ghost"} onClick={() => setMode("note")}>Internal note</Button>
      </div>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
        {send.error && <Alert>{errorMessage(send.error)}</Alert>}
        <Field label={mode === "reply" ? `Reply to ${t.requesterEmail}` : "Note for your team (the customer won't see it)"}>
          {(a) => <Textarea {...a} required rows={5} value={body} onChange={(e) => setBody(e.target.value)} className={mode === "note" ? "bg-warning/5" : ""} />}
        </Field>
        <div className="flex flex-wrap items-end justify-between gap-3">
          {mode === "reply" ? (
            <Field label="Then set status to">{(a) => (
              <Select {...a} value={after} onChange={(e) => setAfter(e.target.value as typeof after)}>
                <option value="pending">Waiting on customer</option><option value="open">Open</option><option value="solved">Solved</option>
              </Select>
            )}</Field>
          ) : <span />}
          <Button type="submit" disabled={send.isPending || !body.trim()}>{send.isPending ? "Sending…" : mode === "reply" ? "Send reply" : "Add note"}</Button>
        </div>
      </form>
    </CardContent></Card>
  );
}

function TicketSide({ api, tenantId, ticket: t, can, navigate, busy, onChange }: SlotProps & { ticket: TicketDetail; busy: boolean; onChange(b: Record<string, unknown>): void }) {
  const manage = can(P.manage), work = can(P.work);
  const members = useQuery({ queryKey: ["tenant", tenantId, "members"], enabled: manage, queryFn: () => api.core<Member[] | { data: Member[] }>("/members") });
  const me = useQuery({ queryKey: ["me"], enabled: work && !manage, queryFn: () => api.core<{ userId: string }>("/me") });
  const list = Array.isArray(members.data) ? members.data : members.data?.data ?? [];
  const myId = me.data?.userId;
  return (
    <Card><CardContent className="grid gap-3 text-sm">
      <Field label="Status">{(a) => (
        <Select {...a} disabled={!work || busy} value={t.status === "new" ? "" : t.status} onChange={(e) => onChange({ status: e.target.value })}>
          {t.status === "new" && <option value="" disabled>New</option>}
          <option value="open">Open</option><option value="pending">Waiting on customer</option><option value="solved">Solved</option>
        </Select>
      )}</Field>
      <Field label="Priority">{(a) => (
        <Select {...a} disabled={!work || busy} value={t.priority} onChange={(e) => onChange({ priority: e.target.value })}>
          {PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      )}</Field>
      <Field label="Assigned to">{(a) => manage ? (
        <Select {...a} disabled={busy} value={t.assigneeId ?? ""} onChange={(e) => onChange({ assigneeId: e.target.value || null })}>
          <option value="">Unassigned</option>
          {list.map((m) => <option key={m.userId} value={m.userId}>{m.name || m.email}</option>)}
          {t.assigneeId && !list.some((m) => m.userId === t.assigneeId) && <option value={t.assigneeId}>{t.assigneeName ?? "Former member"}</option>}
        </Select>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span id={a.id}>{t.assigneeName ?? "Unassigned"}</span>
          {work && myId && t.assigneeId !== myId && !t.assigneeId && <Button size="sm" variant="outline" disabled={busy} onClick={() => onChange({ assigneeId: myId })}>Take it</Button>}
          {work && myId && t.assigneeId === myId && <Button size="sm" variant="ghost" disabled={busy} onClick={() => onChange({ assigneeId: null })}>Release</Button>}
        </div>
      )}</Field>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 border-t pt-3">
        <dt className="text-muted">Customer</dt>
        <dd className="min-w-0 break-words">{t.contactId
          ? <a className="text-primary hover:underline" href={`/contacts/${t.contactId}`} onClick={(e) => { e.preventDefault(); navigate(`/contacts/${t.contactId}`); }}>{who(t)}</a>
          : who(t)}</dd>
        <dt className="text-muted">Email</dt><dd className="min-w-0 break-all">{t.requesterEmail}</dd>
        <dt className="text-muted">First reply</dt>
        <dd>{t.firstResponseAt ? fmtDateTime(t.firstResponseAt) : t.dueAt ? <span className={t.overdue ? "font-medium text-danger" : ""}>due {ago(t.dueAt)}</span> : "—"}</dd>
        {t.solvedAt && <><dt className="text-muted">Solved</dt><dd>{fmtDateTime(t.solvedAt)}</dd></>}
      </dl>
    </CardContent></Card>
  );
}
