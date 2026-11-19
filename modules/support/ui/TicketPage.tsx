import { useState } from "react";
import { AlertTriangle, ArrowLeft, Download, Lock, Mail, RotateCw, Send, StickyNote, Trash2, User } from "lucide-react";
import { Button, Card, ConfirmDialog, ErrorState, Field, Input, Select, Skeleton, Textarea, toast } from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import {
  OverdueBadge, PRIORITIES, PRIORITY, PriorityBadge, STATUS, StatusBadge, errorMessage, fmtDateTime, fmtRelative, fmtSize, requesterLabel, useInterval, useLoad,
  type Attachment, type Config, type Macro, type Message, type Priority, type Status, type TicketDetail,
} from "./shared.tsx";

export function TicketPage({ params }: PageProps) {
  const host = useModuleHost();
  const id = params.id!;
  const cfg = useLoad(() => host.api.get<Config>("/config"), [host]);
  const t = useLoad(() => host.api.get<TicketDetail>(`/tickets/${id}`), [host, id]);
  const [deleting, setDeleting] = useState(false);
  useInterval(() => { void t.reload(); }, 30_000);

  if (t.error) {
    return (<><Back /><Card><ErrorState title="Can't open this ticket" error={t.error} onRetry={() => void t.reload()} /></Card></>);
  }
  if (!t.data || !cfg.data) return (<><Back /><Skeleton className="h-96" /></>);
  const d = t.data, c = cfg.data;

  async function patch(body: Record<string, unknown>, done?: string) {
    try {
      await host.api.patch(`/tickets/${id}`, body);
      if (done) toast.success(done);
      await t.reload();
    } catch (e) { toast.error(errorMessage(e)); }
  }

  return (
    <>
      <Back />
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight"><span className="mr-2 text-muted-foreground tabular-nums">{d.ref}</span>{d.subject}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusBadge status={d.status} /><PriorityBadge priority={d.priority} /><OverdueBadge t={d} />
            <span>{requesterLabel(d)}{d.channel === "manual" ? " · logged by phone/in person" : ""} · opened {fmtRelative(d.createdAt)}</span>
          </div>
        </div>
        {c.canReply && d.status !== "solved" && <Button variant="outline" onClick={() => void patch({ status: "solved" }, `${d.ref} solved`)}>Mark solved</Button>}
        {c.canReply && d.status === "solved" && <Button variant="outline" onClick={() => void patch({ status: "open" }, `${d.ref} reopened`)}>Reopen</Button>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <div className="grid min-w-0 content-start gap-3">
          <ol aria-label="Conversation" className="grid gap-3">
            {d.messages.map((m) => <MessageCard key={m.id} m={m} ticketId={id} canReply={c.canReply} onChange={() => void t.reload()} />)}
          </ol>
          {c.canReply && <Composer ticket={d} cfg={c} onSent={() => void t.reload()} />}
        </div>

        <aside className="grid content-start gap-4">
          <Card className="grid gap-3 p-4">
            <Field label="Status">{(a) => (
              <Select {...a} disabled={!c.canReply} value={d.status} onChange={(e) => void patch({ status: e.target.value })}>
                {(Object.keys(STATUS) as Status[]).map((s) => <option key={s} value={s}>{STATUS[s][0]} — {STATUS[s][2]}</option>)}
              </Select>
            )}</Field>
            <Field label="Priority">{(a) => (
              <Select {...a} disabled={!c.canReply} value={d.priority} onChange={(e) => void patch({ priority: e.target.value as Priority })}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY[p][0]}</option>)}
              </Select>
            )}</Field>
            <Field label="Assigned to">{(a) => (
              <Select {...a} disabled={!c.canReply} value={d.assigneeId ?? ""} onChange={(e) => void patch({ assigneeId: e.target.value || null }, e.target.value ? "Assigned" : "Unassigned")}>
                <option value="">Nobody</option>
                {c.people.map((p) => <option key={p.userId} value={p.userId}>{p.name}{p.userId === c.me ? " (me)" : ""}</option>)}
              </Select>
            )}</Field>
            {c.canReply && c.me && d.assigneeId !== c.me && <Button size="sm" variant="outline" onClick={() => void patch({ assigneeId: c.me }, "Assigned to you")}>Assign to me</Button>}
          </Card>

          <Card className="grid gap-2 p-4 text-sm" role="group" aria-label="Response targets">
            <p className="font-semibold">Response targets</p>
            <Due label="First reply" due={d.firstResponseDue} doneAt={d.firstResponseAt} late={d.overdue.firstResponse} />
            <Due label="Solved" due={d.resolutionDue} doneAt={d.solvedAt} late={d.overdue.resolution} />
          </Card>

          <Card className="grid gap-2 p-4 text-sm" role="group" aria-label="Customer">
            <p className="font-semibold">Customer</p>
            <p className="flex items-center gap-2"><User className="size-4 text-muted-foreground" />{d.contact?.name || d.requesterName || "—"}</p>
            {d.requesterEmail && <p className="flex items-center gap-2 break-all"><Mail className="size-4 shrink-0 text-muted-foreground" />{d.requesterEmail}</p>}
            {d.contact?.phone && <p className="text-muted-foreground">{d.contact.phone}</p>}
            {d.contact && <a className="text-primary hover:underline" href={`/t/${host.tenant.slug}/contacts/${d.contact.id}`}>Open contact</a>}
            {d.otherTickets.length > 0 && (
              <div className="mt-2 border-t pt-2">
                <p className="mb-1 font-medium">Other tickets</p>
                <ul className="grid gap-1">
                  {d.otherTickets.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-2">
                      <a className="truncate hover:underline" href={host.href(`/support/${o.id}`)} onClick={(e) => { e.preventDefault(); host.navigate(`/support/${o.id}`); }}>
                        <span className="text-muted-foreground">{o.ref}</span> {o.subject}
                      </a>
                      <StatusBadge status={o.status} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
          {c.canManage && <Button variant="ghost" className="justify-start text-destructive" onClick={() => setDeleting(true)}><Trash2 /> Delete ticket</Button>}
        </aside>
      </div>
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} destructive confirmLabel="Delete ticket" title={`Delete ${d.ref}?`}
        description="The ticket, its messages, notes and attachments are removed for good. Emails already sent stay in the customer's mailbox."
        onConfirm={async () => { await host.api.del(`/tickets/${id}`); toast.success(`${d.ref} deleted`); host.navigate("/support"); }} />
    </>
  );
}

