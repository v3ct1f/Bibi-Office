import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, MessagesSquare, MoreVertical, Pencil, Plus, Search, Trash2, Users, X } from "lucide-react";
import {
  Button, ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState, ErrorState, Input,
  Skeleton, Textarea, cn, toast,
} from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import { ContactCard, EventCard, FileView, GifView, PollCard, StickerView } from "./bubbles.tsx";
import { Composer, type Outgoing } from "./composer.tsx";
import { MembersDialog, NewChatDialog, RenameDialog } from "./dialogs.tsx";
import {
  Avatar, errorMessage, fmtDay, fmtTime, fmtWhen, refreshBadges, uploadFile, usePoll,
  type Conversation, type Message, type MessagePage,
} from "./shared.tsx";

// ── Conversation list (left column) ──────────────────────────────────────────
function ConversationList({ items, selected, onOpen, onNew }: { items: Conversation[]; selected: string | undefined; onOpen: (c: Conversation) => void; onNew: () => void }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? items.filter((c) => c.name.toLowerCase().includes(n) || c.members.some((m) => m.name.toLowerCase().includes(n))) : items;
  }, [items, q]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid gap-2 border-b p-3">
        <Button onClick={onNew} className="w-full justify-start"><Plus /> New chat</Button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input aria-label="Search chats" className="pl-8" placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1.5" aria-label="Chats">
        {!shown.length && <li className="p-4 text-center text-sm text-muted-foreground">{items.length ? "No chats match." : "No chats yet."}</li>}
        {shown.map((c) => {
          const unread = c.unread > 0;
          const lm = c.lastMessage;
          const who = lm && lm.kind !== "system" ? (lm.mine ? "You: " : c.kind === "group" ? `${lm.senderName.split(" ")[0]}: ` : "") : "";
          return (
            <li key={c.id}>
              <button type="button" onClick={() => onOpen(c)} aria-current={c.id === selected ? "true" : undefined}
                className={cn("flex w-full cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors",
                  c.id === selected ? "bg-primary/10" : "hover:bg-accent")}>
                <Avatar name={c.name} id={c.members.find((m) => !m.me)?.userId ?? c.id} group={c.kind === "group"} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className={cn("min-w-0 flex-1 truncate text-sm", unread ? "font-semibold" : "font-medium")}>{c.name}</span>
                    <span className={cn("shrink-0 text-[11px]", unread ? "font-semibold text-primary" : "text-muted-foreground")}>{fmtWhen(c.lastMessageAt)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={cn("min-w-0 flex-1 truncate text-xs", unread ? "text-foreground" : "text-muted-foreground")}>{lm ? `${who}${lm.preview}` : "Say hello"}</span>
                    {unread && <span className="shrink-0 rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground" aria-label={`${c.unread} unread`}>{c.unread > 99 ? "99+" : c.unread}</span>}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── One message ──────────────────────────────────────────────────────────────
function MessageRow({ m, showName, group, onEdit, onDelete, onChange }: {
  m: Message; showName: boolean; group: boolean; onEdit: (m: Message, body: string) => Promise<void>; onDelete: (m: Message) => void; onChange: (m: Message) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.body);
  const [busy, setBusy] = useState(false);
  if (m.kind === "system") return <li className="py-2 text-center text-xs text-muted-foreground">{m.body} · {fmtTime(m.createdAt)}</li>;

  const save = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try { await onEdit(m, text.trim()); setEditing(false); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const deleted = !!m.deletedAt;
  return (
    <li className={cn("group flex items-end gap-2", m.mine ? "flex-row-reverse" : "", showName ? "mt-3" : "mt-0.5")} data-testid="message">
      {!m.mine && (showName ? <Avatar name={m.senderName} id={m.senderId ?? m.id} size="sm" /> : <span className="w-7 shrink-0" />)}
      <div className={cn("flex min-w-0 max-w-[min(36rem,80%)] flex-col gap-1", m.mine ? "items-end" : "items-start")}>
        {showName && (
          <span className="px-1 text-xs text-muted-foreground">
            {!m.mine && group && <span className="mr-1.5 font-medium text-foreground">{m.senderName}</span>}{fmtTime(m.createdAt)}
          </span>
        )}
        {editing ? (
          <div className="grid w-80 max-w-full gap-2">
            <Textarea aria-label="Edit message" value={text} onChange={(e) => setText(e.target.value)} rows={3} autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void save(); } if (e.key === "Escape") setEditing(false); }} />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setText(m.body); }}>Cancel</Button>
              <Button size="sm" loading={busy} onClick={() => void save()}>Save</Button>
            </div>
          </div>
        ) : deleted ? (
          <p className="rounded-2xl border border-dashed px-3 py-1.5 text-sm italic text-muted-foreground">This message was deleted</p>
        ) : (
          <>
            {m.kind === "poll" ? <PollCard m={m} onChange={onChange} />
              : m.kind === "event" ? <EventCard m={m} onChange={onChange} />
              : m.kind === "contact" ? <ContactCard m={m} />
              : m.kind === "sticker" ? <StickerView m={m} />
              : m.kind === "gif" ? <GifView m={m} />
              : m.file ? <FileView m={m} /> : null}
            {m.kind === "text" && m.body && (
              <p className={cn("whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-sm",
                m.mine ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted text-foreground")}>
                {m.body}
              </p>
            )}
            {m.editedAt && <span className="px-1 text-[11px] text-muted-foreground">Edited</span>}
          </>
        )}
      </div>
      {m.mine && !deleted && !editing && (
        <span className="flex shrink-0 gap-0.5 self-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {m.kind === "text" && m.body && !(m.data as { voice?: boolean } | null)?.voice && <Button variant="ghost" size="icon" className="size-7" aria-label="Edit message" onClick={() => { setText(m.body); setEditing(true); }}><Pencil className="size-3.5" /></Button>}
          <Button variant="ghost" size="icon" className="size-7" aria-label="Delete message" onClick={() => onDelete(m)}><Trash2 className="size-3.5" /></Button>
        </span>
      )}
    </li>
  );
}

// ── Open conversation (right column) ─────────────────────────────────────────
function ConversationView({ id, onBack, onChanged, onLeft }: { id: string; onBack: () => void; onChanged: () => void; onLeft: () => void }) {
  const host = useModuleHost();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [msgs, setMsgs] = useState<Message[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [dialog, setDialog] = useState<"rename" | "members" | null>(null);
  const [toDelete, setToDelete] = useState<Message | null>(null);
  const since = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const loadingOlder = useRef(false);

  const markRead = useCallback(async () => {
    try { await host.api.post(`/conversations/${id}/read`); refreshBadges(); onChanged(); } catch { /* not important */ }
  }, [host, id, onChanged]);

  const loadConv = useCallback(() => host.api.get<Conversation>(`/conversations/${id}`).then(setConv), [host, id]);

  useEffect(() => {
    let alive = true;
    setConv(null); setMsgs(null); setError(null); stick.current = true;
    Promise.all([host.api.get<Conversation>(`/conversations/${id}`), host.api.get<MessagePage>(`/conversations/${id}/messages`, { limit: 50 })])
      .then(([c, p]) => {
        if (!alive) return;
        setConv(c); setMsgs(p.data); setHasMore(p.hasMore); since.current = p.now;
        if (c.unread) void markRead();
      })
      .catch((e) => { if (alive) setError(e); });
    return () => { alive = false; };
  }, [host, id, markRead]);

  const merge = useCallback((p: MessagePage) => {
    since.current = p.now;
    if (!p.data.length && !p.changed.length) return;
    setMsgs((cur) => {
      if (!cur) return cur;
      const changed = new Map(p.changed.map((m) => [m.id, m]));
      const known = new Set(cur.map((m) => m.id));
      return [...cur.map((m) => changed.get(m.id) ?? m), ...p.data.filter((m) => !known.has(m.id))];
    });
    if (p.data.some((m) => m.kind === "system")) void loadConv().catch(() => {});
    if (p.data.some((m) => !m.mine)) void markRead();
  }, [loadConv, markRead]);

  // Check for new, edited and deleted messages every 3 seconds.
  usePoll(() => {
    if (!msgs || error) return;
    const last = msgs.at(-1);
    void host.api.get<MessagePage>(`/conversations/${id}/messages`, { ...(last ? { after: last.id } : {}), ...(since.current ? { since: since.current } : {}), limit: 200 })
      .then(merge).catch(() => {});
  }, 3000, [id, msgs, error]);

  // Keep the view at the bottom when new messages arrive (unless the person scrolled up to read).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current && !loadingOlder.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);
  const onScroll = () => {
    const el = scroller.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const older = async () => {
    const first = msgs?.[0];
    const el = scroller.current;
    if (!first || !el) return;
    loadingOlder.current = true;
    const before = el.scrollHeight;
    try {
      const p = await host.api.get<MessagePage>(`/conversations/${id}/messages`, { before: first.id, limit: 50 });
      setMsgs((cur) => [...p.data, ...(cur ?? [])]); setHasMore(p.hasMore);
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - before; loadingOlder.current = false; });
    } catch (e) { loadingOlder.current = false; toast.error(errorMessage(e)); }
  };

  const replace = useCallback((r: Message) => setMsgs((cur) => cur?.map((x) => (x.id === r.id ? r : x)) ?? cur), []);
  const upload = (file: Blob, name: string, contentType: string, onProgress: (s: number) => void) => uploadFile(host.api, id, file, name, contentType, onProgress);
  const send = async (payload: Outgoing) => {
    const m = await host.api.post<Message>(`/conversations/${id}/messages`, payload);
    stick.current = true;
    setMsgs((cur) => (cur && !cur.some((x) => x.id === m.id) ? [...cur, m] : cur));
    onChanged();
  };
  const edit = async (m: Message, body: string) => {
    const r = await host.api.patch<Message>(`/messages/${m.id}`, { body });
    setMsgs((cur) => cur?.map((x) => (x.id === r.id ? r : x)) ?? cur);
  };
  const del = async () => {
    if (!toDelete) return;
    try {
      await host.api.del(`/messages/${toDelete.id}`);
      setMsgs((cur) => cur?.map((x) => (x.id === toDelete.id ? { ...x, body: "", file: null, data: null, deletedAt: new Date().toISOString() } : x)) ?? cur);
      onChanged();
    } catch (e) { toast.error(errorMessage(e)); throw e; }
  };

  if (error) return <div className="grid h-full place-items-center p-6"><ErrorState error={error} onRetry={() => { setError(null); onBack(); }} /></div>;
  if (!conv || !msgs) return <div className="grid gap-3 p-4"><Skeleton className="h-10 w-56" /><Skeleton className="h-16 w-2/3" /><Skeleton className="ml-auto h-12 w-1/2" /></div>;

  const group = conv.kind === "group";
  const other = conv.members.find((m) => !m.me);
  const subtitle = group ? conv.members.map((m) => (m.me ? "You" : m.name.split(" ")[0])).join(", ") : other?.active === false ? "No longer in the business" : other?.email ?? "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b px-3 py-2.5">
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Back to chats" onClick={onBack}><ArrowLeft /></Button>
        <Avatar name={conv.name} id={other?.userId ?? conv.id} group={group} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{conv.name}</h2>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {group && (
          <>
            <Button variant="ghost" size="sm" onClick={() => setDialog("members")}><Users /> {conv.members.length}</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Group options"><MoreVertical /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setDialog("rename")}><Pencil /> Rename group</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog("members")}><Users /> People</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={() => setDialog("members")}><X /> Leave group</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </header>
      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-2" aria-live="polite">
        {hasMore && <div className="py-2 text-center"><Button variant="outline" size="sm" onClick={() => void older()}>Show earlier messages</Button></div>}
        {!msgs.length && (
          <div className="grid h-full place-items-center text-center text-sm text-muted-foreground">
            <div className="grid justify-items-center gap-2"><Avatar name={conv.name} id={other?.userId ?? conv.id} group={group} /><p>This is the start of your chat with {conv.name}.</p></div>
          </div>
        )}
        <ol aria-label="Messages" className="pb-2">
          {msgs.map((m, i) => {
            const prev = msgs[i - 1];
            const newDay = !prev || fmtDay(prev.createdAt) !== fmtDay(m.createdAt);
            const showName = newDay || !prev || prev.kind === "system" || prev.senderId !== m.senderId
              || new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 5 * 60_000;
            return (
              <Fragment key={m.id}>
                {newDay && <li className="sticky top-0 z-10 my-2 flex justify-center"><span className="rounded-full border bg-surface px-3 py-0.5 text-xs text-muted-foreground shadow-xs">{fmtDay(m.createdAt)}</span></li>}
                <MessageRow m={m} showName={showName} group={group} onEdit={edit} onDelete={setToDelete} onChange={replace} />
              </Fragment>
            );
          })}
        </ol>
      </div>
      {!group && other?.active === false
        ? <p className="border-t p-4 text-center text-sm text-muted-foreground">{other.name} is no longer part of this business, so you can't send new messages.</p>
        : <Composer name={conv.name} send={send} upload={upload} />}
      <RenameDialog conv={conv} open={dialog === "rename"} onOpenChange={(o) => setDialog(o ? "rename" : null)} onDone={(c) => { setConv(c); onChanged(); }} />
      <MembersDialog conv={conv} open={dialog === "members"} onOpenChange={(o) => setDialog(o ? "members" : null)}
        onChanged={(c) => { setConv(c); onChanged(); }} onLeft={onLeft} />
      <ConfirmDialog open={!!toDelete} onOpenChange={(o) => { if (!o) setToDelete(null); }} title="Delete this message?"
        description="It will be removed for everyone in the chat." confirmLabel="Delete" destructive onConfirm={del} />
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export function Chat({ params, path }: PageProps) {
  const host = useModuleHost();
  const selected = params.id;
  const [items, setItems] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [newOpen, setNewOpen] = useState(path === "/chat/new");
  useEffect(() => { if (path === "/chat/new") setNewOpen(true); }, [path]);

  const load = useCallback(() => host.api.get<Conversation[]>("/conversations").then((r) => { setItems(r); setError(null); }).catch(setError), [host]);
  useEffect(() => { void load(); }, [load]);
  usePoll(() => void load(), 5000, [load]);

  const refresh = useCallback(() => void load(), [load]);
  const open = (c: Conversation) => host.navigate(`/chat/${c.id}`);
  const onCreated = (c: Conversation) => { setItems((cur) => (cur && !cur.some((x) => x.id === c.id) ? [c, ...cur] : cur)); open(c); void load(); };

  return (
    <div className="-my-2 flex h-[calc(100dvh-7.5rem)] min-h-[28rem] overflow-hidden rounded-lg border bg-surface shadow-xs lg:h-[calc(100dvh-8.5rem)]">
      <aside className={cn("w-full shrink-0 border-r md:w-80", selected ? "hidden md:block" : "block")}>
        {error && !items ? <div className="p-4"><ErrorState error={error} onRetry={() => void load()} /></div>
          : !items ? <div className="grid gap-2 p-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          : <ConversationList items={items} selected={selected} onOpen={open} onNew={() => setNewOpen(true)} />}
      </aside>
      <section className={cn("min-w-0 flex-1", selected ? "block" : "hidden md:block")}>
        {selected
          ? <ConversationView key={selected} id={selected} onBack={() => host.navigate("/chat")} onChanged={refresh} onLeft={() => { host.navigate("/chat"); void load(); }} />
          : (
            <div className="grid h-full place-items-center p-6">
              <EmptyState icon={<MessagesSquare />} title={items?.length ? "Pick a chat" : "Chat with your colleagues"}
                description="Message one person, or start a group and give it a name. Only the people in a chat can read it."
                action={<Button onClick={() => setNewOpen(true)}><Plus /> New chat</Button>} />
            </div>
          )}
      </section>
      <NewChatDialog open={newOpen} onOpenChange={(o) => { setNewOpen(o); if (!o && path === "/chat/new") host.navigate("/chat"); }} onCreated={onCreated} />
    </div>
  );
}
