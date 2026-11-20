import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, or, sql, sum, type SQL } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "@office/db";
import { moduleErrors as E, ModuleError, type ModuleContext } from "@office/sdk";
import {
  AiError, DEFAULT_MODEL, estimateTokens, MODEL_LABELS, MODELS, ping, PRICES, summariseMeeting, summariseTicket, type CallResult, type Model,
} from "./claude.ts";
import { actionItems, summaries, usage, VISIBILITY, type Attendee } from "./schema.ts";

export const P = {
  READ: "ai:summary.read",     // see shared summaries and your own
  WRITE: "ai:summary.write",   // create summaries (meetings, tickets), turn action items into tasks
  MANAGE: "ai:summary.manage", // see and change everyone's summaries, test the API key, see usage
} as const;

// ───────── Helpers ─────────
const me = (ctx: ModuleContext) => ctx.actor.userId ?? null;
const canManage = (ctx: ModuleContext) => ctx.authz.can(P.MANAGE);
export const todayIso = () => new Date().toISOString().slice(0, 10);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-31");
const MAX_TEXT = 300_000;

interface Settings { model?: string; language?: string; monthlyTokenLimit?: number }
function settingsOf(ctx: ModuleContext) {
  const s = ctx.settings.get<Settings>();
  const model: Model = (MODELS as readonly string[]).includes(s.model ?? "") ? (s.model as Model) : DEFAULT_MODEL;
  return { model, language: s.language || "auto", limit: s.monthlyTokenLimit ?? 1_000_000, apiKey: ctx.secrets.get("apiKey") ?? "" };
}

const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); };
async function usedThisMonth(ctx: ModuleContext) {
  const [r] = await ctx.db.select({ i: sum(usage.inputTokens), o: sum(usage.outputTokens) }).from(usage).where(gte(usage.at, monthStart()));
  return Number(r?.i ?? 0) + Number(r?.o ?? 0);
}

/** Everything needed before a call: a key, and room left in this month's limit. */
async function ready(ctx: ModuleContext, chars: number) {
  const s = settingsOf(ctx);
  if (!s.apiKey) throw E.badRequest("AI summaries aren't set up yet. An owner or admin needs to add the Anthropic API key in Add features → AI summaries → Settings.");
  if (s.limit > 0) {
    const used = await usedThisMonth(ctx);
    if (used + estimateTokens(chars) > s.limit) {
      throw new ModuleError(429, "limit_reached", `This month's AI limit (${s.limit.toLocaleString("en")} tokens) would be passed. An owner or admin can raise it in the settings.`);
    }
  }
  return s;
}

async function logUsage(ctx: ModuleContext, purpose: "meeting" | "ticket" | "test", u: { model: string; inputTokens: number; outputTokens: number }) {
  await ctx.db.insert(usage).values({ id: uuidv7(), tenantId: ctx.tenantId, purpose, model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, userId: me(ctx) });
}

/** Runs a Claude call; usage is recorded even when the answer can't be used. */
async function run<T>(ctx: ModuleContext, purpose: "meeting" | "ticket" | "test", call: () => Promise<CallResult<T>>): Promise<CallResult<T>> {
  try {
    const r = await call();
    await logUsage(ctx, purpose, r);
    return r;
  } catch (e) {
    const used = (e as { used?: { model: string; inputTokens: number; outputTokens: number } }).used;
    if (used) await logUsage(ctx, purpose, used);
    // A failed but billed call still counts: keepChanges saves the usage record although the request fails.
    if (e instanceof AiError) throw new ModuleError(e.statusCode, e.statusCode === 429 ? "ai_busy" : "ai_error", e.message, { keepChanges: !!used });
    throw e;
  }
}

async function peopleIndex(ctx: ModuleContext) {
  const people = await ctx.people.list();
  const byId = new Map(people.map((p) => [p.userId, p]));
  /** "Max" or "max mustermann" -> the team member, when it's clear who is meant. */
  const match = (name: string | null) => {
    if (!name) return null;
    const n = name.trim().toLowerCase();
    const full = people.filter((p) => p.name.toLowerCase() === n || p.email.toLowerCase() === n);
    if (full.length === 1) return full[0]!;
    const first = people.filter((p) => p.name.toLowerCase().split(/\s+/)[0] === n.split(/\s+/)[0]);
    return first.length === 1 ? first[0]! : null;
  };
  return { people, byId, match, name: (id: string | null) => (id ? byId.get(id)?.name ?? "Former member" : null) };
}

