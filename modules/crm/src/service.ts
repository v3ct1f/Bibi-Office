import { and, asc, desc, eq, ilike, isNull, isNotNull, lt, max, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "@office/db";
import { moduleErrors as E, type ModuleContext } from "@office/sdk";
import { activities, deals, stages, type DealStatus } from "./schema.ts";

// ───────────────────────── settings ─────────────────────────
export interface CrmSettings { currency: string; staleAfterDays: number }
export const SETTINGS_SCHEMA = {
  type: "object",
  properties: {
    currency: { type: "string", title: "Default currency", default: "EUR", pattern: "^[A-Z]{3}$" },
    staleAfterDays: { type: "integer", title: "Flag deals with no stage change after (days)", default: 30, minimum: 1, maximum: 365 },
  },
  additionalProperties: false,
} as const;
export const settingsOf = (ctx: ModuleContext): CrmSettings => ({ currency: "EUR", staleAfterDays: 30, ...ctx.settings.get<Partial<CrmSettings>>() });

export const DEFAULT_STAGES = [
  { name: "Lead", probability: 10 }, { name: "Qualified", probability: 25 },
  { name: "Proposal", probability: 50 }, { name: "Negotiation", probability: 75 },
];

// ───────────────────────── input schemas ─────────────────────────
const money = z.number().int().min(0).max(1e15).describe("minor units, e.g. cents");
export const StageIn = z.object({ name: z.string().trim().min(1).max(80), probability: z.number().int().min(0).max(100).default(0) });
export const StagePatch = StageIn.partial();
export const DealIn = z.object({
  title: z.string().trim().min(1).max(300),
  value: money.default(0),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  stageId: z.uuid().optional(),
  contactId: z.uuid().nullish(),
  companyId: z.uuid().nullish(),
  ownerId: z.uuid().nullish(),
  expectedClose: z.iso.date().nullish(),
  notes: z.string().max(4000).nullish(),
});
export const DealPatch = DealIn.omit({ stageId: true }).partial();
export const DealQuery = z.object({
  status: z.enum(["open", "won", "lost"]).optional(),
  stageId: z.uuid().optional(), contactId: z.uuid().optional(), companyId: z.uuid().optional(), ownerId: z.uuid().optional(),
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
});
export const ActivityIn = z.object({
  type: z.enum(["note", "call", "email", "meeting", "task"]).default("note"),
  subject: z.string().trim().min(1).max(300),
  body: z.string().max(10000).nullish(),
  dealId: z.uuid().nullish(), contactId: z.uuid().nullish(), companyId: z.uuid().nullish(),
  dueAt: z.iso.datetime({ offset: true }).nullish(),
  done: z.boolean().optional(),
});
export const ActivityPatch = z.object({
  subject: z.string().trim().min(1).max(300).optional(), body: z.string().max(10000).nullish(),
  dueAt: z.iso.datetime({ offset: true }).nullish(), done: z.boolean().optional(),
});
export const ActivityQuery = z.object({
  dealId: z.uuid().optional(), contactId: z.uuid().optional(), companyId: z.uuid().optional(),
  open: z.enum(["true", "false"]).optional().describe("only tasks not done"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ───────────────────────── stages ─────────────────────────
export async function seedStages(ctx: ModuleContext) {
  const [one] = await ctx.db.select({ id: stages.id }).from(stages).limit(1);
  if (one) return;
  await ctx.db.insert(stages).values(DEFAULT_STAGES.map((s, i) => ({ id: uuidv7(), tenantId: ctx.tenantId, position: i, ...s })));
}
export const listStages = (ctx: ModuleContext) => ctx.db.select().from(stages).orderBy(asc(stages.position), asc(stages.id));

export async function createStage(ctx: ModuleContext, input: z.infer<typeof StageIn>) {
  const [{ m }] = await ctx.db.select({ m: max(stages.position) }).from(stages) as [{ m: number | null }];
  const [row] = await ctx.db.insert(stages).values({ id: uuidv7(), tenantId: ctx.tenantId, position: (m ?? -1) + 1, ...input }).returning();
  await ctx.audit.log("stage.created", { type: "stage", id: row!.id }, input);
  return row!;
}
export async function updateStage(ctx: ModuleContext, id: string, input: z.infer<typeof StagePatch>) {
  const [row] = await ctx.db.update(stages).set(input).where(eq(stages.id, id)).returning();
  if (!row) throw E.notFound("Stage");
  await ctx.audit.log("stage.updated", { type: "stage", id }, input);
  return row;
}
export async function deleteStage(ctx: ModuleContext, id: string) {
  const [d] = await ctx.db.select({ id: deals.id }).from(deals).where(eq(deals.stageId, id)).limit(1);
  if (d) throw E.conflict("This stage still has deals. Move them to another stage first.");
  const all = await listStages(ctx);
  if (all.length <= 1) throw E.conflict("A pipeline needs at least one stage");
  const r = await ctx.db.delete(stages).where(eq(stages.id, id)).returning({ id: stages.id });
  if (!r.length) throw E.notFound("Stage");
  await ctx.audit.log("stage.deleted", { type: "stage", id });
}
export async function reorderStages(ctx: ModuleContext, ids: string[]) {
  const all = await listStages(ctx);
  if (ids.length !== all.length || new Set(ids).size !== ids.length || !all.every((s) => ids.includes(s.id))) {
    throw E.unprocessable("Send every stage id exactly once");
  }
  for (const [i, id] of ids.entries()) await ctx.db.update(stages).set({ position: i }).where(eq(stages.id, id));
  await ctx.audit.log("stage.reordered", undefined, { ids });
  return listStages(ctx);
}

// ───────────────────────── deals ─────────────────────────
type DealRow = typeof deals.$inferSelect;
export const dealDto = (r: DealRow, staleAfterDays = 30) => ({
  id: r.id, title: r.title, value: r.value, currency: r.currency, stageId: r.stageId, status: r.status,
  contactId: r.contactId, companyId: r.companyId, ownerId: r.ownerId, expectedClose: r.expectedClose, notes: r.notes,
  lostReason: r.lostReason, closedAt: r.closedAt, stageChangedAt: r.stageChangedAt,
  stale: r.status === "open" && Date.now() - r.stageChangedAt.getTime() > staleAfterDays * 86_400_000,
  createdAt: r.createdAt, updatedAt: r.updatedAt,
});
export type DealDto = ReturnType<typeof dealDto>;

/** Versioned payload (v1) for all crm.deal.* events. `dealId` + `amount` form the contract invoicing consumes on crm.deal.won. */
const dealPayload = (r: DealRow) => ({
  v: 1, id: r.id, dealId: r.id, title: r.title, amount: r.value, value: r.value, currency: r.currency, status: r.status,
  stageId: r.stageId, contactId: r.contactId, companyId: r.companyId, ownerId: r.ownerId, expectedClose: r.expectedClose,
});

async function loadDeal(ctx: ModuleContext, id: string, lock = false) {
  const q = ctx.db.select().from(deals).where(eq(deals.id, id));
  const [r] = lock ? await q.for("update") : await q;
  if (!r) throw E.notFound("Deal");
  return r;
}
async function stageOrThrow(ctx: ModuleContext, id: string) {
  const [s] = await ctx.db.select().from(stages).where(eq(stages.id, id));
  if (!s) throw E.unprocessable("Unknown stage");
  return s;
}
async function checkRefs(ctx: ModuleContext, r: { contactId?: string | null | undefined; companyId?: string | null | undefined }) {
  if (r.contactId) await ctx.data.contacts.get(r.contactId);
  if (r.companyId) await ctx.data.companies.get(r.companyId);
}

export async function getDeal(ctx: ModuleContext, id: string) {
  const r = await loadDeal(ctx, id);
  const [stage] = await ctx.db.select().from(stages).where(eq(stages.id, r.stageId));
  return { ...dealDto(r, settingsOf(ctx).staleAfterDays), stage: stage ? { id: stage.id, name: stage.name, probability: stage.probability } : null };
}

export async function listDeals(ctx: ModuleContext, q: z.infer<typeof DealQuery>) {
  const w: SQL[] = [];
  if (q.status) w.push(eq(deals.status, q.status));
  if (q.stageId) w.push(eq(deals.stageId, q.stageId));
  if (q.contactId) w.push(eq(deals.contactId, q.contactId));
  if (q.companyId) w.push(eq(deals.companyId, q.companyId));
  if (q.ownerId) w.push(eq(deals.ownerId, q.ownerId));
  if (q.cursor) w.push(lt(deals.id, q.cursor));
  if (q.q) w.push(ilike(deals.title, `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`));
  const rows = await ctx.db.select().from(deals).where(w.length ? and(...w) : undefined).orderBy(desc(deals.id)).limit(q.limit + 1);
  const page = rows.slice(0, q.limit), stale = settingsOf(ctx).staleAfterDays;
  return { data: page.map((r) => dealDto(r, stale)), nextCursor: rows.length > q.limit ? page.at(-1)!.id : null };
}

/** Stages in order, each with its open deals (newest first, max 200) and totals per currency. */
export async function board(ctx: ModuleContext) {
  const [st, open] = await Promise.all([
    listStages(ctx),
    ctx.db.select().from(deals).where(eq(deals.status, "open")).orderBy(desc(deals.id)).limit(2000),
  ]);
  const stale = settingsOf(ctx).staleAfterDays;
  return {
    stages: st.map((s) => {
      const ds = open.filter((d) => d.stageId === s.id);
      const totals: Record<string, number> = {};
      for (const d of ds) totals[d.currency] = (totals[d.currency] ?? 0) + d.value;
      return { id: s.id, name: s.name, probability: s.probability, position: s.position, count: ds.length, totals, deals: ds.slice(0, 200).map((d) => dealDto(d, stale)) };
    }),
  };
}

export async function createDeal(ctx: ModuleContext, raw: z.input<typeof DealIn>) {
  const input = DealIn.parse(raw);
  await checkRefs(ctx, input);
  const stageId = input.stageId ?? (await listStages(ctx))[0]?.id;
  if (!stageId) throw E.unprocessable("Create a pipeline stage first");
  await stageOrThrow(ctx, stageId);
  const ownerId = input.ownerId === undefined ? (ctx.actor.type === "user" ? ctx.actor.userId ?? null : null) : input.ownerId;
  const [row] = await ctx.db.insert(deals).values({
    id: uuidv7(), tenantId: ctx.tenantId, title: input.title, value: input.value, currency: input.currency ?? settingsOf(ctx).currency,
    stageId, status: "open", contactId: input.contactId ?? null, companyId: input.companyId ?? null, ownerId,
    expectedClose: input.expectedClose ?? null, notes: input.notes ?? null, createdBy: ctx.actor.id,
  }).returning();
  await ctx.audit.log("deal.created", { type: "deal", id: row!.id }, { title: row!.title, value: row!.value });
  await ctx.events.emit("crm.deal.created", dealPayload(row!));
  return row!;
}

export async function updateDeal(ctx: ModuleContext, id: string, raw: z.input<typeof DealPatch>) {
  const input = DealPatch.parse(raw);
  await loadDeal(ctx, id, true);
  await checkRefs(ctx, input);
  const [row] = await ctx.db.update(deals).set({ ...input, updatedAt: new Date() }).where(eq(deals.id, id)).returning();
  await ctx.audit.log("deal.updated", { type: "deal", id }, input);
  return row!;
}

export async function deleteDeal(ctx: ModuleContext, id: string) {
  const r = await loadDeal(ctx, id, true);
  await ctx.db.delete(deals).where(eq(deals.id, id));
  await ctx.audit.log("deal.deleted", { type: "deal", id }, { title: r.title });
}

export async function moveDeal(ctx: ModuleContext, id: string, stageId: string) {
  const r = await loadDeal(ctx, id, true);
  if (r.status !== "open") throw E.conflict("Reopen the deal before moving it");
  if (r.stageId === stageId) return r;
  const to = await stageOrThrow(ctx, stageId);
  const [row] = await ctx.db.update(deals).set({ stageId, stageChangedAt: new Date(), updatedAt: new Date() }).where(eq(deals.id, id)).returning();
  await ctx.audit.log("deal.moved", { type: "deal", id }, { from: r.stageId, to: stageId });
  await ctx.events.emit("crm.deal.stage_changed", { ...dealPayload(row!), fromStageId: r.stageId, toStageName: to.name });
  return row!;
}

export async function closeDeal(ctx: ModuleContext, id: string, outcome: "won" | "lost", reason?: string) {
  const r = await loadDeal(ctx, id, true);
  if (r.status !== "open") throw E.conflict(`Deal is already ${r.status}`);
  const [row] = await ctx.db.update(deals).set({
    status: outcome as DealStatus, closedAt: new Date(), lostReason: outcome === "lost" ? reason ?? null : null, updatedAt: new Date(),
  }).where(eq(deals.id, id)).returning();
  await ctx.audit.log(`deal.${outcome}`, { type: "deal", id }, { value: r.value, reason });
  await ctx.events.emit(`crm.deal.${outcome}`, { ...dealPayload(row!), ...(outcome === "lost" ? { reason: reason ?? null } : {}) });
  return row!;
}

export async function reopenDeal(ctx: ModuleContext, id: string) {
  const r = await loadDeal(ctx, id, true);
  if (r.status === "open") throw E.conflict("Deal is already open");
  const [row] = await ctx.db.update(deals).set({ status: "open", closedAt: null, lostReason: null, updatedAt: new Date() })
    .where(eq(deals.id, id)).returning();
  await ctx.audit.log("deal.reopened", { type: "deal", id }, { was: r.status });
  await ctx.events.emit("crm.deal.reopened", dealPayload(row!));
  return row!;
}

// ───────────────────────── activities ─────────────────────────
type ActivityRow = typeof activities.$inferSelect;
export const activityDto = (a: ActivityRow) => ({
  id: a.id, type: a.type, subject: a.subject, body: a.body, dealId: a.dealId, contactId: a.contactId, companyId: a.companyId,
  dueAt: a.dueAt, doneAt: a.doneAt, overdue: !a.doneAt && !!a.dueAt && a.dueAt.getTime() < Date.now(),
  createdBy: a.createdBy, createdAt: a.createdAt,
});
const activityPayload = (a: ActivityRow) => ({
  v: 1, id: a.id, type: a.type, subject: a.subject, dealId: a.dealId, contactId: a.contactId, companyId: a.companyId,
  dueAt: a.dueAt?.toISOString() ?? null, doneAt: a.doneAt?.toISOString() ?? null,
});

export async function listActivities(ctx: ModuleContext, q: z.infer<typeof ActivityQuery>) {
  const w: SQL[] = [];
  if (q.dealId) w.push(eq(activities.dealId, q.dealId));
  if (q.contactId) w.push(eq(activities.contactId, q.contactId));
  if (q.companyId) w.push(eq(activities.companyId, q.companyId));
  if (q.open === "true") w.push(isNull(activities.doneAt), isNotNull(activities.dueAt));
  const rows = await ctx.db.select().from(activities).where(w.length ? and(...w) : undefined)
    .orderBy(q.open === "true" ? asc(activities.dueAt) : desc(activities.createdAt)).limit(q.limit);
  return { data: rows.map(activityDto) };
}

export async function createActivity(ctx: ModuleContext, raw: z.input<typeof ActivityIn>) {
  const input = ActivityIn.parse(raw);
  if (!input.dealId && !input.contactId && !input.companyId) throw E.unprocessable("Link the activity to a deal, contact or company");
  let { contactId, companyId } = input;
  if (input.dealId) {   // inherit the deal's contact/company so it shows on their timelines too
    const d = await loadDeal(ctx, input.dealId);
    contactId ??= d.contactId; companyId ??= d.companyId;
  }
  await checkRefs(ctx, { contactId, companyId });
  const done = input.done ?? input.type !== "task";
  const [row] = await ctx.db.insert(activities).values({
    id: uuidv7(), tenantId: ctx.tenantId, type: input.type, subject: input.subject, body: input.body ?? null,
    dealId: input.dealId ?? null, contactId: contactId ?? null, companyId: companyId ?? null,
    dueAt: input.dueAt ? new Date(input.dueAt) : null, doneAt: done ? new Date() : null, createdBy: ctx.actor.id,
  }).returning();
  await ctx.audit.log("activity.created", { type: "activity", id: row!.id }, { type: row!.type });
  await ctx.events.emit("crm.activity.created", activityPayload(row!));
  return row!;
}

export async function updateActivity(ctx: ModuleContext, id: string, raw: z.input<typeof ActivityPatch>) {
  const input = ActivityPatch.parse(raw);
  const [a] = await ctx.db.select().from(activities).where(eq(activities.id, id)).for("update");
  if (!a) throw E.notFound("Activity");
  const completing = input.done === true && !a.doneAt;
  const [row] = await ctx.db.update(activities).set({
    ...(input.subject !== undefined ? { subject: input.subject } : {}),
    ...(input.body !== undefined ? { body: input.body ?? null } : {}),
    ...(input.dueAt !== undefined ? { dueAt: input.dueAt ? new Date(input.dueAt) : null } : {}),
    ...(input.done !== undefined ? { doneAt: input.done ? a.doneAt ?? new Date() : null } : {}),
    updatedAt: new Date(),
  }).where(eq(activities.id, id)).returning();
  await ctx.audit.log("activity.updated", { type: "activity", id }, input);
  if (completing) await ctx.events.emit("crm.activity.completed", activityPayload(row!));
  return row!;
}

export async function deleteActivity(ctx: ModuleContext, id: string) {
  const r = await ctx.db.delete(activities).where(eq(activities.id, id)).returning({ id: activities.id });
  if (!r.length) throw E.notFound("Activity");
  await ctx.audit.log("activity.deleted", { type: "activity", id });
}

// ───────────────────────── summary ─────────────────────────
/** Per currency: open pipeline value, probability-weighted value, won/lost this calendar month (UTC). */
export async function summary(ctx: ModuleContext) {
  const monthStart = sql`date_trunc('month', now())`;
  const rows = await ctx.db.select({
    currency: deals.currency,
    openCount: sql<number>`count(*) filter (where ${deals.status} = 'open')::int`,
    openValue: sql<string>`coalesce(sum(${deals.value}) filter (where ${deals.status} = 'open'), 0)`,
    weighted: sql<string>`coalesce(round(sum(${deals.value} * ${stages.probability} / 100.0) filter (where ${deals.status} = 'open')), 0)`,
    wonCount: sql<number>`count(*) filter (where ${deals.status} = 'won' and ${deals.closedAt} >= ${monthStart})::int`,
    wonValue: sql<string>`coalesce(sum(${deals.value}) filter (where ${deals.status} = 'won' and ${deals.closedAt} >= ${monthStart}), 0)`,
    lostCount: sql<number>`count(*) filter (where ${deals.status} = 'lost' and ${deals.closedAt} >= ${monthStart})::int`,
  }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).groupBy(deals.currency).orderBy(deals.currency);
  const [{ due }] = await ctx.db.select({ due: sql<number>`count(*)::int` }).from(activities)
    .where(and(isNull(activities.doneAt), isNotNull(activities.dueAt), sql`${activities.dueAt} < now() + interval '1 day'`)) as [{ due: number }];
  return {
    data: rows.map((r) => ({ ...r, openValue: Number(r.openValue), weighted: Number(r.weighted), wonValue: Number(r.wonValue) })),
    tasksDue: due,
  };
}
