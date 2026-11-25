import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "@office/db";
import { moduleErrors as E, ModuleError, type ModuleContext } from "@office/sdk";
import { accounts, attachments, labels, messageLabels, messages, remoteDeletions, FOLDERS, type Addr, type Folder } from "./schema.ts";
import {
  getMailLimits, getMailProvider, MailProviderError, type IncomingMail, type MailProvider, type RemoteChange, type RemoteFlags, type RemoteFolder,
} from "./provider.ts";
import { htmlToText, sanitizeHtml } from "./sanitize.ts";

export const USE = "mail:inbox.use";

/** Largest file you can attach, and the most one message can carry in total. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
/** Largest file we keep from a received message (bigger ones are dropped, the message says so). */
const MAX_INCOMING_FILE_BYTES = 10 * 1024 * 1024;
const MAX_RECIPIENTS = 100;
const MAX_SENDS_PER_DAY = 200;
/** How often opening the inbox (or the menu badge) may ask the mail server for new mail. */
const SYNC_EVERY_MS = 20_000;
/** Files that can run on a computer: refused when attaching, flagged when received. */
const RISKY = /\.(exe|bat|cmd|com|scr|pif|msi|msp|jar|js|jse|vbs|vbe|wsf|wsh|ps1|psm1|sh|lnk|reg|dll|apk|app|hta|cpl|iso|dmg)$/i;
/** Types a browser could run or render as a page: always handed out as a plain download. */
const SAFE_TYPES = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/(plain|csv)|audio\/[\w.+-]+|video\/[\w.+-]+|application\/(zip|json|vnd\.[\w.+-]+|msword|rtf)|application\/octet-stream)$/i;

// ── Input schemas ────────────────────────────────────────────────────────────
const addr = z.object({ name: z.string().trim().max(200).default(""), email: z.string().trim().toLowerCase().max(320) }).strict();
const addrs = z.array(addr).max(MAX_RECIPIENTS);
export const DraftPatch = z.object({
  to: addrs.optional(), cc: addrs.optional(), bcc: addrs.optional(),
  subject: z.string().max(998).optional(),
  text: z.string().max(200_000).optional(),
}).strict();
export const DraftInput = z.object({
  /** Answer this message (to its sender, or to everyone with `all`). */
  replyTo: z.uuid().optional(), all: z.boolean().optional(),
  forwardOf: z.uuid().optional(),
  to: addrs.optional(), subject: z.string().max(998).optional(), text: z.string().max(200_000).optional(),
}).strict();
export const AttachmentInput = z.object({
  name: z.string().trim().min(1).max(255),
  contentType: z.string().trim().max(100).default("application/octet-stream"),
  /** The file, base64. */
  data: z.string().min(1).max(Math.ceil((MAX_FILE_BYTES * 4) / 3) + 16),
}).strict();
export const Id = z.object({ id: z.uuid() });
export const AttachmentParams = z.object({ id: z.uuid(), attId: z.uuid() });
export const ThreadsQuery = z.object({
  folder: z.enum(["inbox", "starred", "sent", "drafts", "spam", "trash", "archive", "all"]).optional(),
  label: z.uuid().optional(),
  q: z.string().trim().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export const ActionInput = z.object({
  ids: z.array(z.uuid()).min(1).max(200),
  action: z.enum(["read", "unread", "star", "unstar", "archive", "inbox", "spam", "trash", "delete", "label", "unlabel"]),
  labelId: z.uuid().optional(),
}).strict();
export const MessagePatch = z.object({ isRead: z.boolean().optional(), isStarred: z.boolean().optional() }).strict();
export const LabelInput = z.object({
  name: z.string().trim().min(1, "Give the label a name").max(60),
  color: z.enum(["gray", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"]).default("gray"),
}).strict();
export const LabelPatch = LabelInput.partial().strict();
export const AccountPatch = z.object({ signature: z.string().max(2000).optional(), displayName: z.string().trim().min(1).max(200).optional() }).strict();

// ── Helpers ──────────────────────────────────────────────────────────────────
type Account = typeof accounts.$inferSelect;
type Message = typeof messages.$inferSelect;
const iso = (d: Date | string) => new Date(d).toISOString();
const likeEsc = (s: string) => s.replace(/[\\%_]/g, "\\$&");
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const rows = async <T>(ctx: ModuleContext, q: SQL) => (await ctx.db.execute(q)) as unknown as T[];

/**
 * Says whose mailbox this request is about. The database only shows rows of this person (see the migration),
 * so even a mistake in a query below can't show someone else's mail.
 */
export async function scopeTo(ctx: ModuleContext, userId: string): Promise<string> {
  await ctx.db.execute(sql`select set_config('app.mail_user', ${userId}, true)`);
  return userId;
}
async function me(ctx: ModuleContext): Promise<string> {
  const uid = ctx.actor.type === "user" ? ctx.actor.userId : undefined;
  if (!uid) throw E.forbidden("Mail is for people signed in to Office");
  return scopeTo(ctx, uid);
}

const providerOrNull = () => getMailProvider();
function needProvider(): MailProvider {
  const p = providerOrNull();
  if (!p) throw new ModuleError(424, "mail_unavailable", "Mail isn't set up on this server yet.");
  return p;
}
async function viaProvider<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof MailProviderError) throw new ModuleError(424, e.code, e.message);
    throw new ModuleError(424, "provider_error", "The mail server couldn't do that just now. Please try again in a moment.");
  }
}

const normSubject = (s: string) => s.replace(/^\s*((re|fw|fwd|aw|sv|rv)\s*(\[\d+\])?\s*:\s*)+/i, "").trim().toLowerCase();
const hasReplyPrefix = (s: string) => /^\s*(re|fw|fwd|aw|sv|rv)\s*(\[\d+\])?\s*:/i.test(s);
const snippetOf = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 160);
const safeName = (n: string) => n.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "").slice(0, 150) || "file";
const safeType = (t: string) => (SAFE_TYPES.test(t.trim()) ? t.trim().toLowerCase() : "application/octet-stream");
const cleanAddrs = (list: { name?: string; email: string }[]): Addr[] =>
  list.map((a) => ({ name: (a.name ?? "").trim(), email: a.email.trim().toLowerCase() })).filter((a) => a.email);

// ── Account ──────────────────────────────────────────────────────────────────
async function loadAccount(ctx: ModuleContext): Promise<Account | null> {
  const [a] = await ctx.db.select().from(accounts).limit(1);
  return a ?? null;
}