/** Managers see everything; others shared summaries and their own. */
function visibleTo(ctx: ModuleContext): SQL | undefined {
  if (canManage(ctx)) return undefined;
  const u = me(ctx);
  return u ? or(eq(summaries.visibility, "team"), eq(summaries.createdBy, u)) : eq(summaries.visibility, "team");
}
type Row = typeof summaries.$inferSelect;
const canEdit = (ctx: ModuleContext, s: Row) => canManage(ctx) || (!!me(ctx) && s.createdBy === me(ctx) && ctx.authz.can(P.WRITE));

async function load(ctx: ModuleContext, id: string) {
  const [s] = await ctx.db.select().from(summaries).where(and(eq(summaries.id, id), visibleTo(ctx)));
  if (!s) throw E.notFound("Summary");
  return s;
}
async function loadEditable(ctx: ModuleContext, id: string) {
  const s = await load(ctx, id);
  if (!canEdit(ctx, s)) throw E.forbidden("Only the person who made this summary, or an AI summaries manager, can change it");
  return s;
}

async function contactName(ctx: ModuleContext, id: string | null) {
  if (!id || !ctx.authz.can("core:contacts.read")) return null;
  try {
    const c = await ctx.data.contacts.get(id);
    return [c.firstName, c.lastName].filter(Boolean).join(" ") || (c.email as string | null) || "Contact";
  } catch { return null; }
}

// ───────── Config & usage ─────────
export async function config(ctx: ModuleContext) {
  const s = settingsOf(ctx);
  const { people } = await peopleIndex(ctx);
  const base = {
    ready: !!s.apiKey, model: s.model, modelLabel: MODEL_LABELS[s.model], language: s.language,
    canWrite: ctx.authz.can(P.WRITE), canManage: canManage(ctx), canCreateTasks: ctx.authz.can("core:tasks.write"),
    me: me(ctx), people: people.map((p) => ({ userId: p.userId, name: p.name, email: p.email })),
  };
  if (!canManage(ctx)) return { ...base, usage: null };
  return { ...base, usage: { usedThisMonth: await usedThisMonth(ctx), limit: s.limit } };
}

/** Tokens and an estimated cost per month (last 6 months), for managers. */
export async function usageReport(ctx: ModuleContext) {
  const since = new Date(monthStart()); since.setUTCMonth(since.getUTCMonth() - 5);
  const month = sql<string>`to_char(${usage.at} at time zone 'UTC', 'YYYY-MM')`;
  const rows = await ctx.db.select({
    month, model: usage.model, purpose: usage.purpose, calls: count(), i: sum(usage.inputTokens), o: sum(usage.outputTokens),
  }).from(usage).where(gte(usage.at, since)).groupBy(month, usage.model, usage.purpose).orderBy(desc(month));
  const months = new Map<string, { month: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number; meetings: number; tickets: number }>();
  for (const r of rows) {
    const m = months.get(r.month) ?? { month: r.month, calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, meetings: 0, tickets: 0 };
    const i = Number(r.i ?? 0), o = Number(r.o ?? 0), [pi, po] = PRICES[r.model] ?? PRICES[DEFAULT_MODEL]!;
    m.calls += r.calls; m.inputTokens += i; m.outputTokens += o; m.costUsd += (i * pi + o * po) / 1_000_000;
    if (r.purpose === "meeting") m.meetings += r.calls;
    if (r.purpose === "ticket") m.tickets += r.calls;
    months.set(r.month, m);
  }
  return { limit: settingsOf(ctx).limit, months: [...months.values()].map((m) => ({ ...m, costUsd: Math.round(m.costUsd * 100) / 100 })) };
}

export async function testKey(ctx: ModuleContext) {
  const s = await ready(ctx, 0);
  const r = await run(ctx, "test", () => ping(s.apiKey, s.model));
  return { ok: true, model: r.model };
}

