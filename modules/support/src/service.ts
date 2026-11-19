import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "@office/db";
import { moduleErrors as E, type ModuleContext } from "@office/sdk";
import { check, fetchNew, MailError, mailErrorText, send, type Mailbox, type Security } from "./mail.ts";
import { cleanSubject, firstName, parseIncoming, renderTemplate, textToHtml, ticketToken } from "./parse.ts";
import { files, macros, messages, PRIORITIES, STATUSES, sync, targets, tickets, type Priority, type Status } from "./schema.ts";

export const P = {
  READ: "support:tickets.read",    // see tickets and conversations
  REPLY: "support:tickets.reply",  // reply, add notes, assign, change status/priority, create tickets, check mail
  MANAGE: "support:inbox.manage",  // saved replies, response targets, test the mailbox, delete tickets
} as const;

const MAX_FILE = 10 * 1024 * 1024;
const me = (ctx: ModuleContext) => ctx.actor.userId ?? null;
export const ticketRef = (seq: number) => `#${seq}`;

// ───────── Mailbox settings ─────────
type S = Partial<Record<"address" | "fromName" | "folder" | "imapHost" | "imapSecurity" | "imapUser" | "smtpHost" | "smtpSecurity" | "smtpUser", string>> & { imapPort?: number; smtpPort?: number };
const LABEL: Record<string, string> = {
  address: "Support email address", imapHost: "Incoming server (IMAP)", imapUser: "IMAP user name", imapPassword: "IMAP password",
  smtpHost: "Outgoing server (SMTP)", smtpUser: "SMTP user name", smtpPassword: "SMTP password",
};
/** The company's mailbox from module settings (passwords are sealed secrets), and which fields are still missing. */
export function mailboxOf(ctx: ModuleContext): { mailbox: Mailbox | null; missing: string[]; address: string | null } {
  const s = ctx.settings.get<S>();
  const imapPass = ctx.secrets.get("imapPassword"), smtpPass = ctx.secrets.get("smtpPassword");
  const v = { address: s.address, imapHost: s.imapHost, imapUser: s.imapUser || s.address, imapPassword: imapPass, smtpHost: s.smtpHost, smtpUser: s.smtpUser || s.address, smtpPassword: smtpPass };
  const missing = Object.entries(v).filter(([, x]) => !x).map(([k]) => LABEL[k]!);
  if (missing.length) return { mailbox: null, missing, address: s.address ?? null };
  const sec = (x: string | undefined, d: Security): Security => (x === "tls" || x === "starttls" || x === "none" ? x : d);
  const imapSecurity = sec(s.imapSecurity, "tls"), smtpSecurity = sec(s.smtpSecurity, "tls");
  return {
    address: s.address!, missing: [],
    mailbox: {
      address: s.address!, fromName: s.fromName || "Support", folder: s.folder || "INBOX",
      imap: { host: s.imapHost!, port: s.imapPort ?? (imapSecurity === "tls" ? 993 : 143), security: imapSecurity, user: v.imapUser!, pass: imapPass! },
      smtp: { host: s.smtpHost!, port: s.smtpPort ?? (smtpSecurity === "tls" ? 465 : 587), security: smtpSecurity, user: v.smtpUser!, pass: smtpPass! },
    },
  };
}
const domainOf = (address: string) => address.split("@")[1] ?? "support.local";
const mailboxKey = (mb: Mailbox) => `${mb.imap.user.toLowerCase()}@${mb.imap.host.toLowerCase()}/${mb.folder}`;

// ───────── Response-time targets ─────────
export const DEFAULT_TARGETS: Record<Priority, { firstResponseMin: number | null; resolutionMin: number | null }> = {
  urgent: { firstResponseMin: 60, resolutionMin: 8 * 60 },
  high: { firstResponseMin: 4 * 60, resolutionMin: 24 * 60 },
  normal: { firstResponseMin: 8 * 60, resolutionMin: 48 * 60 },
  low: { firstResponseMin: 24 * 60, resolutionMin: 5 * 24 * 60 },
};
export async function listTargets(ctx: ModuleContext) {
  const rows = await ctx.db.select().from(targets);
  return PRIORITIES.map((p) => {
    const r = rows.find((x) => x.priority === p);
    return { priority: p, ...(r ? { firstResponseMin: r.firstResponseMin, resolutionMin: r.resolutionMin } : DEFAULT_TARGETS[p]) };
  });
}
const minutes = z.number().int("Whole minutes").min(1, "At least 1 minute").max(525_600, "At most a year").nullable();
export const TargetsInput = z.array(z.object({ priority: z.enum(PRIORITIES), firstResponseMin: minutes, resolutionMin: minutes }).strict()).length(4)
  .refine((a) => new Set(a.map((x) => x.priority)).size === 4, "Give each priority once");