function Back() {
  const host = useModuleHost();
  return <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => host.navigate("/support")}><ArrowLeft /> Support</Button>;
}

function Due({ label, due, doneAt, late }: { label: string; due: string | null; doneAt: string | null; late: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={late ? "font-medium text-destructive" : undefined}>
        {doneAt ? `Done ${fmtRelative(doneAt)}` : !due ? "No target" : late ? `Overdue (${fmtRelative(due)})` : `Due ${fmtRelative(due)}`}
      </span>
    </div>
  );
}

function MessageCard({ m, ticketId, canReply, onChange }: { m: Message; ticketId: string; canReply: boolean; onChange: () => void }) {
  const host = useModuleHost();
  const [retrying, setRetrying] = useState(false);
  const who = m.kind === "inbound" ? (m.fromName || m.fromEmail || "Customer") : (m.authorName ?? "Someone");
  const style = m.kind === "note" ? "border-warning/50 bg-warning/10" : m.kind === "reply" ? "border-primary/30 bg-primary/5" : "";

  async function retry() {
    setRetrying(true);
    try {
      const r = await host.api.post<{ sent: boolean; error: string | null }>(`/tickets/${ticketId}/messages/${m.id}/retry`, {});
      if (r.sent) toast.success("Reply sent"); else toast.error(`Still not sent: ${r.error}`);
      onChange();
    } catch (e) { toast.error(errorMessage(e)); } finally { setRetrying(false); }
  }

  return (
    <li>
      <Card className={`p-4 ${style}`} data-kind={m.kind}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2 font-medium">
            {m.kind === "note" && <><Lock className="size-4" aria-hidden /> Internal note ·</>}
            {who}
            {m.kind === "inbound" && m.fromEmail && m.fromName && <span className="font-normal text-muted-foreground">&lt;{m.fromEmail}&gt;</span>}
            {m.kind === "reply" && m.to.length > 0 && <span className="font-normal text-muted-foreground">to {[...m.to, ...m.cc].join(", ")}</span>}
          </span>
          <time className="text-xs text-muted-foreground" dateTime={m.createdAt} title={fmtDateTime(m.createdAt)}>{fmtRelative(m.createdAt)}</time>
        </div>
        <div className="whitespace-pre-wrap break-words text-sm">{m.body}</div>
        {m.attachments.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Attachments">
            {m.attachments.map((a) => <li key={a.id}><AttachmentLink a={a} /></li>)}
          </ul>
        )}
        {m.sendStatus === "failed" && (
          <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <span className="flex items-center gap-2"><AlertTriangle className="size-4" /> Not sent: {m.sendError}</span>
            {canReply && <Button size="sm" variant="outline" loading={retrying} onClick={() => void retry()}><RotateCw /> Retry</Button>}
          </div>
        )}
        {m.sendStatus === "sending" && <p className="mt-2 text-xs text-muted-foreground">Sending…</p>}
      </Card>
    </li>
  );
}