// ───────── Reading ─────────
export const ListQuery = z.object({
  kind: z.enum(["meeting", "ticket"]).optional(),
  q: z.string().trim().max(200).optional(),
  contactId: z.uuid().optional(),
  dealId: z.uuid().optional(),
  ticketId: z.uuid().optional(),
  mine: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export async function listSummaries(ctx: ModuleContext, q: z.infer<typeof ListQuery>) {
  const where: (SQL | undefined)[] = [visibleTo(ctx)];
  if (q.kind) where.push(eq(summaries.kind, q.kind));
  if (q.contactId) where.push(eq(summaries.contactId, q.contactId));
  if (q.dealId) where.push(eq(summaries.dealId, q.dealId));
  if (q.ticketId) where.push(eq(summaries.sourceRef, q.ticketId));
  if (q.mine && me(ctx)) where.push(eq(summaries.createdBy, me(ctx)!));
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push(or(ilike(summaries.title, like), ilike(summaries.summary, like)));
  }
  const rows = await ctx.db.select({
    id: summaries.id, kind: summaries.kind, title: summaries.title, visibility: summaries.visibility, meetingDate: summaries.meetingDate,
    sourceRef: summaries.sourceRef, sourceLabel: summaries.sourceLabel, contactId: summaries.contactId, dealId: summaries.dealId,
    summary: summaries.summary, createdBy: summaries.createdBy, createdAt: summaries.createdAt,
  }).from(summaries).where(and(...where)).orderBy(desc(summaries.createdAt)).limit(q.limit);
  const ids = rows.map((r) => r.id);
  const counts = ids.length
    ? await ctx.db.select({ id: actionItems.summaryId, n: count(), open: sql<number>`count(*) filter (where ${actionItems.taskId} is null)` })
      .from(actionItems).where(inArray(actionItems.summaryId, ids)).groupBy(actionItems.summaryId)
    : [];
  const byId = new Map(counts.map((c) => [c.id, c]));
  const { name } = await peopleIndex(ctx);
  return rows.map((r) => ({
    ...r, summary: r.summary.slice(0, 300), createdByName: name(r.createdBy),
    actionItemCount: byId.get(r.id)?.n ?? 0, openActionItems: Number(byId.get(r.id)?.open ?? 0),
  }));
}

export async function getSummary(ctx: ModuleContext, id: string) {
  const s = await load(ctx, id);
  const items = await ctx.db.select().from(actionItems).where(eq(actionItems.summaryId, id)).orderBy(asc(actionItems.position));
  const { name } = await peopleIndex(ctx);
  const { sourceText, ...rest } = s;
  return {
    ...rest, sourceText, sourceChars: sourceText.length, createdByName: name(s.createdBy), contactName: await contactName(ctx, s.contactId),
    canEdit: canEdit(ctx, s),
    actionItems: items.map((i) => ({ id: i.id, text: i.text, ownerName: i.ownerName, ownerUserId: i.ownerUserId, ownerLabel: i.ownerUserId ? name(i.ownerUserId) : i.ownerName, dueOn: i.dueOn, taskId: i.taskId })),
  };
}

// ───────── Creating ─────────
const AttendeeIn = z.object({ name: z.string().trim().min(1).max(200), email: z.email().max(320).optional() });
export const MeetingInput = z.object({
  title: z.string().trim().max(200).optional(),
  text: z.string().max(MAX_TEXT, "The notes can be at most 300,000 characters. Split long meetings into parts.")
    .refine((t) => t.trim().length >= 20, "Paste the meeting notes or transcript (at least a few sentences)"),
  sourceName: z.string().trim().max(255).optional(),
  meetingDate: day.nullable().optional(),
  attendees: z.array(AttendeeIn).max(50).default([]),
  contactId: z.uuid().nullable().optional(),
  dealId: z.uuid().nullable().optional(),
  visibility: z.enum(VISIBILITY).default("team"),
  companyName: z.string().trim().max(200).optional(),
});

async function checkContact(ctx: ModuleContext, id: string | null | undefined) {
  if (!id) return null;
  if (!ctx.authz.can("core:contacts.read")) throw E.forbidden("You can't see contacts, so you can't link one");
  try { await ctx.data.contacts.get(id); } catch { throw E.badRequest("That contact doesn't exist"); }
  return id;
}

async function saveItems(ctx: ModuleContext, summaryId: string, items: { text: string; owner: string | null; due: string | null }[], startAt = 0) {
  if (!items.length) return;
  const { match } = await peopleIndex(ctx);
  await ctx.db.insert(actionItems).values(items.map((i, n) => {
    const who = match(i.owner);
    return { id: uuidv7(), tenantId: ctx.tenantId, summaryId, position: startAt + n, text: i.text, ownerName: i.owner, ownerUserId: who?.userId ?? null, dueOn: i.due };
  }));
}

async function senderName(ctx: ModuleContext) {
  const u = me(ctx);
  return (u ? (await ctx.people.get(u))?.name : null) ?? "The team";
}

export async function createMeeting(ctx: ModuleContext, input: z.infer<typeof MeetingInput>) {
  const contactId = await checkContact(ctx, input.contactId);
  const s = await ready(ctx, input.text.length);
  const { people } = await peopleIndex(ctx);
  const attendees: Attendee[] = input.attendees.map((a) => ({ name: a.name, ...(a.email ? { email: a.email } : {}) }));
  const sender = await senderName(ctx);
  const r = await run(ctx, "meeting", () => summariseMeeting(s.apiKey, s.model, {
    text: input.text, title: input.title, meetingDate: input.meetingDate ?? null, today: todayIso(),
    attendees: attendees.map((a) => a.name), team: people.map((p) => p.name),
    sender, company: input.companyName || "our company", language: s.language,
  }));
  const id = uuidv7();
  const d = r.data;
  await ctx.db.insert(summaries).values({
    id, tenantId: ctx.tenantId, kind: "meeting", title: input.title || d.title || "Meeting", visibility: input.visibility,
    sourceText: input.text, sourceName: input.sourceName || null, meetingDate: input.meetingDate ?? null, attendees,
    contactId, dealId: input.dealId ?? null,
    summary: d.summary || "(No summary)", keyPoints: d.keyPoints, decisions: d.decisions, openQuestions: d.openQuestions,
    followUpSubject: d.followUpSubject || null, followUpBody: d.followUpBody || null,
    model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, createdBy: me(ctx),
  });
  await saveItems(ctx, id, d.actionItems);
  await ctx.events.emit("ai.summary.created", {
    summaryId: id, kind: "meeting", title: input.title || d.title, actionItemCount: d.actionItems.length,
    contactId, dealId: input.dealId ?? null, ticketId: null,
  });
  await ctx.audit.log("ai.summary.create", { type: "ai_summary", id });
  return getSummary(ctx, id);
}

const TicketMessage = z.object({
  kind: z.enum(["inbound", "reply", "note"]),
  from: z.string().trim().max(400).default(""),
  at: z.string().max(40),
  body: z.string().max(100_000),
});
export const TicketInput = z.object({
  ticketId: z.uuid(),
  label: z.string().trim().min(1).max(300),
  subject: z.string().trim().max(300).default(""),
  messages: z.array(TicketMessage).min(1, "This ticket has no messages yet").max(500),
  contactId: z.uuid().nullable().optional(),
  companyName: z.string().trim().max(200).optional(),
});

const WHO: Record<"inbound" | "reply" | "note", string> = { inbound: "Customer", reply: "Our reply", note: "Internal note (not seen by the customer)" };
/** The conversation as plain text, oldest first; long tickets keep the start and the most recent messages. */
export function ticketText(messages: z.infer<typeof TicketMessage>[]) {
  const parts = messages.map((m) => `--- ${WHO[m.kind]}${m.from ? ` from ${m.from}` : ""} · ${m.at.slice(0, 16).replace("T", " ")}\n${m.body.trim()}`);
  let text = parts.join("\n\n");
  if (text.length > MAX_TEXT) {
    const head = parts.slice(0, 2).join("\n\n").slice(0, 40_000);
    const tail: string[] = [];
    let len = head.length;
    for (let i = parts.length - 1; i >= 2 && len + parts[i]!.length < MAX_TEXT - 200; i--) { tail.unshift(parts[i]!); len += parts[i]!.length + 2; }
    text = `${head}\n\n[… older messages left out …]\n\n${tail.join("\n\n")}`;
  }
  return text;
}

export async function createTicketSummary(ctx: ModuleContext, input: z.infer<typeof TicketInput>) {
  const text = ticketText(input.messages);
  if (text.trim().length < 10) throw E.badRequest("There isn't enough in this ticket to summarise yet");
  const s = await ready(ctx, text.length);
  const { people } = await peopleIndex(ctx);
  const agent = await senderName(ctx);
  const r = await run(ctx, "ticket", () => summariseTicket(s.apiKey, s.model, {
    text, subject: input.subject, today: todayIso(), agent, company: input.companyName || "our company",
    team: people.map((p) => p.name), language: s.language,
  }));
  const id = uuidv7();
  const d = r.data;
  await ctx.db.insert(summaries).values({
    id, tenantId: ctx.tenantId, kind: "ticket", title: input.label, visibility: "team", sourceText: text,
    sourceRef: input.ticketId, sourceLabel: input.label, contactId: input.contactId ?? null,
    summary: d.summary || "(No summary)", keyPoints: d.keyPoints, suggestedReply: d.suggestedReply || null,
    model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, createdBy: me(ctx),
  });
  await saveItems(ctx, id, d.actionItems);
  await ctx.events.emit("ai.summary.created", {
    summaryId: id, kind: "ticket", title: input.label, actionItemCount: d.actionItems.length,
    contactId: input.contactId ?? null, dealId: null, ticketId: input.ticketId,
  });
  return getSummary(ctx, id);
}

/** Runs Claude again on the saved text. Action items already turned into tasks are kept. */
export async function regenerate(ctx: ModuleContext, id: string, companyName?: string) {
  const row = await loadEditable(ctx, id);
  const s = await ready(ctx, row.sourceText.length);
  const { people } = await peopleIndex(ctx);
  const team = people.map((p) => p.name);
  const sender = await senderName(ctx);
  const kept = await ctx.db.select({ id: actionItems.id }).from(actionItems).where(and(eq(actionItems.summaryId, id), sql`${actionItems.taskId} is not null`));
  const now = new Date();
  let items: { text: string; owner: string | null; due: string | null }[];
  if (row.kind === "meeting") {
    const r = await run(ctx, "meeting", () => summariseMeeting(s.apiKey, s.model, {
      text: row.sourceText, title: row.title, meetingDate: row.meetingDate, today: todayIso(), attendees: row.attendees.map((a) => a.name), team,
      sender, company: companyName || "our company", language: s.language,
    }));
    const d = r.data;
    items = d.actionItems;
    await ctx.db.update(summaries).set({
      summary: d.summary || "(No summary)", keyPoints: d.keyPoints, decisions: d.decisions, openQuestions: d.openQuestions,
      followUpSubject: d.followUpSubject || null, followUpBody: d.followUpBody || null,
      model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, edited: false, updatedAt: now,
    }).where(eq(summaries.id, id));
  } else {
    const r = await run(ctx, "ticket", () => summariseTicket(s.apiKey, s.model, {
      text: row.sourceText, subject: row.sourceLabel ?? row.title, today: todayIso(), agent: sender, company: companyName || "our company", team, language: s.language,
    }));
    const d = r.data;
    items = d.actionItems;
    await ctx.db.update(summaries).set({
      summary: d.summary || "(No summary)", keyPoints: d.keyPoints, suggestedReply: d.suggestedReply || null,
      model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, edited: false, updatedAt: now,
    }).where(eq(summaries.id, id));
  }
  await ctx.db.delete(actionItems).where(and(eq(actionItems.summaryId, id), isNull(actionItems.taskId)));
  await saveItems(ctx, id, items, kept.length);
  return getSummary(ctx, id);
}

// ───────── Editing ─────────
const lines = z.array(z.string().trim().min(1).max(500)).max(30);
export const SummaryPatch = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(20_000),
  keyPoints: lines, decisions: lines, openQuestions: lines,
  followUpSubject: z.string().trim().max(300).nullable(),
  followUpBody: z.string().trim().max(20_000).nullable(),
  suggestedReply: z.string().trim().max(20_000).nullable(),
  meetingDate: day.nullable(),
  contactId: z.uuid().nullable(),
  dealId: z.uuid().nullable(),
  visibility: z.enum(VISIBILITY),
  actionItems: z.array(z.object({
    id: z.uuid().optional(),
    text: z.string().trim().min(1, "Action items can't be empty").max(500),
    ownerUserId: z.uuid().nullable().optional(),
    ownerName: z.string().trim().max(200).nullable().optional(),
    dueOn: day.nullable().optional(),
  })).max(30),
}).partial().strict();

