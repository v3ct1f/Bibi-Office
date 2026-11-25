import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive, ArrowLeft, Ban, Check, FileText, Inbox as InboxIcon, Mail, MailOpen, MoreVertical, Paperclip, PenSquare, Plus, RefreshCw, Search, Send,
  Settings, SlidersHorizontal, Star, Tag, Trash2, X,
} from "lucide-react";
import {
  Button, Checkbox, Dialog, DialogContent, DialogFooter, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuTrigger, EmptyState, ErrorState, Field, Input, Skeleton, Textarea, cn, toast,
} from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import { Compose } from "./Compose.tsx";
import { ThreadView } from "./ThreadView.tsx";
import { tt, type MailKey } from "./i18n.ts";
import {
  DOT, errorMessage, fmtListDate, fmtSize, folderName, isTyping, LABEL_COLORS, type AccountInfo, type Folders, type MailMessage, type Thread, type ThreadItem,
} from "./shared.tsx";

type Action = "read" | "unread" | "star" | "unstar" | "archive" | "inbox" | "spam" | "trash" | "delete" | "label" | "unlabel";
type View = { kind: "folder"; key: string } | { kind: "label"; id: string } | { kind: "search" };

const FOLDER_ICON: Record<string, typeof InboxIcon> = {
  inbox: InboxIcon, starred: Star, sent: Send, drafts: FileText, spam: Ban, archive: Archive, trash: Trash2,
};
const PAGE = 30;

// ── The page ─────────────────────────────────────────────────────────────────
/** No mailbox yet: one made in Work email before Mail was on can be linked (Work email answers by event, so we look again shortly). */
function NoMailbox({ onLinked }: { onLinked: () => Promise<void> }) {
  const host = useModuleHost();
  const [asked, setAsked] = useState(false);
  const link = async () => {
    try {
      await host.api.post("/account/link", {});
      setAsked(true);
      for (const ms of [1500, 4000, 10_000]) setTimeout(() => void onLinked(), ms);
    } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <EmptyState icon={<Mail />} title={tt("noMailbox")} description={asked ? tt("linkAsked") : tt("noMailboxLink")}
      action={<Button variant="outline" onClick={() => void link()} disabled={asked} data-testid="link-mailbox">{tt("linkMailbox")}</Button>} />
  );
}

export function InboxPage(_: PageProps) {
  const host = useModuleHost();
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [infoError, setInfoError] = useState<unknown>(null);
  const loadInfo = useCallback(async () => {
    try { setInfo(await host.api.get<AccountInfo>("/account")); setInfoError(null); } catch (e) { setInfoError(e); }
  }, [host]);
  useEffect(() => { void loadInfo(); }, [loadInfo]);

  if (infoError && !info) return <ErrorState error={infoError} onRetry={() => void loadInfo()} />;
  if (!info) return <div className="grid gap-3"><Skeleton className="h-10 w-64" /><Skeleton className="h-96" /></div>;
  if (!info.available) return <EmptyState icon={<Mail />} title={tt("notReady")} />;
  if (!info.account) return <NoMailbox onLinked={loadInfo} />;
  return <Mailbox info={info} reloadInfo={loadInfo} />;
}

