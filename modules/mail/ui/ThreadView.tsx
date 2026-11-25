import { useState } from "react";
import { Forward, Paperclip, Reply, ReplyAll, Star, UserPlus, Users } from "lucide-react";
import { Badge, Button, cn, toast } from "@office/ui";
import { useModuleHost } from "@office/ui/module-ui";
import { MailBody } from "./MailBody.tsx";
import { tt } from "./i18n.ts";
import { Avatar, DOT, displayName, errorMessage, fmtFull, fmtListDate, fmtSize, saveFile, type Addr, type AttachmentInfo, type MailMessage, type Thread } from "./shared.tsx";

const names = (l: Addr[]) => l.map((a) => displayName(a)).join(", ");

function Attachment({ a }: { a: AttachmentInfo }) {
  const host = useModuleHost();
  const [busy, setBusy] = useState(false);
  const get = async () => {
    setBusy(true);
    try {
      const f = await host.api.get<{ name: string; data: string }>(`/attachments/${a.id}`);
      saveFile(f.name, f.data);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <button type="button" onClick={() => void get()} disabled={busy} title={a.risky ? tt("risky") : tt("download")} data-testid="attachment"
      className={cn("flex max-w-64 cursor-pointer items-center gap-2 rounded-md border bg-surface px-2.5 py-1.5 text-left text-xs hover:bg-accent", a.risky && "border-destructive/50")}>
      <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{a.name}</span>
      <span className="shrink-0 text-muted-foreground">{fmtSize(a.sizeBytes)}</span>
    </button>
  );
}

function MessageCard({ m, open, onToggle, leadsOn, onReply, onStar, onChanged }: {
  m: MailMessage; open: boolean; onToggle: () => void; leadsOn: boolean;
  onReply: (m: MailMessage, mode: "reply" | "all" | "forward") => void; onStar: (m: MailMessage) => void; onChanged: () => void;
}) {
  const host = useModuleHost();
  const canContacts = host.can("core:contacts.write");
  const act = async (path: string, ok: (r: Record<string, unknown>) => string) => {
    try { const r = await host.api.post<Record<string, unknown>>(path, {}); toast.success(ok(r)); onChanged(); } catch (e) { toast.error(errorMessage(e)); }
  };
  const who = m.mine ? tt("me") : displayName(m.from);
  return (
    <li className="min-w-0 rounded-lg border bg-surface" data-testid="message-card">
      <div className="flex cursor-pointer items-start gap-3 p-3" onClick={onToggle} role="button" tabIndex={0} aria-expanded={open}
        onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onToggle(); }}>
        <Avatar name={m.from.name} email={m.from.email} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className={cn("text-sm", m.isRead ? "font-medium" : "font-semibold")}>{who}</span>
            {open && m.from.email && <span className="text-xs text-muted-foreground">&lt;{m.from.email}&gt;</span>}
            {m.contact && <Badge variant="success" title={tt("inContacts")}>{m.contact.name}</Badge>}
            <span className="ml-auto shrink-0 text-xs text-muted-foreground" title={fmtFull(m.date)}>{open ? fmtFull(m.date) : fmtListDate(m.date)}</span>
          </div>
          {open ? (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {tt("to")}: {names(m.to) || "—"}{m.cc.length > 0 && <> · {tt("cc")}: {names(m.cc)}</>}{m.bcc.length > 0 && <> · {tt("bcc")}: {names(m.bcc)}</>}
            </div>
          ) : <div className="truncate text-xs text-muted-foreground">{m.snippet}</div>}
        </div>
        <Button variant="ghost" size="icon" className="size-7" aria-label={m.isStarred ? tt("unstar") : tt("star")} aria-pressed={m.isStarred}
          onClick={(e) => { e.stopPropagation(); onStar(m); }}>
          <Star className={cn("size-4", m.isStarred && "fill-yellow-400 text-yellow-500")} />
        </Button>
      </div>
      {open && (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 border-t px-4 pb-4 pt-3">
          {!m.mine && (m.from.email) && (canContacts || leadsOn) && !m.contact && (
            <div className="flex flex-wrap gap-2">
              {canContacts && <Button size="sm" variant="outline" onClick={() => void act(`/messages/${m.id}/add-contact`, (r) => tt("contactAdded", { name: String(r.name) }))}><Users /> {tt("addContact")}</Button>}
              {leadsOn && <Button size="sm" variant="outline" onClick={() => void act(`/messages/${m.id}/add-lead`, () => tt("leadRequested", { name: displayName(m.from) }))}><UserPlus /> {tt("addLead")}</Button>}
            </div>
          )}
          {!m.mine && m.contact && leadsOn && (
            <div><Button size="sm" variant="ghost" onClick={() => void act(`/messages/${m.id}/add-lead`, () => tt("leadRequested", { name: m.contact!.name }))}><UserPlus /> {tt("addLead")}</Button></div>
          )}
          <MailBody m={m} />
          {m.attachments.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Attachments">
              {m.attachments.map((a) => <li key={a.id}><Attachment a={a} /></li>)}
            </ul>
          )}
          {!m.isDraft && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => onReply(m, "reply")}><Reply /> {tt("reply")}</Button>
              {(m.to.length + m.cc.length > 1) && <Button size="sm" variant="outline" onClick={() => onReply(m, "all")}><ReplyAll /> {tt("replyAll")}</Button>}
              <Button size="sm" variant="outline" onClick={() => onReply(m, "forward")}><Forward /> {tt("forward")}</Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function ThreadView({ thread, leadsOn, onReply, onStar, onChanged, onLabelRemove }: {
  thread: Thread; leadsOn: boolean; onReply: (m: MailMessage, mode: "reply" | "all" | "forward") => void;
  onStar: (m: MailMessage) => void; onChanged: () => void; onLabelRemove: (labelId: string) => void;
}) {
  // The newest message is open; older ones fold up (click to open them).
  const last = thread.messages.at(-1)?.id;
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const labels = [...new Map(thread.messages.flatMap((m) => m.labels).map((l) => [l.id, l])).values()];
  const toggle = (id: string) => setOpened((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const reply = [...thread.messages].reverse().find((m) => !m.isDraft);
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 p-4" data-testid="thread-view">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold" data-testid="thread-subject">{thread.subject}</h2>
        {labels.map((l) => (
          <span key={l.id} className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs">
            <span className={cn("size-2 rounded-full", DOT[l.color] ?? DOT.gray)} />{l.name}
            <button type="button" aria-label={`Remove label ${l.name}`} className="cursor-pointer text-muted-foreground hover:text-foreground" onClick={() => onLabelRemove(l.id)}>×</button>
          </span>
        ))}
      </div>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {thread.messages.map((m) => (
          <MessageCard key={m.id} m={m} open={m.id === last || opened.has(m.id)} onToggle={() => toggle(m.id)} leadsOn={leadsOn} onReply={onReply} onStar={onStar} onChanged={onChanged} />
        ))}
      </ul>
      {reply && (
        <div className="flex gap-2 pt-1">
          <Button variant="outline" onClick={() => onReply(reply, "reply")}><Reply /> {tt("reply")}</Button>
          <Button variant="outline" onClick={() => onReply(reply, "forward")}><Forward /> {tt("forward")}</Button>
        </div>
      )}
    </div>
  );
}