const CONTENT_KEYS = ["summary", "keyPoints", "decisions", "openQuestions", "followUpSubject", "followUpBody", "suggestedReply", "actionItems"] as const;

export async function updateSummary(ctx: ModuleContext, id: string, p: z.infer<typeof SummaryPatch>) {
  const row = await loadEditable(ctx, id);
  if (p.contactId !== undefined && p.contactId !== row.contactId) await checkContact(ctx, p.contactId);
  const { actionItems: items, ...fields } = p;
  const edited = CONTENT_KEYS.some((k) => p[k] !== undefined);
  await ctx.db.update(summaries).set({ ...fields, ...(edited ? { edited: true } : {}), updatedAt: new Date() }).where(eq(summaries.id, id));
  if (items) {
    const { byId } = await peopleIndex(ctx);
    const existing = await ctx.db.select().from(actionItems).where(eq(actionItems.summaryId, id));
    const keep = new Set(items.map((i) => i.id).filter(Boolean));
    const gone = existing.filter((e) => !keep.has(e.id) && !e.taskId).map((e) => e.id);
    if (gone.length) await ctx.db.delete(actionItems).where(inArray(actionItems.id, gone));
    for (const [n, i] of items.entries()) {
      const owner = i.ownerUserId && byId.has(i.ownerUserId) ? i.ownerUserId : null;
      const values = { position: n, text: i.text, ownerUserId: owner, ownerName: owner ? byId.get(owner)!.name : i.ownerName ?? null, dueOn: i.dueOn ?? null };
      const old = i.id ? existing.find((e) => e.id === i.id) : undefined;
      if (old?.taskId) continue; // already a task: change it in Tasks
      if (old) await ctx.db.update(actionItems).set(values).where(eq(actionItems.id, old.id));
      else await ctx.db.insert(actionItems).values({ id: uuidv7(), tenantId: ctx.tenantId, summaryId: id, ...values });
    }
  }
  return getSummary(ctx, id);
}

