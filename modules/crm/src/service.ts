import { and, asc, desc, eq, gte, ilike, inArray, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "@office/db";
import { moduleErrors as E, type ModuleContext } from "@office/sdk";
import { activities, deals, pipelines, stages, type ActivityKind, type StageKind } from "./schema.ts";

// ── Settings ─────────────────────────────────────────────────────────────────
export interface Settings { currency: string }
export const settingsOf = (ctx: ModuleContext): Settings => ({ currency: "EUR", ...ctx.settings.get<Partial<Settings>>() });

export const DEFAULT_STAGES: { name: string; probability: number; kind: StageKind }[] = [
  { name: "Lead", probability: 10, kind: "open" },
  { name: "Qualified", probability: 25, kind: "open" },
  { name: "Proposal sent", probability: 50, kind: "open" },
  { name: "Negotiation", probability: 75, kind: "open" },
  { name: "Won", probability: 100, kind: "won" },
  { name: "Lost", probability: 0, kind: "lost" },
];

// ── Input schemas ────────────────────────────────────────────────────────────
const isoDate = z.iso.date();
const opt = (max: number) => z.string().trim().max(max).nullish();
const currency = z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, e.g. EUR");

export const StageInput = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(60),
  probability: z.number().int().min(0).max(100).default(0),
  kind: z.enum(["open", "won", "lost"]).default("open"),
}).strict();
export const PipelineInput = z.object({
  name: z.string().trim().min(1).max(100),
  stages: z.array(StageInput).min(3).max(20).optional(),
}).strict();
export const PipelinePatch = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  stages: z.array(StageInput).min(3).max(20).optional(),
}).strict();

export const DealInput = z.object({
  title: z.string().trim().min(1).max(300),
  valueCents: z.number().int().min(0).max(1e15).default(0),
  currency: currency.optional(),
  pipelineId: z.uuid().optional(),
  stageId: z.uuid().optional(),
  companyId: z.uuid().nullish(),
  contactId: z.uuid().nullish(),
  ownerId: z.uuid().nullish(),
  expectedClose: isoDate.nullish(),
  nextStep: opt(300),
  nextStepDate: isoDate.nullish(),
  notes: opt(10_000),
}).strict();
export const DealPatch = DealInput.omit({ pipelineId: true, stageId: true }).partial().strict();
export const MoveInput = z.object({ stageId: z.uuid(), lostReason: opt(500) }).strict();
export const ActivityInput = z.object({
  kind: z.enum(["note", "call", "meeting", "email"]).default("note"),
  body: z.string().trim().min(1).max(10_000),
}).strict();
export const ListQuery = z.object({
  pipelineId: z.uuid().optional(),
  status: z.enum(["open", "won", "lost"]).optional(),
  companyId: z.uuid().optional(),
  contactId: z.uuid().optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.uuid().optional(),
});
export const BoardQuery = z.object({ pipelineId: z.uuid().optional() });

// ── Helpers ──────────────────────────────────────────────────────────────────
type Deal = typeof deals.$inferSelect;
type Stage = typeof stages.$inferSelect;
const actorRef = (ctx: ModuleContext) => `${ctx.actor.type}:${ctx.actor.id}`;
const today = () => new Date().toISOString().slice(0, 10);

/** First pipeline for the tenant, created with the default stages when there is none (idempotent). */
export async function ensureDefaultPipeline(ctx: ModuleContext) {
  const [p] = await ctx.db.select().from(pipelines).orderBy(asc(pipelines.position), asc(pipelines.id)).limit(1);
  if (p) return p;
  return createPipelineRows(ctx, "Sales", DEFAULT_STAGES, 0);
}

async function createPipelineRows(ctx: ModuleContext, name: string, st: z.input<typeof StageInput>[], position: number) {
  const id = uuidv7();
  const [p] = await ctx.db.insert(pipelines).values({ id, tenantId: ctx.tenantId, name, position }).returning();
  await ctx.db.insert(stages).values(st.map((s, i) => ({
    id: uuidv7(), tenantId: ctx.tenantId, pipelineId: id, name: s.name, position: i, probability: s.probability ?? 0, kind: s.kind ?? "open",
  })));
  return p!;
}