export async function saveTargets(ctx: ModuleContext, input: z.infer<typeof TargetsInput>) {
  for (const t of input) {
    if (t.firstResponseMin && t.resolutionMin && t.resolutionMin < t.firstResponseMin) throw E.badRequest(`For ${t.priority} priority, the resolution target can't be shorter than the first response target`);
  }
  await ctx.db.delete(targets);
  await ctx.db.insert(targets).values(input.map((t) => ({ tenantId: ctx.tenantId, ...t })));
  // Open tickets follow the new targets.
  for (const t of input) {
    await ctx.db.update(tickets).set({
      firstResponseDue: t.firstResponseMin ? sql`${tickets.createdAt} + make_interval(mins => ${t.firstResponseMin})` : null,
      resolutionDue: t.resolutionMin ? sql`${tickets.createdAt} + make_interval(mins => ${t.resolutionMin})` : null,
    }).where(and(eq(tickets.priority, t.priority), ne(tickets.status, "solved")));
  }
  await ctx.audit.log("targets.updated", undefined, { targets: input });
  return listTargets(ctx);
}
async function dueDates(ctx: ModuleContext, priority: Priority, from: Date) {
  const t = (await listTargets(ctx)).find((x) => x.priority === priority)!;
  return {
    firstResponseDue: t.firstResponseMin ? new Date(from.getTime() + t.firstResponseMin * 60_000) : null,
    resolutionDue: t.resolutionMin ? new Date(from.getTime() + t.resolutionMin * 60_000) : null,
  };
}

// ───────── DTOs ─────────
type TicketRow = typeof tickets.$inferSelect;
type MessageRow = typeof messages.$inferSelect;
async function peopleNames(ctx: ModuleContext) {
  const people = await ctx.people.list();
  return { people, name: (id: string | null) => (id ? people.find((p) => p.userId === id)?.name ?? "Former member" : null) };
}
const overdueOf = (t: TicketRow, now = Date.now()) => ({
  firstResponse: t.status !== "solved" && !t.firstResponseAt && !!t.firstResponseDue && t.firstResponseDue.getTime() < now,
  resolution: t.status !== "solved" && !!t.resolutionDue && t.resolutionDue.getTime() < now,
});
const ticketDto = (t: TicketRow, name: (id: string | null) => string | null) => ({
  id: t.id, number: t.seq, ref: ticketRef(t.seq), subject: t.subject, status: t.status, priority: t.priority, channel: t.channel,
  requesterEmail: t.requesterEmail, requesterName: t.requesterName, contactId: t.contactId, assigneeId: t.assigneeId, assigneeName: name(t.assigneeId),
  firstResponseAt: t.firstResponseAt, firstResponseDue: t.firstResponseDue, resolutionDue: t.resolutionDue, solvedAt: t.solvedAt,
  lastMessageAt: t.lastMessageAt, lastInboundAt: t.lastInboundAt, createdAt: t.createdAt, overdue: overdueOf(t),
});