/** The person's mailbox. A person with no Work email mailbox gets a pretend one only where the provider allows it (development). */
async function ensureAccount(ctx: ModuleContext, uid: string): Promise<Account | null> {
  const found = await loadAccount(ctx);
  if (found) return found;
  const p = providerOrNull();
  if (!p?.autoProvision) return null;
  const person = await ctx.people.get(uid);
  if (!person?.email) return null;
  const [row] = await ctx.db.insert(accounts).values({
    id: uuidv7(), tenantId: ctx.tenantId, userId: uid, address: person.email.toLowerCase(), displayName: person.name || person.email,
    source: "local",
  }).returning();
  return row!;
}
async function needAccount(ctx: ModuleContext, uid: string, opts: { active?: boolean } = {}): Promise<Account> {
  const a = await ensureAccount(ctx, uid);
  if (!a) throw new ModuleError(424, "no_mailbox", "You don't have a mailbox yet. Ask the owner to give you a work email.");
  if (opts.active && a.status === "paused") throw new ModuleError(409, "mailbox_paused", "Your mailbox is switched off. Ask the owner to switch it back on.");
  return a;
}

const accountDto = (a: Account) => ({
  id: a.id, address: a.address, name: a.displayName, signature: a.signature, source: a.source, status: a.status,
  lastSyncedAt: a.lastSyncedAt ? iso(a.lastSyncedAt) : null, lastSyncError: a.lastSyncError,
});

// ── Storage: how much one person keeps ───────────────────────────────────────
/** Bytes of mail this person keeps in Office: text, cleaned HTML and attachments (rows of this person only, by the database rule). */
export async function usedBytes(ctx: ModuleContext): Promise<number> {
  const [r] = await rows<{ n: number }>(ctx, sql`select
    (select coalesce(sum(octet_length(body_text) + coalesce(octet_length(body_html), 0)), 0) from mail_messages)
    + (select coalesce(sum(size_bytes), 0) from mail_attachments) as n`);
  return Number(r?.n ?? 0);
}
const FULL = "Your mailbox is full. Delete old mail or empty the Trash to receive and send again.";
async function storage(ctx: ModuleContext) {
  const used = await usedBytes(ctx), { quotaBytes } = getMailLimits();
  return { usedBytes: used, quotaBytes, full: used >= quotaBytes };
}

export async function getAccount(ctx: ModuleContext) {
  const uid = await me(ctx);
  const a = await ensureAccount(ctx, uid);
  const { trashDays } = getMailLimits();
  return {
    available: !!providerOrNull(), account: a ? accountDto(a) : null,
    /** New mail is fetched by the server every minute (real mail server), not when the page asks. */
    background: !!providerOrNull()?.background,
    storage: a ? await storage(ctx) : null,
    limits: { maxFileBytes: MAX_FILE_BYTES, maxTotalBytes: MAX_TOTAL_BYTES, trashDays },
  };
}

/** Asks Work email (by event) to link this person's work mailbox, e.g. one made before Mail was turned on. */
export async function requestLink(ctx: ModuleContext) {
  const uid = await me(ctx);
  await ctx.events.emit("mail.mailboxes.requested", { userId: uid });
  return { requested: true };
}

export async function patchAccount(ctx: ModuleContext, input: z.infer<typeof AccountPatch>) {
  const uid = await me(ctx);
  const a = await needAccount(ctx, uid);
  const [row] = await ctx.db.update(accounts).set({
    ...(input.signature !== undefined ? { signature: input.signature } : {}),
    ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
    updatedAt: new Date(),
  }).where(eq(accounts.id, a.id)).returning();
  return accountDto(row!);
}

// ── Events from Work email ───────────────────────────────────────────────────
/** A work mailbox was made for this colleague: it becomes their mailbox here. */
export async function onMailboxCreated(ctx: ModuleContext, p: Record<string, unknown>) {
  const userId = typeof p.userId === "string" ? p.userId : null, address = typeof p.address === "string" ? p.address.toLowerCase() : null;
  if (!userId || !address) return;
  await scopeTo(ctx, userId);
  const ref = typeof p.id === "string" ? p.id : null;
  // A replayed mailbox (see "mail.mailboxes.requested") says whether it is switched off.
  const status = p.status === "suspended" ? "paused" as const : "active" as const;
  const found = await loadAccount(ctx);
  if (found) {
    if (found.address !== address) {
      // A new mailbox on a new server: forget the old fetch position and the old server's ids so nothing new is skipped.
      await ctx.db.update(messages).set({ remoteUid: null, remoteDirty: false }).where(eq(messages.accountId, found.id));
      await ctx.db.delete(remoteDeletions).where(eq(remoteDeletions.accountId, found.id));
      await ctx.db.update(accounts).set({ address, source: "workmail", providerRef: ref, status, syncCursor: null, lastSyncError: null, updatedAt: new Date() }).where(eq(accounts.id, found.id));
    } else if (p.replay && found.status !== status) {
      await ctx.db.update(accounts).set({ status, updatedAt: new Date() }).where(eq(accounts.id, found.id));
    }
    return;
  }
  const person = await ctx.people.get(userId);
  await ctx.db.insert(accounts).values({
    id: uuidv7(), tenantId: ctx.tenantId, userId, address, displayName: person?.name || address, source: "workmail", providerRef: ref, status,
  });
}
export async function onMailboxState(ctx: ModuleContext, p: Record<string, unknown>, status: "active" | "paused") {
  const userId = typeof p.userId === "string" ? p.userId : null;
  if (!userId) return;
  await scopeTo(ctx, userId);
  await ctx.db.update(accounts).set({ status, updatedAt: new Date() }).where(eq(accounts.source, "workmail"));
}

// ── Fetching new mail ────────────────────────────────────────────────────────
async function findThread(ctx: ModuleContext, m: { inReplyTo: string | null; refs: string[]; subject: string; subjectNorm: string }): Promise<string> {
  const ids = [...new Set([m.inReplyTo, ...m.refs].filter((x): x is string => !!x))];
  if (ids.length) {
    const [hit] = await ctx.db.select({ t: messages.threadId }).from(messages).where(inArray(messages.messageIdHdr, ids)).limit(1);
    if (hit) return hit.t;
  }
  if (m.subjectNorm && hasReplyPrefix(m.subject)) {
    const [hit] = await ctx.db.select({ t: messages.threadId }).from(messages)
      .where(and(eq(messages.subjectNorm, m.subjectNorm), sql`${messages.date} > now() - interval '60 days'`)).orderBy(desc(messages.date)).limit(1);
    if (hit) return hit.t;
  }
  return uuidv7();
}