function checkStages(st: z.infer<typeof StageInput>[]) {
  for (const k of ["open", "won", "lost"] as const) {
    if (!st.some((s) => s.kind === k)) throw E.badRequest(`A pipeline needs at least one ${k} stage`);
  }
  const names = new Set(st.map((s) => s.name.toLowerCase()));
  if (names.size !== st.length) throw E.badRequest("Stage names must be unique within a pipeline");
}

async function stagesOf(ctx: ModuleContext, pipelineId: string) {
  return ctx.db.select().from(stages).where(eq(stages.pipelineId, pipelineId)).orderBy(asc(stages.position));
}

async function stageById(ctx: ModuleContext, id: string) {
  const [s] = await ctx.db.select().from(stages).where(eq(stages.id, id));
  if (!s) throw E.badRequest("Unknown stage");
  return s;
}

async function loadDeal(ctx: ModuleContext, id: string, lock = false): Promise<Deal> {
  const q = ctx.db.select().from(deals).where(eq(deals.id, id));
  const [r] = lock ? await q.for("update") : await q;
  if (!r) throw E.notFound("Deal");
  return r;
}

/** Company and contact display names, fetched once per id (core entities; deleted ones are skipped). */
async function customerNames(ctx: ModuleContext, rows: Deal[]) {
  const names = new Map<string, string>();
  const companyIds = [...new Set(rows.map((r) => r.companyId).filter((x): x is string => !!x))];
  const contactIds = [...new Set(rows.map((r) => r.contactId).filter((x): x is string => !!x))];
  await Promise.all([
    ...companyIds.map(async (id) => {
      try { const c = await ctx.data.companies.get(id); names.set(id, String(c.name ?? "Company")); } catch { /* deleted or no access */ }
    }),
    ...contactIds.map(async (id) => {
      try {
        const c = await ctx.data.contacts.get(id);
        names.set(id, [c.firstName, c.lastName].filter(Boolean).join(" ") || String(c.email ?? "Contact"));
      } catch { /* deleted or no access */ }
    }),
  ]);
  return names;
}

const dto = (r: Deal, stage: Pick<Stage, "name" | "kind" | "probability"> | undefined, names: Map<string, string>) => ({
  id: r.id, title: r.title, valueCents: r.valueCents, currency: r.currency, status: r.status,
  pipelineId: r.pipelineId, stageId: r.stageId, stageName: stage?.name ?? null, probability: stage?.probability ?? 0,
  companyId: r.companyId, companyName: r.companyId ? names.get(r.companyId) ?? null : null,
  contactId: r.contactId, contactName: r.contactId ? names.get(r.contactId) ?? null : null,
  ownerId: r.ownerId, expectedClose: r.expectedClose, nextStep: r.nextStep, nextStepDate: r.nextStepDate, notes: r.notes,
  lostReason: r.lostReason, closedAt: r.closedAt, stageChangedAt: r.stageChangedAt, createdAt: r.createdAt, updatedAt: r.updatedAt,
});
export type DealDto = ReturnType<typeof dto>;

async function dtos(ctx: ModuleContext, rows: Deal[]) {
  const names = await customerNames(ctx, rows);
  const ids = [...new Set(rows.map((r) => r.stageId))];
  const st = ids.length ? await ctx.db.select().from(stages).where(inArray(stages.id, ids)) : [];
  const byId = new Map(st.map((s) => [s.id, s]));
  return rows.map((r) => dto(r, byId.get(r.stageId), names));
}

/** Event payload v1 (stable contract for workflows, webhooks and Invoicing's crm.deal.won handler). */
const payload = (r: Deal, stage: Stage) => ({
  id: r.id, title: r.title, valueCents: r.valueCents, currency: r.currency, status: r.status,
  stage: stage.name, stageId: stage.id, pipelineId: r.pipelineId,
  companyId: r.companyId, contactId: r.contactId, ownerId: r.ownerId, expectedClose: r.expectedClose,
});

async function log(ctx: ModuleContext, dealId: string, kind: ActivityKind, body: string) {
  const [a] = await ctx.db.insert(activities).values({ id: uuidv7(), tenantId: ctx.tenantId, dealId, kind, body, createdBy: actorRef(ctx) }).returning();
  return a!;
}

async function checkCustomer(ctx: ModuleContext, companyId?: string | null, contactId?: string | null) {
  try {
    if (companyId) await ctx.data.companies.get(companyId);
    if (contactId) await ctx.data.contacts.get(contactId);
  } catch { throw E.badRequest("Unknown company or contact"); }
}