// ───────── Tickets: list / get ─────────
export const VIEWS = ["mine", "unassigned", "open", "pending", "solved", "overdue", "all"] as const;
export const TicketQuery = z.object({
  view: z.enum(VIEWS).default("open"), q: z.string().trim().max(200).optional(), priority: z.enum(PRIORITIES).optional(),
  assigneeId: z.uuid().optional(), contactId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).default(0),
});
const OVERDUE = sql`(${tickets.status} <> 'solved' AND ((${tickets.firstResponseAt} IS NULL AND ${tickets.firstResponseDue} < now()) OR ${tickets.resolutionDue} < now()))`;
function viewWhere(ctx: ModuleContext, v: (typeof VIEWS)[number]): SQL | undefined {
  switch (v) {
    case "mine": return and(eq(tickets.assigneeId, me(ctx) ?? "00000000-0000-0000-0000-000000000000"), ne(tickets.status, "solved"));
    case "unassigned": return and(isNull(tickets.assigneeId), ne(tickets.status, "solved"));
    case "open": return eq(tickets.status, "open");
    case "pending": return eq(tickets.status, "pending");
    case "solved": return eq(tickets.status, "solved");
    case "overdue": return OVERDUE;
    default: return undefined;
  }
}
export async function listTickets(ctx: ModuleContext, q: z.infer<typeof TicketQuery>) {
  const conds: (SQL | undefined)[] = [viewWhere(ctx, q.view)];
  if (q.priority) conds.push(eq(tickets.priority, q.priority));
  if (q.assigneeId) conds.push(eq(tickets.assigneeId, q.assigneeId));
  if (q.contactId) conds.push(eq(tickets.contactId, q.contactId));
  if (q.q) {
    const num = /^#?(\d{1,9})$/.exec(q.q);
    const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(or(
      num ? eq(tickets.seq, Number(num[1])) : undefined, ilike(tickets.subject, like), ilike(tickets.requesterEmail, like), ilike(tickets.requesterName, like),
      sql`EXISTS (SELECT 1 FROM support_messages m WHERE m.ticket_id = ${tickets.id} AND m.body ILIKE ${like})`,
    ));
  }
  const where = and(...conds);
  const rows = await ctx.db.select().from(tickets).where(where)
    .orderBy(q.view === "solved" ? desc(tickets.solvedAt) : sql`${tickets.priority} = 'urgent' DESC, ${tickets.priority} = 'high' DESC`, desc(tickets.lastMessageAt))
    .limit(q.limit).offset(q.offset);
  const [{ n }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(tickets).where(where) as [{ n: number }];
  const { name } = await peopleNames(ctx);
  const previews = rows.length ? await ctx.db.selectDistinctOn([messages.ticketId], { ticketId: messages.ticketId, body: messages.body, kind: messages.kind })
    .from(messages).where(and(inArray(messages.ticketId, rows.map((r) => r.id)), ne(messages.kind, "note")))
    .orderBy(messages.ticketId, desc(messages.createdAt)) : [];
  return {
    total: n, counts: await counts(ctx),
    data: rows.map((t) => {
      const p = previews.find((x) => x.ticketId === t.id);
      return { ...ticketDto(t, name), preview: p ? p.body.replace(/\s+/g, " ").slice(0, 140) : "", lastFrom: p?.kind === "inbound" ? "customer" as const : "us" as const };
    }),
  };
}
export async function counts(ctx: ModuleContext) {
  const [c] = await ctx.db.select({
    mine: sql<number>`count(*) FILTER (WHERE ${tickets.assigneeId} = ${me(ctx) ?? "00000000-0000-0000-0000-000000000000"} AND ${tickets.status} <> 'solved')::int`,
    unassigned: sql<number>`count(*) FILTER (WHERE ${tickets.assigneeId} IS NULL AND ${tickets.status} <> 'solved')::int`,
    open: sql<number>`count(*) FILTER (WHERE ${tickets.status} = 'open')::int`,
    pending: sql<number>`count(*) FILTER (WHERE ${tickets.status} = 'pending')::int`,
    overdue: sql<number>`count(*) FILTER (WHERE ${OVERDUE})::int`,
  }).from(tickets);
  return c!;
}

async function loadTicket(ctx: ModuleContext, id: string) {
  const [t] = await ctx.db.select().from(tickets).where(eq(tickets.id, id));
  if (!t) throw E.notFound("Ticket");
  return t;
}
const messageDto = (m: MessageRow, name: (id: string | null) => string | null, atts: { id: string; messageId: string; name: string; contentType: string; sizeBytes: number }[]) => ({
  id: m.id, kind: m.kind, authorName: name(m.authorId), fromEmail: m.fromEmail, fromName: m.fromName, to: m.toEmails, cc: m.ccEmails,
  body: m.body, sendStatus: m.sendStatus, sendError: m.sendError, sentAt: m.sentAt, createdAt: m.createdAt,
  attachments: atts.filter((a) => a.messageId === m.id).map(({ messageId: _m, ...a }) => a),
});
export async function getTicket(ctx: ModuleContext, id: string) {
  const t = await loadTicket(ctx, id);
  const ms = await ctx.db.select().from(messages).where(eq(messages.ticketId, id)).orderBy(asc(messages.createdAt), asc(messages.id));
  const atts = ms.length ? await ctx.db.select({ id: files.id, messageId: files.messageId, name: files.name, contentType: files.contentType, sizeBytes: files.sizeBytes })
    .from(files).where(inArray(files.messageId, ms.map((m) => m.id))).orderBy(asc(files.createdAt)) : [];
  const { name } = await peopleNames(ctx);
  const others = t.requesterEmail ? await ctx.db.select().from(tickets)
    .where(and(ne(tickets.id, id), or(sql`lower(${tickets.requesterEmail}) = lower(${t.requesterEmail})`, t.contactId ? eq(tickets.contactId, t.contactId) : undefined)))
    .orderBy(desc(tickets.createdAt)).limit(10) : [];
  let contact: { id: string; name: string; phone: string | null; companyId: string | null } | null = null;
  if (t.contactId) {
    try {
      const c = await ctx.data.contacts.get(t.contactId);
      contact = { id: t.contactId, name: [c.firstName, c.lastName].filter(Boolean).join(" ") || String(c.email ?? ""), phone: (c.phone as string | null) ?? null, companyId: (c.companyId as string | null) ?? null };
    } catch { contact = null; }
  }
  return {
    ...ticketDto(t, name), contact,
    messages: ms.map((m) => messageDto(m, name, atts)),
    otherTickets: others.map((o) => ({ id: o.id, ref: ticketRef(o.seq), subject: o.subject, status: o.status, createdAt: o.createdAt })),
  };
}

// ───────── Contacts ─────────
async function linkContact(ctx: ModuleContext, email: string, name: string | null): Promise<string | null> {
  try {
    const found = await ctx.data.contacts.list({ q: email, limit: 20 });
    const hit = found.data.find((c) => String(c.email ?? "").toLowerCase() === email.toLowerCase());
    if (hit) return String(hit.id);
    const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
    const created = await ctx.data.contacts.create({ email, firstName: parts[0] ?? null, lastName: parts.slice(1).join(" ") || null });
    return String(created.id);
  } catch (err) {
    ctx.log.warn({ err: (err as Error).message }, "support: could not link contact");
    return null;
  }
}

// ───────── Creating tickets ─────────
async function nextSeq(ctx: ModuleContext) {
  const [{ next }] = await ctx.db.select({ next: sql<number>`coalesce(max(${tickets.seq}), 0)::int + 1` }).from(tickets) as [{ next: number }];
  return next;
}
async function insertTicket(ctx: ModuleContext, v: { subject: string; priority: Priority; channel: "email" | "manual"; email: string | null; name: string | null; assigneeId?: string | null; at?: Date }) {
  const at = v.at ?? new Date();
  const id = uuidv7();
  const seq = await nextSeq(ctx);
  const contactId = v.email ? await linkContact(ctx, v.email, v.name) : null;
  const row = {
    id, tenantId: ctx.tenantId, seq, subject: v.subject.slice(0, 300), status: "open" as Status, priority: v.priority, channel: v.channel,
    requesterEmail: v.email, requesterName: v.name, contactId, assigneeId: v.assigneeId ?? null, ...(await dueDates(ctx, v.priority, at)),
    createdAt: at, lastMessageAt: at,
  };
  await ctx.db.insert(tickets).values(row);
  return row;
}

const email = z.string().trim().toLowerCase().email("Use a valid email address").max(320);
export const NewTicketInput = z.object({
  mode: z.enum(["email", "log"]),
  email: email.nullish(), name: z.string().trim().max(200).nullish(),
  subject: z.string().trim().min(1, "Give the ticket a subject").max(300),
  body: z.string().trim().min(1, "Write the message").max(50_000),
  priority: z.enum(PRIORITIES).default("normal"), assigneeId: z.uuid().nullish(),
}).strict();

/** "email": we write to a customer first (sent now). "log": record something a customer told us by phone or in person. */
export async function createTicket(ctx: ModuleContext, input: z.infer<typeof NewTicketInput>) {
  if (input.mode === "email" && !input.email) throw E.badRequest("Enter the customer's email address");
  if (input.assigneeId) await requireMember(ctx, input.assigneeId);
  if (input.mode === "email" && !mailboxOf(ctx).mailbox) throw E.conflict("Set up the support mailbox first (Support settings) to email customers.");
  const t = await insertTicket(ctx, { subject: input.subject, priority: input.priority, channel: input.mode === "email" ? "email" : "manual", email: input.email ?? null, name: input.name ?? null, assigneeId: input.assigneeId ?? (input.mode === "email" ? me(ctx) : null) });
  if (input.mode === "log") {
    await ctx.db.insert(messages).values({ id: uuidv7(), tenantId: ctx.tenantId, ticketId: t.id, kind: "inbound", authorId: me(ctx), fromEmail: t.requesterEmail, fromName: t.requesterName, body: input.body });
    await ctx.db.update(tickets).set({ lastInboundAt: new Date() }).where(eq(tickets.id, t.id));
  } else {
    await addReply(ctx, t.id, { body: input.body, status: "pending", cc: [] });
  }
  await ctx.events.emit("support.ticket.created", { id: t.id, number: t.seq, subject: t.subject, requesterEmail: t.requesterEmail, channel: t.channel, priority: t.priority });
  await ctx.audit.log("ticket.created", { type: "ticket", id: t.id }, { mode: input.mode });
  return getTicket(ctx, t.id);
}

// ───────── Inbound mail ─────────
export type IngestResult = "created" | "added" | "duplicate" | "ignored";
export async function ingest(ctx: ModuleContext, mb: Mailbox, raw: Buffer | string): Promise<{ result: IngestResult; ticketId?: string; reason?: string }> {
  const m = await parseIncoming(raw);
  if (!m.fromEmail) return { result: "ignored", reason: "no sender" };
  if (m.fromEmail === mb.address.toLowerCase()) return { result: "ignored", reason: "sent by our own mailbox" };
  if (m.autoReply) return { result: "ignored", reason: "automatic reply" };
  if (m.messageId) {
    const [dup] = await ctx.db.select({ id: messages.id }).from(messages).where(eq(messages.messageId, m.messageId));
    if (dup) return { result: "duplicate" };
  }
  // Thread: by the message ids it answers, else by "[#123]" in the subject from the same customer.
  const refs = [...new Set([m.inReplyTo, ...m.references].filter((x): x is string => !!x))];
  let ticket: TicketRow | undefined;
  if (refs.length) {
    const [hit] = await ctx.db.select({ t: tickets }).from(messages).innerJoin(tickets, eq(tickets.id, messages.ticketId))
      .where(inArray(messages.messageId, refs)).orderBy(desc(messages.createdAt)).limit(1);
    ticket = hit?.t;
  }
  const token = ticketToken(m.subject);
  if (!ticket && token) {
    const [hit] = await ctx.db.select().from(tickets).where(and(eq(tickets.seq, token), sql`lower(${tickets.requesterEmail}) = ${m.fromEmail}`));
    ticket = hit;
  }
  // Received time (not the sender's Date header, which can be wrong or older than our last reply).
  const at = new Date();
  let created = false;
  if (!ticket) {
    const t = await insertTicket(ctx, { subject: cleanSubject(m.subject), priority: "normal", channel: "email", email: m.fromEmail, name: m.fromName, at });
    ticket = { ...t, firstResponseAt: null, solvedAt: null, lastInboundAt: null, updatedAt: at } as TicketRow;
    created = true;
  }
  const msgId = uuidv7();
  await ctx.db.insert(messages).values({
    id: msgId, tenantId: ctx.tenantId, ticketId: ticket.id, kind: "inbound", fromEmail: m.fromEmail, fromName: m.fromName,
    toEmails: m.to, ccEmails: m.cc, subject: m.subject, body: m.body, messageId: m.messageId, inReplyTo: m.inReplyTo, refs: m.references.slice(0, 50), createdAt: at,
  });
  for (const a of m.attachments) {
    if (a.content.length > MAX_FILE) continue;
    await ctx.db.insert(files).values({ id: uuidv7(), tenantId: ctx.tenantId, messageId: msgId, name: a.name, contentType: a.contentType.slice(0, 200), sizeBytes: a.content.length, data: a.content });
  }
  const reopen = !created && ticket.status !== "open";
  await ctx.db.update(tickets).set({
    lastMessageAt: at, lastInboundAt: at, updatedAt: new Date(),
    ...(reopen ? { status: "open" as Status, solvedAt: null } : {}),
    ...(!ticket.requesterName && m.fromName ? { requesterName: m.fromName } : {}),
  }).where(eq(tickets.id, ticket.id));
  if (created) {
    await ctx.events.emit("support.ticket.created", { id: ticket.id, number: ticket.seq, subject: ticket.subject, requesterEmail: m.fromEmail, channel: "email", priority: ticket.priority });
  } else {
    await ctx.events.emit("support.ticket.customer_replied", { id: ticket.id, number: ticket.seq, subject: ticket.subject, requesterEmail: m.fromEmail, reopened: reopen, assigneeId: ticket.assigneeId });
  }
  return { result: created ? "created" : "added", ticketId: ticket.id };
}

/** Fetch new mail and turn it into tickets. Used by the every-minute job and the "Check mail now" button. */
export async function checkMail(ctx: ModuleContext) {
  const { mailbox, missing } = mailboxOf(ctx);
  if (!mailbox) return { imported: 0, ignored: 0, error: `Mailbox not set up: ${missing.join(", ")}` };
  const [state] = await ctx.db.select().from(sync);
  const key = mailboxKey(mailbox);
  const from = state && state.mailboxKey === key ? { uidValidity: state.uidValidity, lastUid: state.lastUid } : { uidValidity: null, lastUid: 0 };
  let imported = 0, ignored = 0, error: string | null = null;
  try {
    const got = await fetchNew(mailbox, from);
    for (const msg of got.messages) {
      try {
        const r = await ingest(ctx, mailbox, msg.raw);
        if (r.result === "created" || r.result === "added") imported++; else if (r.result === "ignored") ignored++;
      } catch (err) {
        ignored++;
        ctx.log.error({ err: (err as Error).message, uid: msg.uid }, "support: could not import an email");
      }
    }
    await saveSync(ctx, { mailboxKey: key, uidValidity: got.uidValidity, lastUid: got.lastUid, lastRunAt: new Date(), lastOkAt: new Date(), lastError: null, imported: (state?.mailboxKey === key ? state.imported : 0) + imported });
  } catch (err) {
    error = err instanceof MailError ? err.message : mailErrorText(err);
    await saveSync(ctx, { mailboxKey: state?.mailboxKey ?? key, uidValidity: state?.uidValidity ?? null, lastUid: state?.lastUid ?? 0, lastRunAt: new Date(), lastOkAt: state?.lastOkAt ?? null, lastError: error, imported: state?.imported ?? 0 });
  }
  return { imported, ignored, error };
}
async function saveSync(ctx: ModuleContext, v: Omit<typeof sync.$inferInsert, "tenantId">) {
  await ctx.db.insert(sync).values({ tenantId: ctx.tenantId, ...v }).onConflictDoUpdate({ target: sync.tenantId, set: v });
}

export async function testMailbox(ctx: ModuleContext) {
  const { mailbox, missing } = mailboxOf(ctx);
  if (!mailbox) return { ok: false, smtp: null, imap: null, missing };
  const r = await check(mailbox);
  return { ok: !r.smtp && !r.imap, ...r, missing: [] };
}

// ───────── Replies & notes ─────────
export const ReplyInput = z.object({
  body: z.string().trim().min(1, "Write a reply").max(50_000),
  status: z.enum(STATUSES).default("pending"),
  cc: z.array(email).max(10).default([]),
}).strict();
export const NoteInput = z.object({ body: z.string().trim().min(1, "Write the note").max(50_000) }).strict();

async function sendMessage(ctx: ModuleContext, t: TicketRow, msg: MessageRow): Promise<MessageRow> {
  const { mailbox } = mailboxOf(ctx);
  let status: "sent" | "failed" = "failed", error: string | null = null;
  if (!mailbox) error = "The support mailbox isn't set up";
  else {
    const thread = await ctx.db.select({ id: messages.messageId, kind: messages.kind }).from(messages)
      .where(and(eq(messages.ticketId, t.id), ne(messages.id, msg.id), sql`${messages.messageId} IS NOT NULL`)).orderBy(asc(messages.createdAt));
    const lastInbound = [...thread].reverse().find((x) => x.kind === "inbound")?.id ?? thread[thread.length - 1]?.id ?? null;
    const author = (await peopleNames(ctx)).name(msg.authorId);
    const text = `${msg.body}\n\n--\n${[author, mailbox.fromName].filter(Boolean).join("\n")}`;
    try {
      await send(mailbox, {
        to: msg.toEmails, cc: msg.ccEmails, subject: msg.subject ?? t.subject, text, html: textToHtml(text),
        messageId: msg.messageId!, inReplyTo: lastInbound, references: thread.map((x) => x.id!).slice(-20),
      });
      status = "sent";
    } catch (err) { error = err instanceof MailError ? err.message : mailErrorText(err); }
  }
  const [u] = await ctx.db.update(messages).set({ sendStatus: status, sendError: error, attempts: sql`${messages.attempts} + 1`, sentAt: status === "sent" ? new Date() : null })
    .where(eq(messages.id, msg.id)).returning();
  return u!;
}

export async function addReply(ctx: ModuleContext, ticketId: string, input: z.infer<typeof ReplyInput>) {
  const t = await loadTicket(ctx, ticketId);
  const { mailbox } = mailboxOf(ctx);
  const byEmail = !!t.requesterEmail && t.channel === "email";
  if (byEmail && !mailbox) throw E.conflict("Set up the support mailbox first (Support settings) so replies can be emailed.");
  const now = new Date();
  const [msg] = await ctx.db.insert(messages).values({
    id: uuidv7(), tenantId: ctx.tenantId, ticketId, kind: "reply", authorId: me(ctx),
    fromEmail: byEmail ? mailbox!.address : null, fromName: byEmail ? mailbox!.fromName : null,
    toEmails: byEmail ? [t.requesterEmail!] : [], ccEmails: byEmail ? input.cc : [],
    subject: `Re: ${t.subject} [${ticketRef(t.seq)}]`, body: input.body,
    messageId: byEmail ? `<${uuidv7()}@${domainOf(mailbox!.address)}>` : null, sendStatus: byEmail ? "sending" : null, createdAt: now,
  }).returning();
  const final = byEmail ? await sendMessage(ctx, t, msg!) : msg!;
  const sent = !byEmail || final.sendStatus === "sent";
  await ctx.db.update(tickets).set({
    lastMessageAt: now, updatedAt: now,
    ...(sent && !t.firstResponseAt ? { firstResponseAt: now } : {}),
    ...(sent ? { status: input.status, solvedAt: input.status === "solved" ? now : null } : {}),
    ...(!t.assigneeId && me(ctx) ? { assigneeId: me(ctx) } : {}),
  }).where(eq(tickets.id, ticketId));
  if (sent) {
    await ctx.events.emit("support.ticket.replied", { id: t.id, number: t.seq, subject: t.subject, requesterEmail: t.requesterEmail, status: input.status, byEmail });
    if (input.status !== t.status) await ctx.events.emit("support.ticket.status_changed", { id: t.id, number: t.seq, from: t.status, to: input.status });
  }
  return { message: (await getTicket(ctx, ticketId)).messages.find((m) => m.id === final.id)!, sent, error: final.sendError };
}

export async function retrySend(ctx: ModuleContext, ticketId: string, messageId: string) {
  const t = await loadTicket(ctx, ticketId);
  const [m] = await ctx.db.select().from(messages).where(and(eq(messages.id, messageId), eq(messages.ticketId, ticketId)));
  if (!m) throw E.notFound("Message");
  if (m.sendStatus !== "failed") throw E.conflict(m.sendStatus === "sent" ? "This reply was already sent" : "This message isn't waiting to be sent");
  const u = await sendMessage(ctx, t, m);
  if (u.sendStatus === "sent" && !t.firstResponseAt) await ctx.db.update(tickets).set({ firstResponseAt: new Date() }).where(eq(tickets.id, ticketId));
  return { sent: u.sendStatus === "sent", error: u.sendError };
}

/** Retries replies that failed to send (a few times, a few minutes apart). */
export async function retryFailed(ctx: ModuleContext) {
  const failed = await ctx.db.select().from(messages)
    .where(and(eq(messages.sendStatus, "failed"), sql`${messages.attempts} < 4`, sql`${messages.createdAt} > now() - interval '1 day'`)).limit(20);
  for (const m of failed) {
    const t = await loadTicket(ctx, m.ticketId);
    const u = await sendMessage(ctx, t, m);
    if (u.sendStatus === "sent") {
      await ctx.db.update(tickets).set({ firstResponseAt: sql`coalesce(${tickets.firstResponseAt}, now())` }).where(eq(tickets.id, t.id));
    }
  }
}

export async function addNote(ctx: ModuleContext, ticketId: string, body: string) {
  await loadTicket(ctx, ticketId);
  const id = uuidv7();
  await ctx.db.insert(messages).values({ id, tenantId: ctx.tenantId, ticketId, kind: "note", authorId: me(ctx), body });
  await ctx.db.update(tickets).set({ updatedAt: new Date() }).where(eq(tickets.id, ticketId));
  return (await getTicket(ctx, ticketId)).messages.find((m) => m.id === id)!;
}

// ───────── Ticket fields ─────────
async function requireMember(ctx: ModuleContext, userId: string) {
  if (!(await ctx.people.get(userId))) throw E.badRequest("That person isn't a member of this workspace");
}
export const TicketPatch = z.object({
  status: z.enum(STATUSES).optional(), priority: z.enum(PRIORITIES).optional(), assigneeId: z.uuid().nullable().optional(),
  subject: z.string().trim().min(1, "Give the ticket a subject").max(300).optional(),
}).strict();
export async function updateTicket(ctx: ModuleContext, id: string, patch: z.infer<typeof TicketPatch>) {
  const t = await loadTicket(ctx, id);
  if (patch.assigneeId) await requireMember(ctx, patch.assigneeId);
  const now = new Date();
  await ctx.db.update(tickets).set({
    updatedAt: now,
    ...(patch.subject ? { subject: patch.subject } : {}),
    ...(patch.status ? { status: patch.status, solvedAt: patch.status === "solved" ? (t.solvedAt ?? now) : null } : {}),
    ...(patch.assigneeId !== undefined ? { assigneeId: patch.assigneeId } : {}),
    ...(patch.priority && patch.priority !== t.priority ? { priority: patch.priority, ...(await dueDates(ctx, patch.priority, t.createdAt)) } : {}),
  }).where(eq(tickets.id, id));
  if (patch.status && patch.status !== t.status) await ctx.events.emit("support.ticket.status_changed", { id, number: t.seq, from: t.status, to: patch.status });
  if (patch.assigneeId !== undefined && patch.assigneeId !== t.assigneeId) await ctx.events.emit("support.ticket.assigned", { id, number: t.seq, subject: t.subject, assigneeId: patch.assigneeId });
  await ctx.audit.log("ticket.updated", { type: "ticket", id }, { changes: Object.keys(patch) });
  return getTicket(ctx, id);
}
export async function deleteTicket(ctx: ModuleContext, id: string) {
  const t = await loadTicket(ctx, id);
  await ctx.db.delete(tickets).where(eq(tickets.id, id));
  await ctx.audit.log("ticket.deleted", { type: "ticket", id }, { number: t.seq, subject: t.subject });
}

export async function getFile(ctx: ModuleContext, id: string) {
  const [f] = await ctx.db.select().from(files).where(eq(files.id, id));
  if (!f) throw E.notFound("Attachment");
  return { id: f.id, name: f.name, contentType: f.contentType, data: f.data.toString("base64") };
}

// ───────── Saved replies ─────────
export const MacroInput = z.object({
  name: z.string().trim().min(1, "Name the saved reply").max(80), body: z.string().trim().min(1, "Write the reply text").max(20_000),
}).strict();
export const listMacros = (ctx: ModuleContext) => ctx.db.select({ id: macros.id, name: macros.name, body: macros.body, updatedAt: macros.updatedAt }).from(macros).orderBy(asc(sql`lower(${macros.name})`));
async function uniqueMacro(ctx: ModuleContext, name: string, ignore?: string) {
  const [d] = await ctx.db.select({ id: macros.id }).from(macros).where(and(sql`lower(${macros.name}) = lower(${name})`, ignore ? ne(macros.id, ignore) : undefined));
  if (d) throw E.conflict(`There is already a saved reply called “${name}”`);
}
export async function createMacro(ctx: ModuleContext, input: z.infer<typeof MacroInput>) {
  await uniqueMacro(ctx, input.name);
  const [m] = await ctx.db.insert(macros).values({ id: uuidv7(), tenantId: ctx.tenantId, ...input, createdBy: me(ctx) }).returning();
  return { id: m!.id, name: m!.name, body: m!.body, updatedAt: m!.updatedAt };
}
export async function updateMacro(ctx: ModuleContext, id: string, input: Partial<z.infer<typeof MacroInput>>) {
  if (input.name) await uniqueMacro(ctx, input.name, id);
  const [m] = await ctx.db.update(macros).set({ ...input, updatedAt: new Date() }).where(eq(macros.id, id)).returning();
  if (!m) throw E.notFound("Saved reply");
  return { id: m.id, name: m.name, body: m.body, updatedAt: m.updatedAt };
}
export async function deleteMacro(ctx: ModuleContext, id: string) {
  const r = await ctx.db.delete(macros).where(eq(macros.id, id)).returning({ id: macros.id });
  if (!r.length) throw E.notFound("Saved reply");
}
export async function renderMacro(ctx: ModuleContext, ticketId: string, macroId: string) {
  const t = await loadTicket(ctx, ticketId);
  const [m] = await ctx.db.select().from(macros).where(eq(macros.id, macroId));
  if (!m) throw E.notFound("Saved reply");
  const { name } = await peopleNames(ctx);
  return {
    body: renderTemplate(m.body, {
      "customer.name": t.requesterName ?? t.requesterEmail ?? "", "customer.firstName": firstName(t.requesterName), "customer.email": t.requesterEmail ?? "",
      "ticket.number": String(t.seq), "ticket.subject": t.subject, "agent.name": name(me(ctx)) ?? "",
    }),
  };
}

// ───────── Config & dashboard ─────────
export async function config(ctx: ModuleContext) {
  const { mailbox, missing, address } = mailboxOf(ctx);
  const [s] = await ctx.db.select().from(sync);
  const { people } = await peopleNames(ctx);
  return {
    me: me(ctx), canReply: ctx.authz.can(P.REPLY), canManage: ctx.authz.can(P.MANAGE),
    mailbox: { configured: !!mailbox, address, missing },
    sync: s ? { lastRunAt: s.lastRunAt, lastOkAt: s.lastOkAt, lastError: s.lastError, imported: s.imported } : null,
    people: people.map((p) => ({ userId: p.userId, name: p.name })),
    statuses: STATUSES, priorities: PRIORITIES,
  };
}
export async function summary(ctx: ModuleContext) {
  const c = await counts(ctx);
  const [{ failed }] = await ctx.db.select({ failed: sql<number>`count(*)::int` }).from(messages).where(eq(messages.sendStatus, "failed")) as [{ failed: number }];
  const [s] = await ctx.db.select({ lastError: sync.lastError }).from(sync);
  return { ...c, failedSends: failed, mailError: s?.lastError ?? null };
}
