import { and, asc, desc, eq, ilike, inArray, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "@office/db";
import { moduleErrors as E, type InboundMail, type ModuleContext } from "@office/sdk";
import { counters, messages, tickets, type Channel, type Message, type Priority, type Ticket, type TicketStatus } from "./schema.ts";

export const P = { read: "support:tickets.read", work: "support:tickets.work", manage: "support:tickets.manage" } as const;
const me = (ctx: ModuleContext) => ctx.actor.userId ?? null;

// ───────────────────────── settings ─────────────────────────
export interface SupportSettings {
  teamName: string; publicForm: boolean; formTitle: string; autoAck: boolean; signature: string;
  slaUrgentHours: number; slaHighHours: number; slaNormalHours: number; slaLowHours: number;
}
const hours = (title: string, d: number) => ({ type: "integer", title, default: d, minimum: 1, maximum: 720 });
export const SETTINGS_SCHEMA = {
  type: "object",
  properties: {
    teamName: { type: "string", title: "Team name shown in emails", default: "Support", minLength: 1, maxLength: 80 },
    publicForm: { type: "boolean", title: "Public contact form on", default: true },
    formTitle: { type: "string", title: "Contact form title", default: "", maxLength: 120 },
    autoAck: { type: "boolean", title: "Send an automatic reply to new requests", default: true },
    signature: { type: "string", title: "Signature added to replies", default: "", maxLength: 1000 },
    slaUrgentHours: hours("First reply within (hours): urgent", 1),
    slaHighHours: hours("First reply within (hours): high", 4),
    slaNormalHours: hours("First reply within (hours): normal", 24),
    slaLowHours: hours("First reply within (hours): low", 72),
  },
  additionalProperties: false,
} as const;
export const settingsOf = (ctx: ModuleContext): SupportSettings => ({
  teamName: "Support", publicForm: true, formTitle: "", autoAck: true, signature: "",
  slaUrgentHours: 1, slaHighHours: 4, slaNormalHours: 24, slaLowHours: 72, ...ctx.settings.get<Partial<SupportSettings>>(),
});
const slaHours = (s: SupportSettings, p: Priority) => ({ urgent: s.slaUrgentHours, high: s.slaHighHours, normal: s.slaNormalHours, low: s.slaLowHours })[p];
const dueFrom = (from: Date, s: SupportSettings, p: Priority) => new Date(from.getTime() + slaHours(s, p) * 3_600_000);

// ───────────────────────── input schemas ─────────────────────────
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const email = z.email().max(320).transform((x) => x.toLowerCase());
const body = z.string().trim().min(1, "Write a message").max(20000);
export const TicketIn = z.object({
  subject: z.string().trim().min(1).max(300),
  requesterEmail: email,
  requesterName: z.string().trim().max(200).optional(),
  body,
  priority: z.enum(PRIORITIES).default("normal"),
  assigneeId: z.uuid().nullable().optional(),
});
export const TicketPatch = z.object({
  subject: z.string().trim().min(1).max(300).optional(),
  status: z.enum(["open", "pending", "solved"]).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assigneeId: z.uuid().nullable().optional(),
}).refine((x) => Object.keys(x).length > 0, "Nothing to change");
export const ReplyIn = z.object({ body, status: z.enum(["open", "pending", "solved"]).default("pending") });
export const NoteIn = z.object({ body });
export const ListQuery = z.object({
  view: z.enum(["mine", "unassigned", "open", "pending", "solved", "breached", "all"]).default("open"),
  q: z.string().trim().max(200).optional(),
  contactId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(100).optional(),
});
export const PublicFormIn = z.object({
  name: z.string().trim().min(1).max(200),
  email,
  subject: z.string().trim().min(1).max(300),
  message: z.string().trim().min(1).max(10000),
  website: z.string().max(200).optional(),          // honeypot
});

// ───────────────────────── helpers ─────────────────────────
const payload = (t: Ticket) => ({
  id: t.id, number: t.number, subject: t.subject, status: t.status, priority: t.priority, channel: t.channel,
  requesterEmail: t.requesterEmail, requesterName: t.requesterName, assigneeId: t.assigneeId, contactId: t.contactId,
});
export const ref = (n: number) => `[#${n}]`;

async function nextNumber(ctx: ModuleContext): Promise<number> {
  const [r] = await ctx.db.insert(counters).values({ tenantId: ctx.tenantId, lastNo: 1 })
    .onConflictDoUpdate({ target: counters.tenantId, set: { lastNo: sql`${counters.lastNo} + 1` } }).returning({ n: counters.lastNo });
  return r!.n;
}
async function load(ctx: ModuleContext, id: string, lock = false) {
  const q = ctx.db.select().from(tickets).where(eq(tickets.id, id));
  const [t] = lock ? await q.for("update") : await q;
  if (!t) throw E.notFound("Ticket");
  return t;
}
async function assertMember(ctx: ModuleContext, userId: string) {
  if (!(await ctx.people.names([userId]))[userId]) throw E.unprocessable("That person is not a member of this organization");
}

/** Keep only the new part of an emailed reply: drop quoted history and common "On … wrote:" headers. */
export function stripQuoted(text: string): string {
  const out: string[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const l = line.trim();
    if (out.some((x) => x.trim()) && (/^On .{3,200} wrote:$/.test(l) || /^-{2,}\s*Original Message\s*-{2,}$/i.test(l) || /^_{10,}$/.test(l) || /^From: .+/.test(l))) break;
    if (l.startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
const AUTOMATED = /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounces?)([+@-]|$)/i;

// ───────────────────────── create ─────────────────────────
interface NewTicket {
  subject: string; requesterEmail: string; requesterName?: string | undefined; body: string; channel: Channel; priority?: Priority;
  assigneeId?: string | null | undefined; messageId?: string | undefined;
}
export async function createTicket(ctx: ModuleContext, i: NewTicket) {
  const s = settingsOf(ctx);
  const now = new Date();
  const priority = i.priority ?? "normal";
  if (i.assigneeId) await assertMember(ctx, i.assigneeId);
  const [t] = await ctx.db.insert(tickets).values({
    id: uuidv7(), tenantId: ctx.tenantId, number: await nextNumber(ctx), subject: i.subject.slice(0, 300) || "(no subject)", status: "new", priority,
    channel: i.channel, requesterName: i.requesterName?.slice(0, 200) || null, requesterEmail: i.requesterEmail.toLowerCase(), assigneeId: i.assigneeId ?? null,
    dueAt: dueFrom(now, s, priority), lastMessageAt: now, createdBy: ctx.actor.id, createdAt: now, updatedAt: now,
  }).returning();
  await ctx.db.insert(messages).values({
    id: uuidv7(), tenantId: ctx.tenantId, ticketId: t!.id, kind: "customer", fromEmail: t!.requesterEmail, fromName: t!.requesterName,
    body: i.body.slice(0, 100000) || "(no text)", messageId: i.messageId ?? null, createdAt: now,
  });
  await ctx.audit.log("ticket.created", { type: "support.ticket", id: t!.id }, { number: t!.number, channel: i.channel });
  await ctx.events.emit("support.ticket.created", payload(t!));
  if (t!.assigneeId) await ctx.events.emit("support.ticket.assigned", { ...payload(t!), previousAssigneeId: null });
  return t!;
}

/** Automatic "we got it" email for new requests from outside. Skips robots and repeat senders (max 1 per hour). */
async function autoAck(ctx: ModuleContext, t: Ticket, inReplyTo?: string) {
  const s = settingsOf(ctx);
  if (!s.autoAck || AUTOMATED.test(t.requesterEmail)) return;
  const recent = await ctx.db.select({ id: tickets.id }).from(tickets).where(and(
    eq(tickets.requesterEmail, t.requesterEmail), ne(tickets.id, t.id), sql`${tickets.createdAt} > now() - interval '1 hour'`)).limit(1);
  if (recent.length) return;
  const replyTo = await ctx.mail.inboundAddress();
  await ctx.mail.send({
    to: t.requesterEmail, subject: `${ref(t.number)} ${t.subject}`, fromName: s.teamName, ...(replyTo ? { replyTo } : {}),
    ...(inReplyTo ? { inReplyTo, references: [inReplyTo] } : {}),
    text: [
      `Hello${t.requesterName ? ` ${t.requesterName}` : ""},`, "",
      `We received your request and will get back to you soon. Your reference is ${ref(t.number)}.`,
      replyTo ? "To add anything, reply to this email." : "", "", s.teamName,
    ].filter((x, n, a) => x !== "" || a[n - 1] !== "").join("\n"),
  });
}

export async function createInternalTicket(ctx: ModuleContext, i: z.infer<typeof TicketIn>) {
  if (i.assigneeId && i.assigneeId !== me(ctx)) ctx.authz.require(P.manage);
  const t = await createTicket(ctx, { ...i, channel: "internal" });
  return getTicket(ctx, t.id);
}

export async function submitPublicForm(ctx: ModuleContext, i: z.infer<typeof PublicFormIn>) {
  const s = settingsOf(ctx);
  if (!s.publicForm) throw E.notFound("Page");
  if (i.website) throw E.badRequest("Invalid request");   // honeypot filled: a bot
  const [{ n }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(tickets)
    .where(and(eq(tickets.requesterEmail, i.email), sql`${tickets.createdAt} > now() - interval '1 day'`)) as [{ n: number }];
  if (n >= 5) throw E.conflict("We already received several messages from you today. We'll reply soon.");
  const t = await createTicket(ctx, { subject: i.subject, requesterEmail: i.email, requesterName: i.name, body: i.message, channel: "web" });
  await autoAck(ctx, t);
  return { number: t.number, reference: ref(t.number) };
}

// ───────────────────────── inbound email ─────────────────────────
/** Thread by Message-ID headers, then by "[#123]" in the subject from the same sender; otherwise a new ticket. */
export async function receiveMail(ctx: ModuleContext, m: InboundMail) {
  const from = m.from.email.trim().toLowerCase();
  if (!z.email().safeParse(from).success) { ctx.log.warn({ from }, "support: ignoring mail with invalid sender"); return; }
  if (/^(mailer-daemon|postmaster)@/i.test(from)) { ctx.log.info({ messageId: m.messageId }, "support: ignoring bounce"); return; }
  let ticket: Ticket | undefined;
  const ids = [m.inReplyTo, ...m.references].filter((x): x is string => !!x).slice(-50);
  if (ids.length) {
    const [hit] = await ctx.db.select({ t: messages.ticketId }).from(messages).where(inArray(messages.messageId, ids)).orderBy(desc(messages.createdAt)).limit(1);
    if (hit) ticket = await load(ctx, hit.t, true);
  }
  const num = /\[#(\d{1,9})\]/.exec(m.subject)?.[1];
  if (!ticket && num) {
    const [t] = await ctx.db.select().from(tickets).where(and(eq(tickets.number, Number(num)), eq(tickets.requesterEmail, from))).for("update");
    ticket = t;
  }
  const text = stripQuoted(m.text) || m.text.trim() || "(no text)";
  if (!ticket) {
    const subject = m.subject.replace(/^\s*((re|fwd?|aw|wg)\s*:\s*)+/i, "").trim() || "(no subject)";
    const t = await createTicket(ctx, { subject, requesterEmail: from, requesterName: m.from.name, body: text, channel: "email", messageId: m.messageId });
    await autoAck(ctx, t, m.messageId);
    return;
  }
  const now = new Date();
  await ctx.db.insert(messages).values({
    id: uuidv7(), tenantId: ctx.tenantId, ticketId: ticket.id, kind: "customer", fromEmail: from, fromName: m.from.name?.slice(0, 200) ?? null,
    body: text.slice(0, 100000), messageId: m.messageId, createdAt: now,
  });
  const reopen = ticket.status === "pending" || ticket.status === "solved";
  const [t] = await ctx.db.update(tickets).set({
    lastMessageAt: now, updatedAt: now, ...(reopen ? { status: "open" as const, solvedAt: null } : {}),
  }).where(eq(tickets.id, ticket.id)).returning();
  await ctx.events.emit("support.ticket.customer_replied", payload(t!));
  if (reopen) await ctx.events.emit("support.ticket.status_changed", { ...payload(t!), previousStatus: ticket.status });
}

// ───────────────────────── read ─────────────────────────
const viewWhere = (ctx: ModuleContext, v: z.infer<typeof ListQuery>["view"]): SQL | undefined => {
  const notSolved = ne(tickets.status, "solved");
  switch (v) {
    case "mine": return me(ctx) ? and(eq(tickets.assigneeId, me(ctx)!), notSolved) : sql`false`;
    case "unassigned": return and(isNull(tickets.assigneeId), notSolved);
    case "open": return inArray(tickets.status, ["new", "open"]);
    case "pending": return eq(tickets.status, "pending");
    case "solved": return eq(tickets.status, "solved");
    case "breached": return and(notSolved, isNull(tickets.firstResponseAt), lt(tickets.dueAt, sql`now()`));
    case "all": return undefined;
  }
};

const withNames = async (ctx: ModuleContext, rows: Ticket[]) => {
  const names = await ctx.people.names(rows.map((r) => r.assigneeId).filter((x): x is string => !!x));
  const now = Date.now();
  return rows.map((t) => ({
    ...t, assigneeName: t.assigneeId ? names[t.assigneeId] ?? null : null, reference: ref(t.number),
    overdue: t.status !== "solved" && !t.firstResponseAt && !!t.dueAt && t.dueAt.getTime() < now,
  }));
};

export async function listTickets(ctx: ModuleContext, q: z.infer<typeof ListQuery>) {
  const conds: (SQL | undefined)[] = [q.contactId ? undefined : viewWhere(ctx, q.view)];
  if (q.contactId) conds.push(eq(tickets.contactId, q.contactId));
  if (q.q) {
    const n = /^#?(\d{1,9})$/.exec(q.q)?.[1];
    const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(tickets.subject, like), ilike(tickets.requesterEmail, like), ilike(tickets.requesterName, like), ...(n ? [eq(tickets.number, Number(n))] : [])));
  }
  if (q.cursor) {
    const [at, id] = q.cursor.split("|");
    if (!at || !id || Number.isNaN(Date.parse(at)) || !z.uuid().safeParse(id).success) throw E.badRequest("Invalid cursor");
    conds.push(sql`(${tickets.lastMessageAt}, ${tickets.id}) < (${at}::timestamptz, ${id}::uuid)`);
  }
  const rows = await ctx.db.select().from(tickets).where(and(...conds)).orderBy(desc(tickets.lastMessageAt), desc(tickets.id)).limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return { data: await withNames(ctx, page), nextCursor: rows.length > q.limit && last ? `${last.lastMessageAt.toISOString()}|${last.id}` : null };
}

export async function counts(ctx: ModuleContext) {
  const n = (c: SQL | undefined) => sql<number>`count(*) filter (where ${c ?? sql`true`})::int`;
  const [r] = await ctx.db.select({
    mine: n(viewWhere(ctx, "mine")), unassigned: n(viewWhere(ctx, "unassigned")), open: n(viewWhere(ctx, "open")),
    pending: n(viewWhere(ctx, "pending")), breached: n(viewWhere(ctx, "breached")),
  }).from(tickets);
  return r!;
}

export async function getTicket(ctx: ModuleContext, id: string) {
  const t = await load(ctx, id);
  const msgs = await ctx.db.select().from(messages).where(eq(messages.ticketId, id)).orderBy(asc(messages.createdAt), asc(messages.id));
  const names = await ctx.people.names(msgs.map((m) => m.authorId).filter((x): x is string => !!x));
  const [ticket] = await withNames(ctx, [t]);
  return {
    ...ticket!,
    messages: msgs.map(({ messageId: _m, tenantId: _t, ...m }: Message) => ({ ...m, authorName: m.authorId ? names[m.authorId] ?? "Former member" : null })),
  };
}

// ───────────────────────── change ─────────────────────────
export async function updateTicket(ctx: ModuleContext, id: string, p: z.infer<typeof TicketPatch>) {
  const t = await load(ctx, id, true);
  const set: Partial<Ticket> = { updatedAt: new Date() };
  if (p.assigneeId !== undefined && p.assigneeId !== t.assigneeId) {
    const self = p.assigneeId === me(ctx) || (p.assigneeId === null && t.assigneeId === me(ctx));
    if (!self) ctx.authz.require(P.manage);
    if (p.assigneeId) await assertMember(ctx, p.assigneeId);
    set.assigneeId = p.assigneeId;
  }
  if (p.status && p.status !== t.status) {
    set.status = p.status;
    set.solvedAt = p.status === "solved" ? new Date() : null;
  }
  if (p.priority && p.priority !== t.priority) {
    set.priority = p.priority;
    if (!t.firstResponseAt) { set.dueAt = dueFrom(t.createdAt, settingsOf(ctx), p.priority); set.slaBreachedAt = null; }
  }
  if (p.subject) set.subject = p.subject;
  const [r] = await ctx.db.update(tickets).set(set).where(eq(tickets.id, id)).returning();
  await ctx.audit.log("ticket.updated", { type: "support.ticket", id }, Object.fromEntries(Object.keys(p).map((k) => [k, { from: t[k as keyof Ticket], to: r![k as keyof Ticket] }])));
  if ("assigneeId" in set) await ctx.events.emit("support.ticket.assigned", { ...payload(r!), previousAssigneeId: t.assigneeId });
  if (set.status) await ctx.events.emit("support.ticket.status_changed", { ...payload(r!), previousStatus: t.status });
  return getTicket(ctx, id);
}

/** Email the requester and record the reply. Replies thread with the customer's last message. Unassigned tickets go to the replier. */
export async function reply(ctx: ModuleContext, id: string, i: z.infer<typeof ReplyIn>) {
  const uid = me(ctx);
  if (!uid) throw E.forbidden("Only team members can reply");
  const t = await load(ctx, id, true);
  const s = settingsOf(ctx);
  const thread = await ctx.db.select({ id: messages.messageId, kind: messages.kind }).from(messages)
    .where(and(eq(messages.ticketId, id), sql`${messages.messageId} is not null`)).orderBy(asc(messages.createdAt));
  const lastCustomer = thread.filter((x) => x.kind === "customer").at(-1)?.id ?? thread.at(-1)?.id ?? undefined;
  const replyTo = await ctx.mail.inboundAddress();
  const subject = `${t.channel === "email" ? "Re: " : ""}${ref(t.number)} ${t.subject}`;
  const text = [i.body, ...(s.signature ? ["", s.signature] : []), "", `${s.teamName} · Reference ${ref(t.number)}`].join("\n");
  const { messageId } = await ctx.mail.send({
    to: t.requesterEmail, subject, text, fromName: s.teamName, ...(replyTo ? { replyTo } : {}),
    ...(lastCustomer ? { inReplyTo: lastCustomer } : {}), references: thread.map((x) => x.id!).slice(-20),
  });
  const now = new Date();
  await ctx.db.insert(messages).values({ id: uuidv7(), tenantId: ctx.tenantId, ticketId: id, kind: "reply", authorId: uid, body: i.body, messageId, createdAt: now });
  const [r] = await ctx.db.update(tickets).set({
    status: i.status, solvedAt: i.status === "solved" ? now : null, lastMessageAt: now, updatedAt: now,
    ...(t.firstResponseAt ? {} : { firstResponseAt: now }), ...(t.assigneeId ? {} : { assigneeId: uid }),
  }).where(eq(tickets.id, id)).returning();
  await ctx.audit.log("ticket.replied", { type: "support.ticket", id }, { status: i.status });
  await ctx.events.emit("support.ticket.replied", { ...payload(r!), firstResponse: !t.firstResponseAt });
  if (!t.assigneeId) await ctx.events.emit("support.ticket.assigned", { ...payload(r!), previousAssigneeId: null });
  if (r!.status !== t.status) await ctx.events.emit("support.ticket.status_changed", { ...payload(r!), previousStatus: t.status });
  return getTicket(ctx, id);
}

export async function addNote(ctx: ModuleContext, id: string, i: z.infer<typeof NoteIn>) {
  const uid = me(ctx);
  if (!uid) throw E.forbidden("Only team members can add notes");
  await load(ctx, id, true);
  await ctx.db.insert(messages).values({ id: uuidv7(), tenantId: ctx.tenantId, ticketId: id, kind: "note", authorId: uid, body: i.body });
  await ctx.db.update(tickets).set({ updatedAt: new Date() }).where(eq(tickets.id, id));
  await ctx.audit.log("ticket.note_added", { type: "support.ticket", id });
  return getTicket(ctx, id);
}

/** Job: mark tickets whose first reply is late, once each. */
export async function checkSla(ctx: ModuleContext) {
  const late = await ctx.db.update(tickets).set({ slaBreachedAt: new Date() }).where(and(
    ne(tickets.status, "solved"), isNull(tickets.firstResponseAt), isNull(tickets.slaBreachedAt), lt(tickets.dueAt, sql`now()`),
  )).returning();
  for (const t of late) await ctx.events.emit("support.ticket.sla_breached", { ...payload(t), dueAt: t.dueAt?.toISOString() ?? null });
  return late.length;
}

/** Link a ticket to a core contact by email (find or create). Runs as a system handler. */
export async function linkContact(ctx: ModuleContext, ticketId: string) {
  const [t] = await ctx.db.select().from(tickets).where(eq(tickets.id, ticketId));
  if (!t || t.contactId) return;
  const found = await ctx.data.contacts.list({ q: t.requesterEmail, limit: 25 }) as unknown as { data: { id: string; email: string | null }[] };
  let id = found.data.find((c) => c.email?.toLowerCase() === t.requesterEmail)?.id;
  if (!id) {
    const [first, ...rest] = (t.requesterName || t.requesterEmail.split("@")[0]!).split(/\s+/);
    id = (await ctx.data.contacts.create({ firstName: first, lastName: rest.join(" ") || null, email: t.requesterEmail }) as unknown as { id: string }).id;
  }
  await ctx.db.update(tickets).set({ contactId: id }).where(eq(tickets.id, ticketId));
}

export async function summary(ctx: ModuleContext) {
  const c = await counts(ctx);
  const oldest = await ctx.db.select().from(tickets).where(viewWhere(ctx, "unassigned")).orderBy(asc(tickets.createdAt)).limit(5);
  return { ...c, oldestUnassigned: await withNames(ctx, oldest) };
}

export async function inboxInfo(ctx: ModuleContext) {
  const s = settingsOf(ctx);
  return {
    address: await ctx.mail.inboundAddress(),
    formUrl: s.publicForm ? await ctx.mail.publicPageUrl("/contact") : null,
    teamName: s.teamName,
    sla: { urgent: s.slaUrgentHours, high: s.slaHighHours, normal: s.slaNormalHours, low: s.slaLowHours },
  };
}