export async function deleteSummary(ctx: ModuleContext, id: string) {
  await loadEditable(ctx, id);
  await ctx.db.delete(summaries).where(eq(summaries.id, id));
  await ctx.audit.log("ai.summary.delete", { type: "ai_summary", id });
}

// ───────── Action items → Tasks ─────────
export const TasksInput = z.object({ itemIds: z.array(z.uuid()).min(1, "Pick at least one action item").max(30) });

export async function createTasks(ctx: ModuleContext, id: string, input: z.infer<typeof TasksInput>) {
  const row = await load(ctx, id);
  if (!ctx.authz.can(P.WRITE)) throw E.forbidden("You can't create tasks from summaries");
  if (!ctx.authz.can("core:tasks.write")) throw E.forbidden("You aren't allowed to create tasks");
  const items = await ctx.db.select().from(actionItems)
    .where(and(eq(actionItems.summaryId, id), inArray(actionItems.id, input.itemIds), isNull(actionItems.taskId)))
    .orderBy(asc(actionItems.position));
  const where = row.kind === "ticket" ? `support ticket ${row.sourceLabel ?? row.title}` : `the meeting "${row.title}"${row.meetingDate ? ` on ${row.meetingDate}` : ""}`;
  let created = 0;
  for (const i of items) {
    const task = await ctx.data.tasks.create({
      title: i.text.slice(0, 500),
      description: `Action item from ${where} (AI summary).${i.ownerName && !i.ownerUserId ? `\nOwner mentioned: ${i.ownerName}` : ""}`,
      dueAt: i.dueOn ? new Date(`${i.dueOn}T12:00:00Z`) : null,
      assigneeId: i.ownerUserId,
    });
    await ctx.db.update(actionItems).set({ taskId: task.id as string }).where(eq(actionItems.id, i.id));
    created++;
  }
  if (created) await ctx.events.emit("ai.action_items.tasks_created", { summaryId: id, title: row.title, count: created });
  return { created, summary: await getSummary(ctx, id) };
}