function Mailbox({ info, reloadInfo }: { info: AccountInfo; reloadInfo: () => Promise<void> }) {
  const host = useModuleHost();
  const account = info.account!;
  const paused = account.status === "paused";
  const leadsOn = host.can("leads:lead.write");

  const [view, setView] = useState<View>({ kind: "folder", key: "inbox" });
  const [q, setQ] = useState("");            // what the search box holds
  const [query, setQuery] = useState("");    // what is searched
  const [items, setItems] = useState<ThreadItem[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [folders, setFolders] = useState<Folders>({ folders: [], labels: [] });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [threadError, setThreadError] = useState<unknown>(null);
  const [draft, setDraft] = useState<MailMessage | null>(null);
  const [labelDialog, setLabelDialog] = useState(false);
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const folderKey = view.kind === "folder" ? view.key : view.kind === "search" ? "all" : "all";
  const viewTitle = view.kind === "folder" ? folderName(view.key) : view.kind === "label" ? folders.labels.find((l) => l.id === view.id)?.name ?? tt("labels") : tt("search");

  const loadFolders = useCallback(async () => {
    try { setFolders(await host.api.get<Folders>("/folders")); } catch { /* counts are a nicety */ }
  }, [host]);

  const loadList = useCallback(async (opts: { append?: boolean; quiet?: boolean } = {}) => {
    const n = ++seq.current;
    if (!opts.quiet && !opts.append) setItems(null);
    const params: Record<string, string | number> = { limit: PAGE, offset: opts.append ? (items?.length ?? 0) : 0 };
    if (view.kind === "folder") params.folder = view.key; else if (view.kind === "label") params.label = view.id;
    if (query) params.q = query;
    try {
      const r = await host.api.get<{ data: ThreadItem[]; hasMore: boolean }>("/threads", params);
      if (n !== seq.current) return;
      setItems((cur) => (opts.append ? [...(cur ?? []), ...r.data] : r.data));
      setHasMore(r.hasMore); setLoadError(null);
    } catch (e) { if (n === seq.current) setLoadError(e); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, view, query, items?.length]);

  // Load when the folder, label or search changes.
  useEffect(() => { setChecked(new Set()); setCursor(0); void loadList(); }, [view, query]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void loadFolders(); }, [loadFolders]);

  const refreshAll = useCallback(async (quiet = true) => { await Promise.all([loadList({ quiet }), loadFolders()]); }, [loadList, loadFolders]);

  // New mail: ask the mail server now, then every 30 seconds while the page is open.
  const syncNow = useCallback(async (manual = false) => {
    if (paused) return;
    try {
      const r = await host.api.post<{ received: number; background?: boolean }>("/sync", {});
      // With a real mail server the server fetches every minute: just show what has arrived since.
      if (r.received > 0 || manual || r.background) { await refreshAll(); if (manual || r.received > 0) await reloadInfo(); }
    } catch (e) { if (manual) toast.error(errorMessage(e)); }
  }, [host, paused, refreshAll, reloadInfo]);
  const syncRef = useRef(syncNow); syncRef.current = syncNow;
  useEffect(() => {
    void syncRef.current();
    const t = setInterval(() => { if (!document.hidden) void syncRef.current(); }, 30_000);
    return () => clearInterval(t);
  }, []);

  // Open a conversation (and mark it read).
  const open = useCallback(async (it: ThreadItem) => {
    if (it.isDraft) {
      try { setDraft(await host.api.get<MailMessage>(`/messages/${it.messageId}`)); } catch (e) { toast.error(errorMessage(e)); }
      return;
    }
    setOpenId(it.id); setThread(null); setThreadError(null);
    try {
      const inFolder = view.kind === "folder" && (view.key === "trash" || view.key === "spam") ? `?folder=${view.key}` : "";
      const t = await host.api.get<Thread>(`/threads/${it.id}${inFolder}`);
      setThread(t);
      if (it.unread > 0) {
        await host.api.post("/threads/action", { ids: [it.id], action: "read" });
        setItems((cur) => cur?.map((x) => (x.id === it.id ? { ...x, unread: 0 } : x)) ?? cur);
        void loadFolders();
      }
    } catch (e) { setThreadError(e); }
  }, [host, view, loadFolders]);

  const closeThread = () => { setOpenId(null); setThread(null); };
  const switchView = (v: View) => { setView(v); setQ(""); setQuery(""); closeThread(); };

  // Do something to conversations (the ticked ones, or the open one).
  const targets = useCallback((): string[] => (checked.size ? [...checked] : openId ? [openId] : items?.[cursor] ? [items[cursor]!.id] : []), [checked, openId, items, cursor]);
  const act = useCallback(async (action: Action, ids = targets(), extra: { labelId?: string; done?: string } = {}) => {
    if (!ids.length) return;
    const goneFromList = ["archive", "spam", "trash", "delete"].includes(action) || (action === "inbox" && view.kind === "folder" && view.key !== "inbox");
    try {
      await host.api.post("/threads/action", { ids, action, ...(extra.labelId ? { labelId: extra.labelId } : {}) });
      if (goneFromList) {
        setItems((cur) => cur?.filter((x) => !ids.includes(x.id)) ?? cur);
        if (openId && ids.includes(openId)) closeThread();
      } else if (action === "read" || action === "unread") {
        setItems((cur) => cur?.map((x) => (ids.includes(x.id) ? { ...x, unread: action === "read" ? 0 : Math.max(1, x.unread) } : x)) ?? cur);
      }
      if (goneFromList) setChecked(new Set());
      if (extra.done) toast.success(extra.done);
      await refreshAll();
      if (action === "delete") void reloadInfo(); // room was freed
      if (openId && ids.includes(openId) && !goneFromList) { try { setThread(await host.api.get<Thread>(`/threads/${openId}`)); } catch { /* may have moved */ } }
    } catch (e) { toast.error(errorMessage(e)); }
  }, [host, targets, view, openId, refreshAll, reloadInfo]);

  const inTrash = view.kind === "folder" && (view.key === "trash" || view.key === "spam");

  // ── Writing ──
  const startDraft = async (body: Record<string, unknown> = {}) => {
    if (paused) { toast.error(tt("paused")); return; }
    try { setDraft(await host.api.post<MailMessage>("/drafts", body)); } catch (e) { toast.error(errorMessage(e)); }
  };
  const replyTo = (m: MailMessage, mode: "reply" | "all" | "forward") =>
    void startDraft(mode === "forward" ? { forwardOf: m.id } : { replyTo: m.id, all: mode === "all" });

  const starMessage = async (m: MailMessage) => {
    try {
      await host.api.patch(`/messages/${m.id}`, { isStarred: !m.isStarred });
      setThread((t) => t && { ...t, messages: t.messages.map((x) => (x.id === m.id ? { ...x, isStarred: !m.isStarred } : x)) });
      void refreshAll();
    } catch (e) { toast.error(errorMessage(e)); }
  };

  // ── Keyboard ──
  const move = (d: number) => {
    if (!items?.length) return;
    const i = Math.min(Math.max(cursor + d, 0), items.length - 1);
    setCursor(i);
    if (openId && !items[i]!.isDraft) void open(items[i]!);
    document.querySelector(`[data-row="${i}"]`)?.scrollIntoView({ block: "nearest" });
  };
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (e.key === "Escape") {
      if (document.activeElement === searchRef.current) { searchRef.current?.blur(); return; }
      if (openId && !draft) closeThread();
      return;
    }
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || draft || labelDialog || settings || help) return;
    if (document.querySelector('[role="dialog"], [role="menu"]')) return;
    const cur = items?.[cursor];
    switch (e.key) {
      case "c": e.preventDefault(); void startDraft(); break;
      case "/": e.preventDefault(); searchRef.current?.focus(); break;
      case "j": move(1); break;
      case "k": move(-1); break;
      case "Enter": case "o": if (cur) void open(cur); break;
      case "u": closeThread(); break;
      case "e": if (!inTrash) void act("archive"); break;
      case "#": void act(inTrash ? "delete" : "trash"); break;
      case "!": void act("spam"); break;
      case "s": { const t = targets()[0]; const it = items?.find((x) => x.id === t); if (it) void act(it.isStarred ? "unstar" : "star", [it.id]); break; }
      case "x": if (cur) setChecked((s) => { const n = new Set(s); if (n.has(cur.id)) n.delete(cur.id); else n.add(cur.id); return n; }); break;
      case "I": void act("read"); break;
      case "U": void act("unread"); break;
      case "r": case "a": case "f": {
        const m = thread?.messages.filter((x) => !x.isDraft).at(-1);
        if (m) replyTo(m, e.key === "r" ? "reply" : e.key === "a" ? "all" : "forward");
        break;
      }
      case "?": setHelp(true); break;
      default: return;
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const search = (text: string) => {
    const t = text.trim();
    setQuery(t);
    if (t) setView((v) => (v.kind === "search" ? v : { kind: "search" }));
    else if (view.kind === "search") setView({ kind: "folder", key: "inbox" });
    closeThread();
  };

  const allChecked = !!items?.length && checked.size === items.length;
  const sel = checked.size;
  const unreadOf = (key: string) => folders.folders.find((f) => f.key === key);

  return (
    <div className="-my-2 flex h-[calc(100dvh-7.5rem)] min-h-[30rem] overflow-hidden rounded-lg border bg-surface shadow-xs lg:h-[calc(100dvh-8.5rem)]" data-testid="mail-app">
      {/* Folders */}
      <aside className="hidden w-56 shrink-0 flex-col border-r md:flex" aria-label="Folders">
        <div className="p-3">
          <Button className="w-full justify-start" onClick={() => void startDraft()} data-testid="compose-button"><PenSquare /> {tt("compose")}</Button>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <ul className="grid gap-0.5">
            {["inbox", "starred", "sent", "drafts", "spam", "archive", "trash"].map((key) => {
              const Icon = FOLDER_ICON[key]!;
              const f = unreadOf(key);
              const n = key === "drafts" || key === "trash" ? (f?.total ?? 0) : (f?.unread ?? 0);
              const active = view.kind === "folder" && view.key === key;
              return (
                <li key={key}>
                  <button type="button" onClick={() => switchView({ kind: "folder", key })} aria-current={active ? "page" : undefined} data-testid={`folder-${key}`}
                    className={cn("flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm", active ? "bg-primary/10 font-medium" : "hover:bg-accent", f?.unread ? "font-semibold" : "")}>
                    <Icon className="size-4 shrink-0" /><span className="flex-1 text-left">{folderName(key)}</span>
                    {n > 0 && <span className={cn("text-xs", key === "inbox" ? "font-semibold text-primary" : "text-muted-foreground")} data-testid={`count-${key}`}>{n}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex items-center justify-between px-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span>{tt("labels")}</span>
            <button type="button" aria-label={tt("newLabel")} className="cursor-pointer rounded p-0.5 hover:bg-accent" onClick={() => setLabelDialog(true)}><Plus className="size-3.5" /></button>
          </div>
          <ul className="mt-1 grid gap-0.5">
            {folders.labels.map((l) => {
              const active = view.kind === "label" && view.id === l.id;
              return (
                <li key={l.id} className="group flex items-center">
                  <button type="button" onClick={() => switchView({ kind: "label", id: l.id })} aria-current={active ? "page" : undefined} data-testid="label-item"
                    className={cn("flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm", active ? "bg-primary/10 font-medium" : "hover:bg-accent")}>
                    <span className={cn("size-2.5 shrink-0 rounded-full", DOT[l.color] ?? DOT.gray)} /><span className="flex-1 truncate text-left">{l.name}</span>
                    {l.unread > 0 && <span className="text-xs text-muted-foreground">{l.unread}</span>}
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><button type="button" aria-label={`${l.name}…`} className="cursor-pointer rounded p-1 opacity-0 hover:bg-accent focus:opacity-100 group-hover:opacity-100"><MoreVertical className="size-3.5" /></button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={async () => {
                        try { await host.api.del(`/labels/${l.id}`); if (active) switchView({ kind: "folder", key: "inbox" }); await refreshAll(); } catch (e) { toast.error(errorMessage(e)); }
                      }}><Trash2 /> {tt("deleteLabel")}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        </nav>
        {info.storage && (
          <div className="border-t px-3 pt-2 text-xs text-muted-foreground" data-testid="storage" title={info.limits.trashDays ? tt("trashNote", { days: info.limits.trashDays }) : undefined}>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={info.storage.quotaBytes} aria-valuenow={info.storage.usedBytes} aria-label={tt("storageUsed", { used: fmtSize(info.storage.usedBytes), quota: fmtSize(info.storage.quotaBytes) })}>
              <div className={cn("h-full rounded-full", info.storage.full ? "bg-destructive" : info.storage.usedBytes / info.storage.quotaBytes > 0.85 ? "bg-warning" : "bg-primary")}
                style={{ width: `${Math.min(100, Math.max(1, (info.storage.usedBytes / info.storage.quotaBytes) * 100))}%` }} />
            </div>
            <p className="mt-1">{tt("storageUsed", { used: fmtSize(info.storage.usedBytes), quota: fmtSize(info.storage.quotaBytes) })}</p>
          </div>
        )}
        <div className="flex items-center gap-1 border-t p-2">
          <span className="min-w-0 flex-1 truncate px-1 text-xs text-muted-foreground" title={tt("onlyMe")} data-testid="my-address">{account.address}</span>
          <Button variant="ghost" size="icon" className="size-8" aria-label={tt("settings")} onClick={() => setSettings(true)}><Settings /></Button>
        </div>
      </aside>

      {/* List */}
      <section className={cn("flex min-w-0 flex-col border-r md:w-[26rem] md:shrink-0", openId ? "hidden md:flex" : "w-full flex-1 md:flex-none")} aria-label="Conversations">
        <div className="grid gap-2 border-b p-2">
          <form className="flex items-center gap-1" role="search" onSubmit={(e) => { e.preventDefault(); search(q); }}>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input ref={searchRef} aria-label={tt("search")} placeholder={tt("search")} title={tt("searchHint")} className="pl-8 pr-8" value={q} onChange={(e) => setQ(e.target.value)} data-testid="search-input" />
              {(q || query) && <button type="button" aria-label={tt("clear")} className="absolute right-2 top-2.5 cursor-pointer text-muted-foreground hover:text-foreground" onClick={() => { setQ(""); search(""); }}><X className="size-4" /></button>}
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label={tt("advanced")} title={tt("advanced")} onClick={() => setAdvanced(true)}><SlidersHorizontal /></Button>
          </form>
          <div className="flex min-h-8 items-center gap-1">
            <Checkbox aria-label={tt("selectAll")} checked={allChecked} onCheckedChange={(v) => setChecked(v && items ? new Set(items.map((x) => x.id)) : new Set())} data-testid="select-all" />
            {sel > 0 ? (
              <div className="flex flex-1 items-center gap-0.5" data-testid="bulk-bar">
                <span className="mr-1 text-xs text-muted-foreground">{tt("selected", { count: sel })}</span>
                <Tool label={tt("archive")} icon={<Archive />} onClick={() => void act("archive")} testId="bulk-archive" />
                <Tool label={inTrash ? tt("deleteForever") : tt("delete")} icon={<Trash2 />} onClick={() => void act(inTrash ? "delete" : "trash")} testId="bulk-delete" />
                <Tool label={tt("markRead")} icon={<MailOpen />} onClick={() => void act("read")} testId="bulk-read" />
                <Tool label={tt("markUnread")} icon={<Mail />} onClick={() => void act("unread")} testId="bulk-unread" />
                <MoreMenu labels={folders.labels} inTrash={inTrash} onAct={(a, l) => void act(a, undefined, l ? { labelId: l } : {})} />
              </div>
            ) : (
              <div className="flex flex-1 items-center gap-1">
                <span className="flex-1 truncate px-1 text-sm font-medium" data-testid="view-title">{viewTitle}</span>
                {view.kind === "folder" && (view.key === "trash" || view.key === "spam") && items && items.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={async () => { try { await host.api.post("/folders/trash/empty", {}); await refreshAll(); await reloadInfo(); } catch (e) { toast.error(errorMessage(e)); } }}>{tt("emptyTrash")}</Button>
                )}
                <Tool label={tt("refresh")} icon={<RefreshCw />} onClick={() => void syncNow(true)} testId="refresh" />
              </div>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="thread-list">
          {loadError && !items ? <div className="p-4"><ErrorState error={loadError} onRetry={() => void loadList()} /></div>
            : !items ? <div className="grid gap-2 p-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div>
            : !items.length ? <div className="p-8 text-center text-sm text-muted-foreground" data-testid="empty-list">{query ? tt("noResults") : tt("noMail")}</div>
            : (
              <ul>
                {items.map((it, i) => (
                  <Row key={it.id + it.messageId} it={it} index={i} active={it.id === openId} cursor={i === cursor} checked={checked.has(it.id)}
                    onCheck={(v) => setChecked((s) => { const n = new Set(s); if (v) n.add(it.id); else n.delete(it.id); return n; })}
                    onOpen={() => { setCursor(i); void open(it); }}
                    onStar={() => void act(it.isStarred ? "unstar" : "star", [it.id])}
                    onArchive={() => void act("archive", [it.id])} onDelete={() => void act(inTrash ? "delete" : "trash", [it.id])}
                    onToggleRead={() => void act(it.unread ? "read" : "unread", [it.id])} />
                ))}
                {hasMore && <li className="p-3 text-center"><Button variant="outline" size="sm" onClick={() => void loadList({ append: true, quiet: true })}>…</Button></li>}
              </ul>
            )}
        </div>
      </section>

      {/* Reading pane */}
      <section className={cn("min-w-0 flex-1 flex-col overflow-hidden", openId ? "flex" : "hidden md:flex")} aria-label="Message">
        {openId ? (
          <>
            <div className="flex items-center gap-1 border-b px-2 py-1.5">
              <Tool label={tt("back")} icon={<ArrowLeft />} onClick={closeThread} testId="back" />
              <Tool label={tt("archive")} icon={<Archive />} onClick={() => void act("archive", [openId])} />
              <Tool label={inTrash ? tt("deleteForever") : tt("delete")} icon={<Trash2 />} onClick={() => void act(inTrash ? "delete" : "trash", [openId])} />
              <Tool label={tt("markUnread")} icon={<Mail />} onClick={() => { void act("unread", [openId]); closeThread(); }} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={tt("label")} title={tt("label")}><Tag /></Button></DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>{tt("label")}</DropdownMenuLabel>
                  {folders.labels.map((l) => {
                    const on = !!thread?.messages.some((m) => m.labels.some((x) => x.id === l.id));
                    return (
                      <DropdownMenuItem key={l.id} onSelect={() => void act(on ? "unlabel" : "label", [openId], { labelId: l.id })}>
                        <span className={cn("size-2.5 rounded-full", DOT[l.color] ?? DOT.gray)} />{l.name}{on && <Check className="ml-auto" />}
                      </DropdownMenuItem>
                    );
                  })}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setLabelDialog(true)}><Plus /> {tt("newLabel")}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <MoreMenu labels={[]} inTrash={inTrash} onAct={(a) => void act(a, [openId])} />
            </div>
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
              {threadError ? <div className="p-4"><ErrorState error={threadError} onRetry={() => { const it = items?.find((x) => x.id === openId); if (it) void open(it); }} /></div>
                : !thread ? <div className="grid gap-3 p-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-40" /></div>
                : <ThreadView thread={thread} leadsOn={leadsOn} onReply={replyTo} onStar={(m) => void starMessage(m)} onChanged={() => void act("read", [openId])}
                    onLabelRemove={(id) => void act("unlabel", [openId], { labelId: id })} />}
            </div>
          </>
        ) : <div className="m-auto p-8 text-center text-sm text-muted-foreground">{paused ? tt("paused") : tt("selectOne")}</div>}
      </section>

      {paused ? <div className="fixed inset-x-0 bottom-0 z-30 bg-warning-soft px-4 py-2 text-center text-sm text-warning" role="status">{tt("paused")}</div>
        : info.storage?.full ? <div className="fixed inset-x-0 bottom-0 z-30 bg-destructive/10 px-4 py-2 text-center text-sm text-destructive" role="status" data-testid="mailbox-full">{tt("full")}</div>
        : account.lastSyncError ? <div className="fixed inset-x-0 bottom-0 z-30 bg-warning-soft px-4 py-2 text-center text-sm text-warning" role="status" data-testid="sync-problem">{tt("syncProblem", { reason: account.lastSyncError })}</div>
        : null}
      {draft && info && (
        <Compose key={draft.id} draft={draft} limits={info.limits} onClose={() => { setDraft(null); void refreshAll(); }}
          onSent={() => { setDraft(null); void refreshAll(); if (openId) void host.api.get<Thread>(`/threads/${openId}`).then(setThread).catch(() => {}); }} />
      )}
      <LabelDialog open={labelDialog} onClose={() => setLabelDialog(false)} onCreated={async (id) => {
        setLabelDialog(false); await loadFolders();
        if (openId) await act("label", [openId], { labelId: id });
      }} />
      <SettingsDialog open={settings} signature={account.signature} onClose={() => setSettings(false)} onSaved={async () => { setSettings(false); await reloadInfo(); }} />
      <AdvancedSearch open={advanced} onClose={() => setAdvanced(false)} onSearch={(text) => { setQ(text); search(text); setAdvanced(false); }} />
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent title={tt("shortcuts")}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {([["c", tt("compose")], ["j / k", "↓ / ↑"], ["Enter / o", "Open"], ["u", tt("back")], ["e", tt("archive")], ["#", tt("delete")], ["!", tt("reportSpam")],
              ["s", tt("star")], ["x", tt("selectAll").replace(/.*/, "Select")], ["r / a / f", `${tt("reply")} / ${tt("replyAll")} / ${tt("forward")}`], ["Shift+I / Shift+U", `${tt("markRead")} / ${tt("markUnread")}`], ["/", tt("search")]] as [string, string][])
              .map(([k, v]) => <div key={k} className="contents"><dt><kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{k}</kbd></dt><dd>{v}</dd></div>)}
          </dl>
          <DialogFooter><Button variant="outline" onClick={() => setHelp(false)}>{tt("close")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Small pieces ─────────────────────────────────────────────────────────────
function Tool({ label, icon, onClick, testId }: { label: string; icon: React.ReactNode; onClick: () => void; testId?: string }) {
  return <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={label} title={label} onClick={onClick} data-testid={testId}>{icon}</Button>;
}

function MoreMenu({ labels, inTrash, onAct }: { labels: { id: string; name: string; color: string }[]; inTrash: boolean; onAct: (a: Action, labelId?: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-8" aria-label="More" title="More" data-testid="more-menu"><MoreVertical /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{tt("moveTo")}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onAct("inbox")}><InboxIcon /> {tt("inbox")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAct("archive")}><Archive /> {tt("archive")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAct("spam")}><Ban /> {tt("reportSpam")}</DropdownMenuItem>
        {!inTrash && <DropdownMenuItem onSelect={() => onAct("trash")}><Trash2 /> {tt("trash")}</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onAct("star")}><Star /> {tt("star")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAct("unstar")}><Star /> {tt("unstar")}</DropdownMenuItem>
        {labels.length > 0 && <DropdownMenuSeparator />}
        {labels.map((l) => <DropdownMenuItem key={l.id} onSelect={() => onAct("label", l.id)}><span className={cn("size-2.5 rounded-full", DOT[l.color] ?? DOT.gray)} />{l.name}</DropdownMenuItem>)}
        {inTrash && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => onAct("delete")}><Trash2 /> {tt("deleteForever")}</DropdownMenuItem></>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Row({ it, index, active, cursor, checked, onCheck, onOpen, onStar, onArchive, onDelete, onToggleRead }: {
  it: ThreadItem; index: number; active: boolean; cursor: boolean; checked: boolean; onCheck: (v: boolean) => void; onOpen: () => void;
  onStar: () => void; onArchive: () => void; onDelete: () => void; onToggleRead: () => void;
}) {
  const unread = it.unread > 0;
  const who = it.isDraft ? tt("draft") : it.people.map((p) => (p.me ? tt("me") : it.people.length > 1 ? p.name.split(" ")[0] : p.name)).join(", ") || "—";
  return (
    <li data-row={index} data-testid="thread-row" data-unread={unread ? "true" : "false"}
      className={cn("group relative flex items-start gap-2 border-b px-2 py-2", active ? "bg-primary/10" : checked ? "bg-accent" : "hover:bg-accent/60", cursor && "ring-1 ring-inset ring-primary/40")}>
      <Checkbox aria-label={`Select ${it.subject}`} className="mt-1" checked={checked} onCheckedChange={(v) => onCheck(v === true)} />
      <button type="button" aria-label={it.isStarred ? tt("unstar") : tt("star")} aria-pressed={it.isStarred} className="mt-0.5 cursor-pointer" onClick={onStar}>
        <Star className={cn("size-4", it.isStarred ? "fill-yellow-400 text-yellow-500" : "text-muted-foreground")} />
      </button>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 cursor-pointer text-left">
        <span className="flex items-baseline gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-sm", unread ? "font-semibold" : "text-muted-foreground")}>{who}{it.count > 1 && <span className="ml-1 text-xs font-normal text-muted-foreground">{it.count}</span>}</span>
          <span className={cn("shrink-0 text-xs", unread ? "font-semibold text-foreground" : "text-muted-foreground")}>{fmtListDate(it.date)}</span>
        </span>
        <span className={cn("block truncate text-sm", unread ? "font-semibold" : "")}>{it.subject || tt("noSubject")}</span>
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{it.snippet}</span>
          {it.hasAttachments && <Paperclip className="size-3 shrink-0 text-muted-foreground" aria-label="Has attachment" />}
          {it.labels.map((l) => <span key={l.id} className="inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 text-[10px]"><span className={cn("size-1.5 rounded-full", DOT[l.color] ?? DOT.gray)} />{l.name}</span>)}
        </span>
      </button>
      {/* Quick actions appear when the pointer or focus is on the row. */}
      <span className="absolute right-2 top-1.5 hidden items-center gap-0.5 rounded-md border bg-surface px-0.5 shadow-sm group-focus-within:flex group-hover:flex">
        {!it.isDraft && <Tool label={tt("archive")} icon={<Archive />} onClick={onArchive} />}
        <Tool label={tt("delete")} icon={<Trash2 />} onClick={onDelete} />
        {!it.isDraft && <Tool label={unread ? tt("markRead") : tt("markUnread")} icon={unread ? <MailOpen /> : <Mail />} onClick={onToggleRead} />}
      </span>
    </li>
  );
}

function LabelDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const host = useModuleHost();
  const [name, setName] = useState(""); const [color, setColor] = useState("blue"); const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setName(""); setColor("blue"); } }, [open]);
  const save = async () => {
    setBusy(true);
    try { const l = await host.api.post<{ id: string }>("/labels", { name, color }); onCreated(l.id); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={tt("newLabel")}>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <Field label={tt("labelName")}>{(a) => <Input {...a} autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} data-testid="label-name" />}</Field>
          <div className="flex gap-2" role="radiogroup" aria-label="Colour">
            {LABEL_COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)}
                className={cn("size-6 cursor-pointer rounded-full", DOT[c], color === c && "ring-2 ring-offset-2 ring-primary")} />
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{tt("cancel")}</Button>
            <Button type="submit" disabled={!name.trim() || busy} data-testid="label-create">{tt("create")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog({ open, signature, onClose, onSaved }: { open: boolean; signature: string; onClose: () => void; onSaved: () => void }) {
  const host = useModuleHost();
  const [text, setText] = useState(signature);
  useEffect(() => { if (open) setText(signature); }, [open, signature]);
  const save = async () => { try { await host.api.patch("/account", { signature: text }); onSaved(); } catch (e) { toast.error(errorMessage(e)); } };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={tt("settings")}>
        <div className="grid gap-4">
          <Field label={tt("signature")} hint={tt("signatureHint")}>{(a) => <Textarea {...a} rows={5} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} data-testid="signature-input" />}</Field>
          <p className="text-xs text-muted-foreground">{tt("onlyMe")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>{tt("cancel")}</Button>
            <Button onClick={() => void save()} data-testid="signature-save">{tt("save")}</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AdvancedSearch({ open, onClose, onSearch }: { open: boolean; onClose: () => void; onSearch: (q: string) => void }) {
  const [v, setV] = useState({ words: "", from: "", to: "", subject: "", attach: false, unread: false, after: "", before: "", where: "" });
  useEffect(() => { if (open) setV({ words: "", from: "", to: "", subject: "", attach: false, unread: false, after: "", before: "", where: "" }); }, [open]);
  const text = useMemo(() => {
    const quote = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
    return [v.words.trim(), v.from && `from:${quote(v.from.trim())}`, v.to && `to:${quote(v.to.trim())}`, v.subject && `subject:${quote(v.subject.trim())}`,
      v.attach && "has:attachment", v.unread && "is:unread", v.after && `after:${v.after}`, v.before && `before:${v.before}`, v.where && `in:${v.where}`].filter(Boolean).join(" ");
  }, [v]);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={tt("advanced")}>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); onSearch(text); }}>
          <Field label={tt("search")}>{(a) => <Input {...a} value={v.words} onChange={set("words")} />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={tt("from")}>{(a) => <Input {...a} value={v.from} onChange={set("from")} data-testid="adv-from" />}</Field>
            <Field label={tt("to")}>{(a) => <Input {...a} value={v.to} onChange={set("to")} />}</Field>
          </div>
          <Field label={tt("subject")}>{(a) => <Input {...a} value={v.subject} onChange={set("subject")} />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={tt("after")}>{(a) => <Input {...a} type="date" value={v.after} onChange={set("after")} />}</Field>
            <Field label={tt("before")}>{(a) => <Input {...a} type="date" value={v.before} onChange={set("before")} />}</Field>
          </div>
          <Field label={tt("searchIn")}>{(a) => (
            <select {...a} className="h-9 rounded-md border bg-surface px-2 text-sm" value={v.where} onChange={set("where")}>
              <option value="">{tt("anywhere")}</option>
              {(["inbox", "sent", "drafts", "spam", "trash", "archive"] as MailKey[]).map((f) => <option key={f} value={f}>{tt(f)}</option>)}
            </select>)}
          </Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.attach} onChange={(e) => setV((x) => ({ ...x, attach: e.target.checked }))} data-testid="adv-attach" /> {tt("hasAttachment")}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.unread} onChange={(e) => setV((x) => ({ ...x, unread: e.target.checked }))} /> {tt("unreadOnly")}</label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{tt("cancel")}</Button>
            <Button type="submit" disabled={!text} data-testid="adv-go"><Search /> {tt("search")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