function AttachmentLink({ a }: { a: Attachment }) {
  const host = useModuleHost();
  async function open() {
    try {
      const f = await host.api.get<{ name: string; contentType: string; data: string }>(`/files/${a.id}`);
      const bytes = Uint8Array.from(atob(f.data), (ch) => ch.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: f.contentType }));
      const link = document.createElement("a");
      link.href = url; link.download = f.name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) { toast.error(errorMessage(e)); }
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void open()}>
      <Download /> {a.name} <span className="text-muted-foreground">({fmtSize(a.sizeBytes)})</span>
    </Button>
  );
}

function Composer({ ticket, cfg, onSent }: { ticket: TicketDetail; cfg: Config; onSent: () => void }) {
  const host = useModuleHost();
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [body, setBody] = useState("");
  const [after, setAfter] = useState<Status>("pending");
  const [cc, setCc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const macros = useLoad(() => host.api.get<Macro[]>("/macros"), [host]);
  const byEmail = ticket.channel === "email" && !!ticket.requesterEmail;

  async function insertMacro(macroId: string) {
    if (!macroId) return;
    try {
      const r = await host.api.get<{ body: string }>(`/tickets/${ticket.id}/macros/${macroId}`);
      setBody((b) => (b.trim() ? `${b.trimEnd()}\n\n${r.body}` : r.body));
    } catch (e) { toast.error(errorMessage(e)); }
  }

  async function submit() {
    if (!body.trim()) { setError(mode === "reply" ? "Write a reply" : "Write the note"); return; }
    const ccList = cc.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    if (ccList.some((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))) { setError("Check the Cc addresses"); return; }
    setBusy(true); setError(null);
    try {
      if (mode === "note") {
        await host.api.post(`/tickets/${ticket.id}/notes`, { body });
        toast.success("Note added");
      } else {
        const r = await host.api.post<{ sent: boolean; error: string | null }>(`/tickets/${ticket.id}/reply`, { body, status: after, cc: ccList });
        if (!r.sent) toast.error(`The reply was saved but not sent: ${r.error}. Use Retry when the mailbox works again.`);
        else toast.success(byEmail ? `Reply emailed to ${ticket.requesterEmail}` : "Reply saved");
      }
      setBody(""); setCc("");
      onSent();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  const noMailbox = mode === "reply" && byEmail && !cfg.mailbox.configured;
  return (
    <Card className={`grid gap-3 p-4 ${mode === "note" ? "border-warning/50" : ""}`} role="group" aria-label="Write">
      <div role="tablist" aria-label="Reply or note" className="flex gap-1.5">
        <Button role="tab" aria-selected={mode === "reply"} size="sm" variant={mode === "reply" ? "default" : "outline"} onClick={() => setMode("reply")}><Send /> Reply</Button>
        <Button role="tab" aria-selected={mode === "note"} size="sm" variant={mode === "note" ? "default" : "outline"} onClick={() => setMode("note")}><StickyNote /> Internal note</Button>
      </div>
      {mode === "reply" && byEmail && (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
          <p className="self-center text-sm text-muted-foreground">To <span className="text-foreground">{ticket.requesterEmail}</span></p>
          <Input aria-label="Cc" placeholder="Cc (optional)" value={cc} onChange={(e) => setCc(e.target.value)} />
        </div>
      )}
      {mode === "reply" && !byEmail && <p className="text-sm text-muted-foreground">This ticket was logged by hand, so your answer is saved here but not emailed.</p>}
      {mode === "note" && <p className="text-sm text-muted-foreground">Only your team sees notes. They are never emailed.</p>}
      <Field label={mode === "reply" ? "Your reply" : "Your note"} error={error ?? undefined}>{(a) => (
        <Textarea {...a} rows={6} value={body} onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); } }} />
      )}</Field>
      {noMailbox && <p role="alert" className="text-sm text-destructive">Connect the support mailbox in Support settings to send replies.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {mode === "reply" && macros.data && macros.data.length > 0 ? (
          <Select aria-label="Insert saved reply" className="w-56" value="" onChange={(e) => void insertMacro(e.target.value)}>
            <option value="">Insert saved reply…</option>
            {macros.data.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        ) : <span />}
        <div className="flex flex-wrap items-center gap-2">
          {mode === "reply" && (
            <Select aria-label="Then set status" className="w-48" value={after} onChange={(e) => setAfter(e.target.value as Status)}>
              <option value="pending">then Pending</option>
              <option value="solved">then Solved</option>
              <option value="open">then keep Open</option>
            </Select>
          )}
          <Button loading={busy} disabled={noMailbox} onClick={() => void submit()}>
            {mode === "note" ? "Add note" : byEmail ? "Send reply" : "Save reply"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