async function storeIncoming(ctx: ModuleContext, a: Account, m: IncomingMail): Promise<boolean> {
  const [dupe] = await ctx.db.select({ id: messages.id }).from(messages).where(and(eq(messages.accountId, a.id), eq(messages.remoteUid, m.uid))).limit(1);
  if (dupe) return false;
  const cleaned = m.html ? sanitizeHtml(m.html) : null;
  const text = (m.text || (cleaned ? htmlToText(cleaned.html) : "")).slice(0, 500_000);
  const subject = (m.subject ?? "").slice(0, 998);
  const refs = (m.references ?? []).slice(-30);
  const subjectNorm = normSubject(subject);
  const threadId = await findThread(ctx, { inReplyTo: m.inReplyTo, refs, subject, subjectNorm });
  const keep = (m.files ?? []).filter((f) => f.data.length <= MAX_INCOMING_FILE_BYTES);
  const id = uuidv7();
  const date = new Date(m.date);
  await ctx.db.insert(messages).values({
    id, tenantId: ctx.tenantId, userId: a.userId, accountId: a.id, threadId, folder: m.spam ? "spam" : "inbox", remoteUid: m.uid,
    messageIdHdr: m.messageId, inReplyTo: m.inReplyTo, refs, fromName: (m.from.name ?? "").slice(0, 200), fromEmail: m.from.email.toLowerCase().slice(0, 320),
    toAddrs: cleanAddrs(m.to ?? []), ccAddrs: cleanAddrs(m.cc ?? []), bccAddrs: [], subject, subjectNorm,
    bodyText: text + (keep.length < (m.files ?? []).length ? "\n\n[An attachment was too large and was not kept.]" : ""),
    bodyHtml: cleaned?.html ?? null, snippet: snippetOf(text), isRead: m.read ?? false, isStarred: m.starred ?? false, hasAttachments: keep.length > 0,
    hasRemoteImages: cleaned?.hasRemoteImages ?? false, date: Number.isNaN(date.getTime()) ? new Date() : date, trashedAt: m.spam ? new Date() : null,
  });
  for (const f of keep) {
    await ctx.db.insert(attachments).values({
      id: uuidv7(), tenantId: ctx.tenantId, userId: a.userId, messageId: id, name: safeName(f.name), contentType: safeType(f.contentType),
      sizeBytes: f.data.length, data: f.data,
    });
  }
  return true;
}

// ── Two-way sync: changes made in Office go back to the mail server ──────────
/** Remembers messages deleted for good, so the job deletes them on the mail server too (only where there is one to write to). */
async function tombstone(ctx: ModuleContext, where: SQL) {
  if (!providerOrNull()?.applyChanges) return;
  await ctx.db.execute(sql`insert into mail_remote_deletions (tenant_id, user_id, account_id, remote_uid)
    select m.tenant_id, m.user_id, m.account_id, m.remote_uid from mail_messages m where m.remote_uid is not null and m.folder <> 'drafts' and (${where})`);
}

/** Writes read/starred/moves/deletes made in Office to the mail server. Returns how many changes went out. */
async function pushChanges(ctx: ModuleContext, a: Account, p: MailProvider): Promise<number> {
  if (!p.applyChanges) return 0;
  const dirty = await ctx.db.select({ id: messages.id, uid: messages.remoteUid, read: messages.isRead, starred: messages.isStarred, folder: messages.folder, ver: sql<string>`${messages.updatedAt}::text` })
    .from(messages).where(and(eq(messages.accountId, a.id), eq(messages.remoteDirty, true), isNotNull(messages.remoteUid))).limit(200);
  const gone = await ctx.db.select().from(remoteDeletions).where(eq(remoteDeletions.accountId, a.id)).limit(200);
  const changes: RemoteChange[] = [
    ...dirty.map((d) => ({ uid: d.uid!, read: d.read, starred: d.starred, folder: (d.folder === "drafts" ? "inbox" : d.folder) as RemoteFolder })),
    ...gone.map((g) => ({ uid: g.remoteUid, read: true, starred: false, folder: "deleted" as const })),
  ];
  if (!changes.length) return 0;
  const results = await p.applyChanges({ address: a.address, providerRef: a.providerRef }, changes);
  const by = new Map(results.map((r) => [r.uid, r.newUid]));
  for (const d of dirty) {
    const newUid = by.has(d.uid!) ? by.get(d.uid!)! : d.uid;
    // Changed again while we were writing? Then it stays marked, and goes out next time.
    await ctx.db.update(messages).set({ remoteUid: newUid, remoteDirty: sql`${messages.updatedAt}::text <> ${d.ver}` as unknown as boolean })
      .where(eq(messages.id, d.id));
  }
  if (gone.length) await ctx.db.delete(remoteDeletions).where(inArray(remoteDeletions.id, gone.map((g) => g.id)));
  return changes.length;
}

/** Read/starred changes made in another mail app (phone, webmail). A change made in Office and not yet written back wins. */
async function applyRemoteFlags(ctx: ModuleContext, a: Account, flags: RemoteFlags[]) {
  if (!flags.length) return;
  await ctx.db.execute(sql`update mail_messages m set is_read = f.read, is_starred = f.starred, updated_at = now()
    from jsonb_to_recordset(${JSON.stringify(flags.slice(0, 2000))}::jsonb) as f(uid text, read boolean, starred boolean)
    where m.account_id = ${a.id}::uuid and m.remote_uid = f.uid and not m.remote_dirty and (m.is_read <> f.read or m.is_starred <> f.starred)`);
}

async function syncNow(ctx: ModuleContext, a: Account): Promise<number> {
  const p = needProvider();
  await viaProvider(() => pushChanges(ctx, a, p));
  if ((await storage(ctx)).full) {
    // Mail waits on the mail server (nothing is lost) until there is room again.
    await ctx.db.update(accounts).set({ lastSyncError: FULL, lastSyncedAt: new Date() }).where(eq(accounts.id, a.id));
    throw new ModuleError(409, "mailbox_full", FULL);
  }
  const got = await viaProvider(() => p.fetchNew({ address: a.address, providerRef: a.providerRef }, a.syncCursor));
  let received = 0;
  for (const m of got.messages.slice(0, 500)) if (await storeIncoming(ctx, a, m)) received++;
  await applyRemoteFlags(ctx, a, got.flags ?? []);
  await ctx.db.update(accounts).set({ syncCursor: got.cursor, lastSyncedAt: new Date(), lastSyncError: null }).where(eq(accounts.id, a.id));
  return received;
}

export async function sync(ctx: ModuleContext) {
  const uid = await me(ctx);
  const a = await needAccount(ctx, uid, { active: true });
  // A real mail server is read by the worker every minute, never inside a page request.
  if (needProvider().background) return { received: 0, background: true, lastSyncedAt: a.lastSyncedAt ? iso(a.lastSyncedAt) : null };
  return { received: await syncNow(ctx, a) };
}