// ── Pipelines ────────────────────────────────────────────────────────────────
export async function listPipelines(ctx: ModuleContext) {
  await ensureDefaultPipeline(ctx);
  const ps = await ctx.db.select().from(pipelines).orderBy(asc(pipelines.position), asc(pipelines.id));
  const st = await ctx.db.select().from(stages).orderBy(asc(stages.position));
  const counts = await ctx.db.select({ stageId: deals.stageId, n: sql<number>`count(*)::int` }).from(deals).groupBy(deals.stageId);
  const n = new Map(counts.map((c) => [c.stageId, c.n]));
  return ps.map((p) => ({
    id: p.id, name: p.name, position: p.position,
    stages: st.filter((s) => s.pipelineId === p.id).map((s) => ({ id: s.id, name: s.name, position: s.position, probability: s.probability, kind: s.kind, dealCount: n.get(s.id) ?? 0 })),
  }));
}

export async function createPipeline(ctx: ModuleContext, input: z.infer<typeof PipelineInput>) {
  const st = input.stages ?? DEFAULT_STAGES.map((s) => StageInput.parse(s));
  checkStages(st);
  const [{ max } = { max: -1 }] = await ctx.db.select({ max: sql<number>`coalesce(max(${pipelines.position}), -1)::int` }).from(pipelines);
  const p = await createPipelineRows(ctx, input.name, st, max + 1);
  await ctx.audit.log("crm.pipeline.created", { type: "crm_pipeline", id: p.id }, { name: p.name });
  return (await listPipelines(ctx)).find((x) => x.id === p.id)!;
}

export async function updatePipeline(ctx: ModuleContext, id: string, patch: z.infer<typeof PipelinePatch>) {
  const [p] = await ctx.db.select().from(pipelines).where(eq(pipelines.id, id)).for("update");
  if (!p) throw E.notFound("Pipeline");
  if (patch.name) await ctx.db.update(pipelines).set({ name: patch.name }).where(eq(pipelines.id, id));
  if (patch.stages) {
    checkStages(patch.stages);
    const existing = await stagesOf(ctx, id);
    const byId = new Map(existing.map((s) => [s.id, s]));
    const counts = await ctx.db.select({ stageId: deals.stageId, n: sql<number>`count(*)::int` }).from(deals).where(eq(deals.pipelineId, id)).groupBy(deals.stageId);
    const n = new Map(counts.map((c) => [c.stageId, c.n]));
    for (const s of patch.stages) {
      if (s.id && !byId.has(s.id)) throw E.badRequest("Stage does not belong to this pipeline");
      const old = s.id ? byId.get(s.id) : undefined;
      if (old && old.kind !== s.kind && n.get(old.id)) throw E.conflict(`“${old.name}” has deals; move them before changing whether it is open, won or lost`);
    }
    const keep = new Set(patch.stages.map((s) => s.id).filter(Boolean));
    for (const s of existing) {
      if (!keep.has(s.id) && n.get(s.id)) throw E.conflict(`“${s.name}” still has ${n.get(s.id)} deal(s); move them to another stage first`);
    }
    for (const s of existing) if (!keep.has(s.id)) await ctx.db.delete(stages).where(eq(stages.id, s.id));
    for (const [i, s] of patch.stages.entries()) {
      if (s.id) await ctx.db.update(stages).set({ name: s.name, probability: s.probability, kind: s.kind, position: i }).where(eq(stages.id, s.id));
      else await ctx.db.insert(stages).values({ id: uuidv7(), tenantId: ctx.tenantId, pipelineId: id, name: s.name, probability: s.probability, kind: s.kind, position: i });
    }
  }
  await ctx.audit.log("crm.pipeline.updated", { type: "crm_pipeline", id }, patch);
  return (await listPipelines(ctx)).find((x) => x.id === id)!;
}