/** Asks for new mail unless that was done a moment ago. A mail server that doesn't answer never breaks the page. */
async function syncIfDue(ctx: ModuleContext, a: Account) {
  const p = providerOrNull();
  if (a.status !== "active" || !p || p.background) return;
  if (a.lastSyncedAt && Date.now() - new Date(a.lastSyncedAt).getTime() < SYNC_EVERY_MS) return;
  try { await syncNow(ctx, a); } catch (e) { ctx.log.warn({ err: String(e) }, "mail sync failed"); }
}

// ── Jobs (run by the worker) ─────────────────────────────────────────────────
/** Everyone's mailbox in this business (the database shows them one person at a time). */
async function allAccounts(ctx: ModuleContext): Promise<Account[]> {
  const out: Account[] = [];
  for (const person of await ctx.people.list()) {
    await scopeTo(ctx, person.userId);
    const a = await loadAccount(ctx);
    if (a) out.push(a);
  }
  return out;
}

/** Every minute: fetch new mail and write changes back, for a real mail server. Longest-waiting mailboxes first, within a time budget. */
export async function syncJob(ctx: ModuleContext, opts: { budgetMs?: number; max?: number } = {}) {
  const p = providerOrNull();
  if (!p?.background) return { synced: 0 };
  const due = (await allAccounts(ctx)).filter((a) => a.status === "active")
    .sort((x, y) => (x.lastSyncedAt?.getTime() ?? 0) - (y.lastSyncedAt?.getTime() ?? 0));
  const until = Date.now() + (opts.budgetMs ?? 40_000);
  let synced = 0;
  for (const a of due.slice(0, opts.max ?? 25)) {
    if (Date.now() > until) break;
    await scopeTo(ctx, a.userId);
    try { await syncNow(ctx, a); synced++; }
    catch (e) {
      const msg = e instanceof ModuleError ? e.message : "The mail server couldn't be reached.";
      await ctx.db.update(accounts).set({ lastSyncError: msg }).where(eq(accounts.id, a.id));
      ctx.log.warn({ err: String(e), account: a.id }, "mail sync failed");
    }
  }
  return { synced };
}

/** Every hour: mail that has been in Trash or Spam longer than the limit (30 days) is deleted for good. */
export async function cleanUpJob(ctx: ModuleContext) {
  const { trashDays } = getMailLimits();
  let deleted = 0;
  for (const a of await allAccounts(ctx)) {
    await scopeTo(ctx, a.userId);
    const old = sql`m.folder in ('trash','spam') and m.trashed_at < now() - make_interval(days => ${trashDays})`;
    await tombstone(ctx, old);
    const gone = await ctx.db.execute(sql`delete from mail_messages m where ${old} returning m.id`);
    deleted += (gone as unknown as unknown[]).length;
  }
  return { deleted };
}

// ── Folders, counts and the menu badge ───────────────────────────────────────
export async function folders(ctx: ModuleContext) {
  const uid = await me(ctx);
  const a = await ensureAccount(ctx, uid);
  if (!a) return { folders: [], labels: [] };
  const counts = await rows<{ folder: string; unread: number; total: number }>(ctx, sql`
    select folder, (count(distinct thread_id) filter (where not is_read))::int as unread, count(*)::int as total
    from mail_messages group by folder`);
  const by = new Map(counts.map((c) => [c.folder, c]));
  const [star] = await rows<{ n: number }>(ctx, sql`select count(distinct thread_id)::int as n from mail_messages where is_starred and folder not in ('trash','spam')`);
  const lab = await rows<{ id: string; name: string; color: string; unread: number }>(ctx, sql`
    select l.id, l.name, l.color,
      (select count(distinct m.thread_id)::int from mail_message_labels ml join mail_messages m on m.id = ml.message_id
        where ml.label_id = l.id and not m.is_read and m.folder not in ('trash','spam')) as unread
    from mail_labels l order by lower(l.name)`);
  const f = (key: string) => by.get(key);
  return {
    folders: [
      { key: "inbox", unread: f("inbox")?.unread ?? 0 },
      { key: "starred", unread: 0, total: star?.n ?? 0 },
      { key: "sent", unread: 0 },
      { key: "drafts", unread: 0, total: f("drafts")?.total ?? 0 },
      { key: "spam", unread: f("spam")?.unread ?? 0 },
      { key: "archive", unread: 0 },
      { key: "trash", unread: 0, total: f("trash")?.total ?? 0 },
    ],
    labels: lab,
  };
}

/** The number next to "Mail" in the menu: conversations in the inbox with something unread. */
export async function unread(ctx: ModuleContext) {
  const uid = await me(ctx);
  const a = await ensureAccount(ctx, uid);
  if (!a) return { count: 0 };
  await syncIfDue(ctx, a);
  const [r] = await rows<{ n: number }>(ctx, sql`select count(distinct thread_id)::int as n from mail_messages where folder = 'inbox' and not is_read`);
  return { count: r?.n ?? 0 };
}

// ── Reading: lists and conversations ─────────────────────────────────────────
interface Parsed { text: string[]; conds: SQL[]; folder: string | null }