export async function deletePipeline(ctx: ModuleContext, id: string) {
  const all = await ctx.db.select({ id: pipelines.id }).from(pipelines);
  if (!all.some((p) => p.id === id)) throw E.notFound("Pipeline");
  if (all.length === 1) throw E.conflict("You need at least one pipeline");
  const [{ n } = { n: 0 }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(deals).where(eq(deals.pipelineId, id));
  if (n) throw E.conflict(`This pipeline still has ${n} deal(s); move or delete them first`);
  await ctx.db.delete(pipelines).where(eq(pipelines.id, id));
  await ctx.audit.log("crm.pipeline.deleted", { type: "crm_pipeline", id });
}

// ── Deals: queries ───────────────────────────────────────────────────────────
export async function listDeals(ctx: ModuleContext, q: z.infer<typeof ListQuery>) {
  const where: (SQL | undefined)[] = [];
  if (q.pipelineId) where.push(eq(deals.pipelineId, q.pipelineId));
  if (q.status) where.push(eq(deals.status, q.status));
  if (q.companyId) where.push(eq(deals.companyId, q.companyId));
  if (q.contactId) where.push(eq(deals.contactId, q.contactId));
  if (q.q) where.push(ilike(deals.title, `%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`));
  if (q.cursor) where.push(lt(deals.id, q.cursor));
  const rows = await ctx.db.select().from(deals).where(and(...where)).orderBy(desc(deals.id)).limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  return { data: await dtos(ctx, page), nextCursor: rows.length > q.limit ? page.at(-1)!.id : null };
}

/** Kanban board: every stage of one pipeline with its deals (closed deals only from the last 30 days). */
export async function board(ctx: ModuleContext, pipelineId?: string) {
  const all = await listPipelines(ctx);
  const pipeline = pipelineId ? all.find((p) => p.id === pipelineId) : all[0];
  if (!pipeline) throw E.notFound("Pipeline");
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await ctx.db.select().from(deals)
    .where(and(eq(deals.pipelineId, pipeline.id), or(eq(deals.status, "open"), gte(deals.closedAt, since))))
    .orderBy(desc(deals.stageChangedAt)).limit(1000);
  const list = await dtos(ctx, rows);
  return {
    pipelines: all.map((p) => ({ id: p.id, name: p.name })),
    pipeline: { id: pipeline.id, name: pipeline.name },
    columns: pipeline.stages.map((s) => {
      const ds = list.filter((d) => d.stageId === s.id);
      const totals: Record<string, number> = {};
      for (const d of ds) totals[d.currency] = (totals[d.currency] ?? 0) + d.valueCents;
      return { stage: s, deals: ds, totals };
    }),
  };
}

export async function getDeal(ctx: ModuleContext, id: string) {
  const r = await loadDeal(ctx, id);
  const [d] = await dtos(ctx, [r]);
  const acts = await ctx.db.select().from(activities).where(eq(activities.dealId, id)).orderBy(desc(activities.createdAt), desc(activities.id)).limit(200);
  const st = await stagesOf(ctx, r.pipelineId);
  return {
    ...d!,
    stages: st.map((s) => ({ id: s.id, name: s.name, kind: s.kind, probability: s.probability })),
    activities: acts.map((a) => ({ id: a.id, kind: a.kind, body: a.body, createdBy: a.createdBy, createdAt: a.createdAt })),
  };
}

export async function summary(ctx: ModuleContext) {
  const monthStart = `${today().slice(0, 7)}-01`;
  const since90 = new Date(Date.now() - 90 * 86_400_000);
  const rows = await ctx.db.select({
    currency: deals.currency,
    openCount: sql<number>`count(*) filter (where ${deals.status} = 'open')::int`,
    openCents: sql<string>`coalesce(sum(${deals.valueCents}) filter (where ${deals.status} = 'open'), 0)`,
    weightedCents: sql<string>`coalesce(sum(round(${deals.valueCents} * ${stages.probability} / 100.0)) filter (where ${deals.status} = 'open'), 0)`,
    wonMonthCount: sql<number>`count(*) filter (where ${deals.status} = 'won' and ${deals.closedAt} >= ${monthStart}::date)::int`,
    wonMonthCents: sql<string>`coalesce(sum(${deals.valueCents}) filter (where ${deals.status} = 'won' and ${deals.closedAt} >= ${monthStart}::date), 0)`,
  }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).groupBy(deals.currency);
  const [rate] = await ctx.db.select({
    won: sql<number>`count(*) filter (where ${deals.status} = 'won')::int`,
    lost: sql<number>`count(*) filter (where ${deals.status} = 'lost')::int`,
  }).from(deals).where(and(ne(deals.status, "open"), gte(deals.closedAt, since90)));
  const [due] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(deals)
    .where(and(eq(deals.status, "open"), sql`${deals.nextStepDate} <= ${today()}`));
  const decided = (rate?.won ?? 0) + (rate?.lost ?? 0);
  return {
    currencies: rows.sort((a, b) => a.currency.localeCompare(b.currency)).map((r) => ({
      currency: r.currency, openCount: r.openCount, openCents: Number(r.openCents), weightedCents: Number(r.weightedCents),
      wonMonthCount: r.wonMonthCount, wonMonthCents: Number(r.wonMonthCents),
    })),
    winRate90d: decided ? Math.round(((rate?.won ?? 0) / decided) * 100) : null,
    nextStepsDue: due?.n ?? 0,
  };
}

// ── Deals: commands ──────────────────────────────────────────────────────────
export async function createDeal(ctx: ModuleContext, input: z.infer<typeof DealInput>) {
  await checkCustomer(ctx, input.companyId, input.contactId);
  let stage: Stage;
  if (input.stageId) {
    stage = await stageById(ctx, input.stageId);
    if (input.pipelineId && stage.pipelineId !== input.pipelineId) throw E.badRequest("Stage is not in that pipeline");
  } else {
    const pipelineId = input.pipelineId ?? (await ensureDefaultPipeline(ctx)).id;
    const st = await stagesOf(ctx, pipelineId);
    if (!st.length) throw E.badRequest("Unknown pipeline");
    stage = st.find((s) => s.kind === "open") ?? st[0]!;
  }
  const now = new Date();
  const [row] = await ctx.db.insert(deals).values({
    id: uuidv7(), tenantId: ctx.tenantId, pipelineId: stage.pipelineId, stageId: stage.id,
    title: input.title, valueCents: input.valueCents, currency: input.currency ?? settingsOf(ctx).currency,
    status: stage.kind, closedAt: stage.kind === "open" ? null : now,
    companyId: input.companyId ?? null, contactId: input.contactId ?? null,
    ownerId: input.ownerId === undefined ? (ctx.actor.userId ?? null) : input.ownerId,
    expectedClose: input.expectedClose ?? null, nextStep: input.nextStep || null, nextStepDate: input.nextStepDate ?? null,
    notes: input.notes || null, createdBy: actorRef(ctx),
  }).returning();
  await log(ctx, row!.id, "system", `Deal created in ${stage.name}`);
  await ctx.audit.log("crm.deal.created", { type: "crm_deal", id: row!.id }, { title: row!.title, valueCents: row!.valueCents });
  await ctx.events.emit("crm.deal.created", payload(row!, stage));
  if (stage.kind === "won") await ctx.events.emit("crm.deal.won", payload(row!, stage));
  return getDeal(ctx, row!.id);
}

export async function updateDeal(ctx: ModuleContext, id: string, patch: z.infer<typeof DealPatch>) {
  const r = await loadDeal(ctx, id, true);
  if ("companyId" in patch || "contactId" in patch) await checkCustomer(ctx, patch.companyId, patch.contactId);
  const set: Partial<Deal> = { updatedAt: new Date() };
  const changes: (keyof Deal)[] = [];
  for (const k of ["title", "valueCents", "currency", "companyId", "contactId", "ownerId", "expectedClose", "nextStep", "nextStepDate", "notes"] as const) {
    if (patch[k] === undefined) continue;
    const v = typeof patch[k] === "string" && patch[k] === "" ? null : patch[k];
    if (v === r[k]) continue;
    (set as Record<string, unknown>)[k] = v;
    changes.push(k);
  }
  if (!changes.length) return getDeal(ctx, id);
  const [row] = await ctx.db.update(deals).set(set).where(eq(deals.id, id)).returning();
  if (changes.includes("valueCents")) await log(ctx, id, "system", `Value changed to ${(row!.valueCents / 100).toFixed(2)} ${row!.currency}`);
  await ctx.audit.log("crm.deal.updated", { type: "crm_deal", id }, Object.fromEntries(changes.map((k) => [k, set[k]])));
  await ctx.events.emit("crm.deal.updated", { ...payload(row!, await stageById(ctx, row!.stageId)), changes });
  return getDeal(ctx, id);
}

export async function moveDeal(ctx: ModuleContext, id: string, input: z.infer<typeof MoveInput>) {
  const r = await loadDeal(ctx, id, true);
  const to = await stageById(ctx, input.stageId);
  if (to.id === r.stageId) return getDeal(ctx, id);
  const from = await stageById(ctx, r.stageId);
  const now = new Date();
  const statusChanged = from.kind !== to.kind;
  const [row] = await ctx.db.update(deals).set({
    pipelineId: to.pipelineId, stageId: to.id, status: to.kind, stageChangedAt: now, updatedAt: now,
    closedAt: to.kind === "open" ? null : statusChanged ? now : r.closedAt,
    lostReason: to.kind === "lost" ? (input.lostReason || r.lostReason || null) : null,
  }).where(eq(deals.id, id)).returning();
  const p = payload(row!, to);
  if (to.kind === "won" && statusChanged) await log(ctx, id, "stage", `Marked as won 🎉 (${to.name})`);
  else if (to.kind === "lost" && statusChanged) await log(ctx, id, "stage", `Marked as lost${row!.lostReason ? `: ${row!.lostReason}` : ""}`);
  else await log(ctx, id, "stage", `Moved from ${from.name} to ${to.name}`);
  await ctx.audit.log("crm.deal.moved", { type: "crm_deal", id }, { from: from.name, to: to.name });
  await ctx.events.emit("crm.deal.stage_changed", { ...p, fromStage: from.name, fromStageId: from.id });
  if (statusChanged) {
    if (to.kind === "won") await ctx.events.emit("crm.deal.won", p);
    else if (to.kind === "lost") await ctx.events.emit("crm.deal.lost", { ...p, lostReason: row!.lostReason });
    else await ctx.events.emit("crm.deal.reopened", p);
  }
  return getDeal(ctx, id);
}

/** Move to the first won / lost / open stage of the deal's pipeline (used by workflow actions and the UI buttons). */
export async function stageForOutcome(ctx: ModuleContext, dealId: string, target: string) {
  const r = await loadDeal(ctx, dealId);
  const st = await stagesOf(ctx, r.pipelineId);
  const t = target.trim().toLowerCase();
  const s = (["won", "lost", "open"].includes(t) ? st.find((x) => x.kind === t) : undefined) ?? st.find((x) => x.name.toLowerCase() === t);
  if (!s) throw E.badRequest(`No stage “${target}” in this deal's pipeline`);
  return s.id;
}

export async function deleteDeal(ctx: ModuleContext, id: string) {
  const r = await loadDeal(ctx, id, true);
  await ctx.db.delete(deals).where(eq(deals.id, id));
  await ctx.audit.log("crm.deal.deleted", { type: "crm_deal", id }, { title: r.title });
  await ctx.events.emit("crm.deal.deleted", { id, title: r.title });
}

export async function addActivity(ctx: ModuleContext, dealId: string, input: z.infer<typeof ActivityInput>) {
  const r = await loadDeal(ctx, dealId);
  const a = await log(ctx, dealId, input.kind, input.body);
  await ctx.db.update(deals).set({ updatedAt: new Date() }).where(eq(deals.id, dealId));
  await ctx.events.emit("crm.activity.logged", {
    id: a.id, dealId, kind: a.kind, body: a.body.slice(0, 2000), title: r.title, companyId: r.companyId, contactId: r.contactId,
  });
  return { id: a.id, kind: a.kind, body: a.body, createdBy: a.createdBy, createdAt: a.createdAt };
}

/** leads.lead.converted with `deal` set: open a deal for the new customer (the dispatcher delivers each event once). */
export async function dealFromLead(ctx: ModuleContext, p: Record<string, unknown>) {
  const deal = p.deal as { title?: unknown; valueCents?: unknown; currency?: unknown } | null | undefined;
  if (!deal || typeof deal.title !== "string" || !deal.title.trim()) return;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const input = DealInput.parse({
    title: deal.title.trim().slice(0, 300),
    valueCents: Number.isInteger(deal.valueCents) && (deal.valueCents as number) >= 0 ? deal.valueCents : 0,
    currency: typeof deal.currency === "string" && /^[A-Z]{3}$/.test(deal.currency) ? deal.currency : undefined,
    companyId: str(p.companyId), contactId: str(p.contactId), ownerId: str(p.ownerId),
  });
  let d;
  try { d = await createDeal(ctx, input); }
  catch { d = await createDeal(ctx, { ...input, companyId: null, contactId: null }); } // the customer was deleted meanwhile
  await log(ctx, d.id, "system", `Created from a lead${typeof p.name === "string" ? ` (${p.name})` : ""}`);
}