/** Gmail-style search words: from:  to:  subject:  has:attachment  is:unread|read|starred  label:  in:  before:  after:  filename:  "exact phrase". */
async function parseQuery(ctx: ModuleContext, q: string): Promise<Parsed> {
  const out: Parsed = { text: [], conds: [], folder: null };
  const re = /(-?)(\w+):("[^"]*"|\S+)|"([^"]*)"|(\S+)/g;
  const day = (v: string) => { const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(v); return m ? `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}` : null; };
  for (const m of q.matchAll(re)) {
    const op = m[2]?.toLowerCase(), val = (m[3] ?? "").replace(/^"|"$/g, "").trim();
    if (!op) { const w = (m[4] ?? m[5] ?? "").trim(); if (w) out.text.push(w); continue; }
    const neg = m[1] === "-";
    const add = (c: SQL) => out.conds.push(neg ? sql`not (${c})` : c);
    const like = `%${likeEsc(val)}%`;
    switch (op) {
      case "from": add(sql`(m.from_email ilike ${like} or m.from_name ilike ${like})`); break;
      case "to": add(sql`(m.to_addrs::text ilike ${like} or m.cc_addrs::text ilike ${like})`); break;
      case "subject": add(sql`m.subject ilike ${like}`); break;
      case "filename": add(sql`exists (select 1 from mail_attachments x where x.message_id = m.id and x.name ilike ${like})`); break;
      case "has": if (val.toLowerCase().startsWith("attach")) add(sql`m.has_attachments`); break;
      case "is":
        if (val === "unread") add(sql`not m.is_read`); else if (val === "read") add(sql`m.is_read`);
        else if (val === "starred") add(sql`m.is_starred`);
        break;
      case "label": {
        const [l] = await ctx.db.select({ id: labels.id }).from(labels).where(sql`lower(${labels.name}) = ${val.toLowerCase()}`).limit(1);
        add(l ? sql`exists (select 1 from mail_message_labels ml where ml.message_id = m.id and ml.label_id = ${l.id})` : sql`false`);
        break;
      }
      case "in": if ((FOLDERS as string[]).includes(val.toLowerCase()) || val.toLowerCase() === "anywhere") out.folder = val.toLowerCase(); break;
      case "before": { const d = day(val); if (d) add(sql`m.date < ${d}::date`); break; }
      case "after": { const d = day(val); if (d) add(sql`m.date >= ${d}::date`); break; }
      default: out.text.push(m[0]);
    }
  }
  for (const w of out.text) {
    const like = `%${likeEsc(w)}%`;
    out.conds.push(sql`(m.subject ilike ${like} or m.body_text ilike ${like} or m.from_email ilike ${like} or m.from_name ilike ${like} or m.to_addrs::text ilike ${like})`);
  }
  return out;
}

interface ThreadRow {
  thread_id: string; id: string; folder: string; subject: string; snippet: string; from_name: string; from_email: string; date: Date | string; is_read: boolean;
}
interface ThreadAgg {
  thread_id: string; first_subject: string | null; n: number; unread: number; starred: boolean; attach: boolean;
  people: { name: string; email: string }[] | null;
}

export async function listThreads(ctx: ModuleContext, query: z.infer<typeof ThreadsQuery>) {
  const uid = await me(ctx);
  const a = await ensureAccount(ctx, uid);
  if (!a) return { data: [], hasMore: false };
  const parsed = await parseQuery(ctx, query.q ?? "");
  const searching = !!query.q;
  let folder: string = parsed.folder ?? query.folder ?? (searching ? "all" : "inbox");
  if (folder === "anywhere") folder = "everywhere";
  const conds: SQL[] = [];
  if (query.label) {
    conds.push(sql`exists (select 1 from mail_message_labels ml where ml.message_id = m.id and ml.label_id = ${query.label})`);
    if (!parsed.folder) folder = "all";
  }
  if (folder === "starred") conds.push(sql`m.is_starred and m.folder not in ('trash','spam')`);
  else if (folder === "all") conds.push(sql`m.folder not in ('trash','spam')`);
  else if (folder !== "everywhere") conds.push(sql`m.folder = ${folder}`);
  conds.push(...parsed.conds);
  const where = conds.length ? sql.join(conds.map((c) => sql`(${c})`), sql` and `) : sql`true`;
  // One line per conversation: its newest message that fits. Drafts are listed one by one.
  const page = await rows<ThreadRow>(ctx, sql`
    select * from (
      select distinct on (case when m.folder = 'drafts' then m.id else m.thread_id end)
        m.thread_id, m.id, m.folder, m.subject, m.snippet, m.from_name, m.from_email, m.date, m.is_read
      from mail_messages m where ${where}
      order by case when m.folder = 'drafts' then m.id else m.thread_id end, m.date desc
    ) t order by t.date desc, t.id desc limit ${query.limit + 1} offset ${query.offset}`);
  const hasMore = page.length > query.limit;
  const items = page.slice(0, query.limit);
  const ids = items.map((r) => r.thread_id);
  const aggs = new Map<string, ThreadAgg>();
  const labelsBy = new Map<string, { id: string; name: string; color: string }[]>();
  if (ids.length) {
    const scope = folder === "trash" || folder === "spam" ? sql`m.folder = ${folder}` : folder === "everywhere" ? sql`true` : sql`m.folder not in ('trash','spam')`;
    const list = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
    for (const r of await rows<ThreadAgg>(ctx, sql`
      select m.thread_id, (array_agg(m.subject order by m.date) filter (where m.folder <> 'drafts'))[1] as first_subject, count(*)::int as n, (count(*) filter (where not m.is_read and m.folder not in ('sent','drafts')))::int as unread,
        bool_or(m.is_starred) as starred, bool_or(m.has_attachments) as attach,
        array_agg(jsonb_build_object('name', m.from_name, 'email', m.from_email) order by m.date)
          filter (where m.folder not in ('drafts')) as people
      from mail_messages m where m.thread_id in (${list}) and ${scope} group by m.thread_id`)) aggs.set(r.thread_id, r);
    for (const r of await rows<{ thread_id: string; id: string; name: string; color: string }>(ctx, sql`
      select distinct m.thread_id, l.id, l.name, l.color from mail_message_labels ml
      join mail_messages m on m.id = ml.message_id join mail_labels l on l.id = ml.label_id
      where m.thread_id in (${list}) order by l.name`)) {
      const arr = labelsBy.get(r.thread_id) ?? []; arr.push({ id: r.id, name: r.name, color: r.color }); labelsBy.set(r.thread_id, arr);
    }
  }
  return {
    hasMore,
    data: items.map((r) => {
      const g = aggs.get(r.thread_id);
      const seen = new Set<string>();
      const people = (g?.people ?? []).filter((p) => (seen.has(p.email) ? false : (seen.add(p.email), true)))
        .map((p) => ({ name: p.email === a.address ? "me" : (p.name || p.email), email: p.email, me: p.email === a.address }));
      return {
        id: r.thread_id, messageId: r.id, isDraft: r.folder === "drafts", folder: r.folder, subject: r.folder === "drafts" ? r.subject : (g?.first_subject ?? r.subject), snippet: r.snippet,
        date: iso(r.date), count: g?.n ?? 1, unread: g?.unread ?? 0, isStarred: g?.starred ?? false, hasAttachments: g?.attach ?? false,
        people: r.folder === "drafts" ? [{ name: "Draft", email: "", me: true }] : people.slice(-4),
        labels: labelsBy.get(r.thread_id) ?? [],
      };
    }),
  };
}

async function contactsFor(ctx: ModuleContext, emails: string[]) {
  const out = new Map<string, { id: string; name: string }>();
  if (!ctx.authz.can("core:contacts.read")) return out;
  for (const email of emails.slice(0, 15)) {
    try {
      const found = await ctx.data.contacts.list({ q: email, limit: 10 });
      const hit = found.data.find((c) => String(c.email ?? "").toLowerCase() === email);
      if (hit) {
        const name = [hit.firstName, hit.lastName].filter(Boolean).join(" ").trim() || String(hit.name ?? hit.email ?? "");
        out.set(email, { id: String(hit.id), name });
      }
    } catch { /* contacts not available: just no names */ }
  }
  return out;
}

async function messageDtos(ctx: ModuleContext, a: Account, list: Message[]) {
  const ids = list.map((m) => m.id);
  const atts = ids.length ? await ctx.db.select({
    id: attachments.id, messageId: attachments.messageId, name: attachments.name, contentType: attachments.contentType, sizeBytes: attachments.sizeBytes,
  }).from(attachments).where(inArray(attachments.messageId, ids)).orderBy(asc(attachments.createdAt)) : [];
  const labs = ids.length ? await ctx.db.select({ messageId: messageLabels.messageId, id: labels.id, name: labels.name, color: labels.color })
    .from(messageLabels).innerJoin(labels, eq(labels.id, messageLabels.labelId)).where(inArray(messageLabels.messageId, ids)) : [];
  const contacts = await contactsFor(ctx, [...new Set(list.filter((m) => m.fromEmail && m.fromEmail !== a.address).map((m) => m.fromEmail))]);
  return list.map((m) => ({
    id: m.id, threadId: m.threadId, folder: m.folder, isDraft: m.folder === "drafts", mine: m.fromEmail === a.address,
    from: { name: m.fromName, email: m.fromEmail }, to: m.toAddrs, cc: m.ccAddrs, bcc: m.folder === "sent" || m.folder === "drafts" ? m.bccAddrs : [],
    subject: m.subject, date: iso(m.date), isRead: m.isRead, isStarred: m.isStarred, snippet: m.snippet,
    bodyText: m.bodyText, bodyHtml: m.bodyHtml, hasRemoteImages: m.hasRemoteImages,
    attachments: atts.filter((x) => x.messageId === m.id).map((x) => ({
      id: x.id, name: x.name, contentType: x.contentType, sizeBytes: x.sizeBytes, risky: RISKY.test(x.name),
    })),
    labels: labs.filter((l) => l.messageId === m.id).map((l) => ({ id: l.id, name: l.name, color: l.color })),
    /** The sender, when they are already a contact. */
    contact: contacts.get(m.fromEmail) ?? null,
  }));
}

export async function getThread(ctx: ModuleContext, threadId: string, inFolder?: string) {
  const uid = await me(ctx);
  const a = await needAccount(ctx, uid);
  const where = inFolder === "trash" || inFolder === "spam"
    ? and(eq(messages.threadId, threadId), eq(messages.folder, inFolder))
    : and(eq(messages.threadId, threadId), ne(messages.folder, "trash"), ne(messages.folder, "spam"), ne(messages.folder, "drafts"));
  const list = await ctx.db.select().from(messages).where(where).orderBy(asc(messages.date), asc(messages.id));
  if (!list.length) throw E.notFound("Conversation");
  const dtos = await messageDtos(ctx, a, list);
  return { id: threadId, subject: list[0]!.subject || "(no subject)", messages: dtos };
}

export async function getMessage(ctx: ModuleContext, id: string) {
  const uid = await me(ctx);
  const a = await needAccount(ctx, uid);
  const [m] = await ctx.db.select().from(messages).where(eq(messages.id, id));
  if (!m) throw E.notFound("Message");
  return (await messageDtos(ctx, a, [m]))[0]!;
}

// ── Changing mail ────────────────────────────────────────────────────────────
export async function patchMessage(ctx: ModuleContext, id: string, input: z.infer<typeof MessagePatch>) {
  await me(ctx);
  const [m] = await ctx.db.update(messages).set({
    ...(input.isRead !== undefined ? { isRead: input.isRead } : {}), ...(input.isStarred !== undefined ? { isStarred: input.isStarred } : {}), remoteDirty: true, updatedAt: new Date(),
  }).where(eq(messages.id, id)).returning({ id: messages.id });
  if (!m) throw E.notFound("Message");
  return { ok: true };
}

/** Acts on whole conversations at once (one, or many selected in the list). */
export async function act(ctx: ModuleContext, input: z.infer<typeof ActionInput>) {
  const uid = await me(ctx);
  const a = await needAccount(ctx, uid);
  const ids = input.ids;
  const inThreads = inArray(messages.threadId, ids);
  const now = new Date();
  const upd = (set: Partial<typeof messages.$inferInsert>, where: SQL | undefined) =>
    ctx.db.update(messages).set({ ...set, remoteDirty: true, updatedAt: now }).where(and(inThreads, where));
  switch (input.action) {
    case "read": await upd({ isRead: true }, undefined); break;
    case "unread": {
      // Only the newest received message turns unread (like Gmail), so one click undoes "mark as read".
      await ctx.db.execute(sql`update mail_messages set is_read = false, remote_dirty = true, updated_at = now() where id in (
        select distinct on (thread_id) id from mail_messages where thread_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
          and folder in ('inbox','archive','spam','trash') order by thread_id, date desc)`);
      break;
    }
    case "star": {
      await ctx.db.execute(sql`update mail_messages set is_starred = true, remote_dirty = true, updated_at = now() where id in (
        select distinct on (thread_id) id from mail_messages where thread_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
          and folder not in ('trash','spam') order by thread_id, date desc)`);
      break;
    }
    case "unstar": await upd({ isStarred: false }, undefined); break;
    case "archive": await upd({ folder: "archive" }, eq(messages.folder, "inbox")); break;
    case "spam": await upd({ folder: "spam", trashedAt: now }, inArray(messages.folder, ["inbox", "archive"])); break;
    case "inbox":
      await upd({ folder: sql`case when ${messages.fromEmail} = ${a.address} then 'sent' else 'inbox' end` as unknown as Folder },
        inArray(messages.folder, ["archive", "trash", "spam"]));
      await ctx.db.update(messages).set({ trashedAt: null }).where(and(inThreads, inArray(messages.folder, ["inbox", "sent"])));
      break;
    case "trash":
      await upd({ folder: "trash", trashedAt: now }, inArray(messages.folder, ["inbox", "archive", "sent", "spam"]));
      await ctx.db.delete(messages).where(and(inThreads, eq(messages.folder, "drafts")));
      break;
    case "delete":
      await tombstone(ctx, sql`m.thread_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) and m.folder in ('trash','spam')`);
      await ctx.db.delete(messages).where(and(inThreads, inArray(messages.folder, ["trash", "spam", "drafts"])));
      break;
    case "label": case "unlabel": {
      if (!input.labelId) throw E.badRequest("Choose a label");
      const [l] = await ctx.db.select({ id: labels.id }).from(labels).where(eq(labels.id, input.labelId));
      if (!l) throw E.notFound("Label");
      const list = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
      if (input.action === "label") {
        await ctx.db.execute(sql`insert into mail_message_labels (tenant_id, user_id, message_id, label_id)
          select m.tenant_id, m.user_id, m.id, ${input.labelId}::uuid from mail_messages m where m.thread_id in (${list}) on conflict do nothing`);
      } else {
        await ctx.db.execute(sql`delete from mail_message_labels where label_id = ${input.labelId}::uuid
          and message_id in (select id from mail_messages where thread_id in (${list}))`);
      }
      break;
    }
  }
  return { ok: true };
}

export async function emptyTrash(ctx: ModuleContext) {
  await me(ctx);
  await tombstone(ctx, sql`m.folder in ('trash','spam')`);
  await ctx.db.delete(messages).where(inArray(messages.folder, ["trash", "spam"]));
  return { ok: true };
}

// ── Labels ───────────────────────────────────────────────────────────────────
export async function createLabel(ctx: ModuleContext, input: z.infer<typeof LabelInput>) {
  const uid = await me(ctx);
  const [dupe] = await ctx.db.select({ id: labels.id }).from(labels).where(sql`lower(${labels.name}) = ${input.name.toLowerCase()}`);
  if (dupe) throw E.conflict("You already have a label with that name");
  const [row] = await ctx.db.insert(labels).values({ id: uuidv7(), tenantId: ctx.tenantId, userId: uid, name: input.name, color: input.color }).returning();
  return { id: row!.id, name: row!.name, color: row!.color, unread: 0 };
}
export async function updateLabel(ctx: ModuleContext, id: string, input: z.infer<typeof LabelPatch>) {
  await me(ctx);
  if (input.name) {
    const [dupe] = await ctx.db.select({ id: labels.id }).from(labels).where(and(sql`lower(${labels.name}) = ${input.name.toLowerCase()}`, ne(labels.id, id)));
    if (dupe) throw E.conflict("You already have a label with that name");
  }
  const [row] = await ctx.db.update(labels).set({ ...(input.name ? { name: input.name } : {}), ...(input.color ? { color: input.color } : {}) }).where(eq(labels.id, id)).returning();
  if (!row) throw E.notFound("Label");
  return { id: row.id, name: row.name, color: row.color };
}
export async function deleteLabel(ctx: ModuleContext, id: string) {
  await me(ctx);
  const gone = await ctx.db.delete(labels).where(eq(labels.id, id)).returning({ id: labels.id });
  if (!gone.length) throw E.notFound("Label");
}

// ── Writing: drafts, attachments, sending ────────────────────────────────────
const quoteOf = (m: Message) => {
  const who = m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail;
  const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(m.date));
  return `On ${when} UTC, ${who} wrote:\n${m.bodyText.split("\n").map((l) => `> ${l}`).join("\n")}`;
};
const withSignature = (a: Account, body: string) => (a.signature.trim() ? `${body}\n\n-- \n${a.signature.trim()}` : body);

export async function createDraft(ctx: ModuleContext, input: z.infer<typeof DraftInput>) {
  const uid = await me(ctx);
  const a = await needAccount(ctx, uid, { active: true });
  let v: Partial<typeof messages.$inferInsert> = {
    threadId: uuidv7(), toAddrs: cleanAddrs(input.to ?? []), subject: input.subject ?? "", bodyText: withSignature(a, input.text ?? ""),
  };
  let copyFrom: string | null = null;
  if (input.replyTo) {
    const [p] = await ctx.db.select().from(messages).where(eq(messages.id, input.replyTo));
    if (!p) throw E.notFound("Message");
    const mine = p.fromEmail === a.address;
    let to: Addr[] = mine ? p.toAddrs : [{ name: p.fromName, email: p.fromEmail }], cc: Addr[] = [];
    if (input.all) {
      const everyone = [...p.toAddrs, ...p.ccAddrs];
      const have = new Set(to.map((x) => x.email));
      cc = everyone.filter((x) => x.email !== a.address && !have.has(x.email) && (have.add(x.email), true));
    }
    v = {
      threadId: p.threadId, toAddrs: to, ccAddrs: cc, subject: /^re:/i.test(p.subject) ? p.subject : `Re: ${p.subject}`,
      inReplyTo: p.messageIdHdr, refs: [...p.refs, ...(p.messageIdHdr ? [p.messageIdHdr] : [])].slice(-30),
      bodyText: withSignature(a, "") + `\n\n${quoteOf(p)}`,
    };
  } else if (input.forwardOf) {
    const [p] = await ctx.db.select().from(messages).where(eq(messages.id, input.forwardOf));
    if (!p) throw E.notFound("Message");
    const names = (l: Addr[]) => l.map((x) => (x.name ? `${x.name} <${x.email}>` : x.email)).join(", ");
    copyFrom = p.hasAttachments ? p.id : null;
    v = {
      threadId: uuidv7(), toAddrs: cleanAddrs(input.to ?? []),
      subject: /^(fwd?):/i.test(p.subject) ? p.subject : `Fwd: ${p.subject}`,
      bodyText: withSignature(a, "") + `\n\n---------- Forwarded message ----------\nFrom: ${p.fromName ? `${p.fromName} <${p.fromEmail}>` : p.fromEmail}\nDate: ${iso(p.date)}\nSubject: ${p.subject}\nTo: ${names(p.toAddrs)}\n\n${p.bodyText}`,
    };
  }
  const id = uuidv7();
  await ctx.db.insert(messages).values({
    ...v, id, tenantId: ctx.tenantId, userId: uid, accountId: a.id, folder: "drafts", fromName: a.displayName, fromEmail: a.address,
    subjectNorm: normSubject(v.subject ?? ""), snippet: snippetOf(v.bodyText ?? ""), isRead: true, date: new Date(),
  } as typeof messages.$inferInsert);
  if (copyFrom) {
    await ctx.db.execute(sql`insert into mail_attachments (id, tenant_id, user_id, message_id, name, content_type, size_bytes, data)
      select gen_random_uuid(), tenant_id, user_id, ${id}::uuid, name, content_type, size_bytes, data from mail_attachments where message_id = ${copyFrom}::uuid`);
    await ctx.db.update(messages).set({ hasAttachments: true }).where(eq(messages.id, id));
  }
  return getMessage(ctx, id);
}

async function loadDraft(ctx: ModuleContext, id: string): Promise<Message> {
  const [m] = await ctx.db.select().from(messages).where(and(eq(messages.id, id), eq(messages.folder, "drafts"))).for("update");
  if (!m) throw E.notFound("Draft");
  return m;
}

export async function saveDraft(ctx: ModuleContext, id: string, input: z.infer<typeof DraftPatch>) {
  await me(ctx);
  const d = await loadDraft(ctx, id);
  const text = input.text ?? d.bodyText, subject = input.subject ?? d.subject;
  await ctx.db.update(messages).set({
    ...(input.to ? { toAddrs: cleanAddrs(input.to) } : {}), ...(input.cc ? { ccAddrs: cleanAddrs(input.cc) } : {}), ...(input.bcc ? { bccAddrs: cleanAddrs(input.bcc) } : {}),
    subject, subjectNorm: normSubject(subject), bodyText: text, snippet: snippetOf(text), date: new Date(), updatedAt: new Date(),
  }).where(eq(messages.id, id));
  return getMessage(ctx, id);
}

export async function deleteDraft(ctx: ModuleContext, id: string) {
  await me(ctx);
  await loadDraft(ctx, id);
  await ctx.db.delete(messages).where(eq(messages.id, id));
}

export async function addAttachment(ctx: ModuleContext, draftId: string, input: z.infer<typeof AttachmentInput>) {
  const uid = await me(ctx);
  const d = await loadDraft(ctx, draftId);
  const name = safeName(input.name);
  if (RISKY.test(name)) throw E.badRequest("Programs and scripts can't be attached (they can carry viruses). Put them in a zip file or share a link.");
  const data = Buffer.from(input.data, "base64");
  if (!data.length) throw E.badRequest("The file is empty");
  if (data.length > MAX_FILE_BYTES) throw E.badRequest("Files can be at most 5 MB");
  const [used] = await rows<{ n: number }>(ctx, sql`select coalesce(sum(size_bytes), 0)::int as n from mail_attachments where message_id = ${draftId}::uuid`);
  if ((used?.n ?? 0) + data.length > MAX_TOTAL_BYTES) throw E.badRequest("A message can carry at most 10 MB of files");
  const id = uuidv7();
  await ctx.db.insert(attachments).values({ id, tenantId: ctx.tenantId, userId: uid, messageId: d.id, name, contentType: safeType(input.contentType), sizeBytes: data.length, data });
  await ctx.db.update(messages).set({ hasAttachments: true, updatedAt: new Date() }).where(eq(messages.id, d.id));
  return { id, name, contentType: safeType(input.contentType), sizeBytes: data.length, risky: false };
}

export async function removeAttachment(ctx: ModuleContext, draftId: string, attId: string) {
  await me(ctx);
  await loadDraft(ctx, draftId);
  const gone = await ctx.db.delete(attachments).where(and(eq(attachments.id, attId), eq(attachments.messageId, draftId))).returning({ id: attachments.id });
  if (!gone.length) throw E.notFound("Attachment");
  const [left] = await rows<{ n: number }>(ctx, sql`select count(*)::int as n from mail_attachments where message_id = ${draftId}::uuid`);
  await ctx.db.update(messages).set({ hasAttachments: (left?.n ?? 0) > 0 }).where(eq(messages.id, draftId));
}

/** Hands the file over as base64 (the app turns it into a download). Never served as a page, so nothing in it can run. */
export async function downloadAttachment(ctx: ModuleContext, id: string) {
  await me(ctx);
  const [a] = await ctx.db.select().from(attachments).where(eq(attachments.id, id));
  if (!a) throw E.notFound("Attachment");
  return { name: a.name, contentType: safeType(a.contentType), sizeBytes: a.sizeBytes, data: a.data.toString("base64") };
}

export async function sendDraft(ctx: ModuleContext, id: string) {
  const uid = await me(ctx);
  const a = await needAccount(ctx, uid, { active: true });
  const p = needProvider();
  const d = await loadDraft(ctx, id);
  const to = d.toAddrs, cc = d.ccAddrs, bcc = d.bccAddrs;
  const all = [...to, ...cc, ...bcc];
  if (!all.length) throw E.badRequest("Add at least one person to send it to");
  if (all.length > MAX_RECIPIENTS) throw E.badRequest(`At most ${MAX_RECIPIENTS} people`);
  const bad = all.find((x) => !EMAIL.test(x.email));
  if (bad) throw E.badRequest(`"${bad.email}" isn't a valid email address`);
  if ((await storage(ctx)).full) throw new ModuleError(409, "mailbox_full", FULL);
  const [today] = await rows<{ n: number }>(ctx, sql`select count(*)::int as n from mail_messages where folder = 'sent' and date > now() - interval '24 hours'`);
  if ((today?.n ?? 0) >= MAX_SENDS_PER_DAY) throw E.badRequest("You've reached today's sending limit. Try again tomorrow.");
  const files = await ctx.db.select().from(attachments).where(eq(attachments.messageId, id));
  const messageId = `<${randomUUID()}@${a.address.split("@")[1] ?? "office.local"}>`;
  const text = d.bodyText;
  const out = await viaProvider(() => p.send({ address: a.address, providerRef: a.providerRef }, {
    from: { name: a.displayName, email: a.address }, to, cc, bcc, subject: d.subject, text,
    html: `<div style="white-space:pre-wrap">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>`,
    messageId, inReplyTo: d.inReplyTo, references: d.refs, files: files.map((f) => ({ name: f.name, contentType: f.contentType, data: f.data })),
  }));
  // The mail server's id for its copy in Sent (if it keeps one), so later moves and deletes reach it too.
  const sentUid = out && typeof out === "object" ? out.uid : null;
  await ctx.db.update(messages).set({ folder: "sent", messageIdHdr: messageId, remoteUid: sentUid, date: new Date(), isRead: true, updatedAt: new Date() }).where(eq(messages.id, id));
  return getMessage(ctx, id);
}

// ── CRM: the sender as a contact or a lead (no code shared with those modules) ──
function senderOf(m: Message, a: Account) {
  if (!m.fromEmail || m.fromEmail === a.address) throw E.badRequest("That message is from you");
  const name = m.fromName.trim() || m.fromEmail.split("@")[0]!;
  const parts = name.split(/\s+/);
  return { name, email: m.fromEmail, firstName: parts[0]!, lastName: parts.slice(1).join(" ") || null };
}

export async function addContact(ctx: ModuleContext, id: string) {
  const uid = await me(ctx);
  const a = await needAccount(ctx, uid);
  const [m] = await ctx.db.select().from(messages).where(eq(messages.id, id));
  if (!m) throw E.notFound("Message");
  const s = senderOf(m, a);
  const known = await contactsFor(ctx, [s.email]);
  const hit = known.get(s.email);
  if (hit) return { contactId: hit.id, name: hit.name, created: false };
  const c = await ctx.data.contacts.create({ firstName: s.firstName, lastName: s.lastName, email: s.email });
  return { contactId: String(c.id), name: s.name, created: true };
}

export async function addLead(ctx: ModuleContext, id: string) {
  const uid = await me(ctx);
  const a = await needAccount(ctx, uid);
  const [m] = await ctx.db.select().from(messages).where(eq(messages.id, id));
  if (!m) throw E.notFound("Message");
  const s = senderOf(m, a);
  // Leads (if it is on for this business) listens for this and adds the lead.
  await ctx.events.emit("mail.lead.requested", { name: s.name, email: s.email, subject: m.subject.slice(0, 300), requestedBy: uid });
  await ctx.audit.log("mail.lead.requested", { type: "mail_message", id }, { email: s.email });
  return { requested: true };
}
