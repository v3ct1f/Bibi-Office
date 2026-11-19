import { fileURLToPath } from "node:url";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { action, defineModule, route, type ModuleContext } from "@office/sdk";
import { deals } from "./schema.ts";
import {
  activityDto, ActivityIn, ActivityPatch, ActivityQuery, board, closeDeal, createActivity, createDeal, createStage, dealDto, DealIn,
  DealPatch, DealQuery, deleteActivity, deleteDeal, deleteStage, getDeal, listActivities, listDeals, listStages, moveDeal, reopenDeal,
  reorderStages, seedStages, SETTINGS_SCHEMA, settingsOf, StageIn, StagePatch, summary, updateActivity, updateDeal, updateStage,
} from "./service.ts";

const P = {
  read: "crm:deal.read", write: "crm:deal.write", activity: "crm:activity.write", pipeline: "crm:pipeline.manage",
} as const;
const Id = z.object({ id: z.uuid() });
const deal = async (ctx: ModuleContext, id: string) => getDeal(ctx, id);

/** invoicing.invoice.* v1 payload fields CRM reads (source links an invoice to the deal it was drafted from). */
const InvoicePaidV1 = z.object({ id: z.string(), number: z.string().nullable(), total: z.number(), currency: z.string(), source: z.string().nullish() });

export default defineModule({
  manifest: {
    key: "crm",
    name: "CRM",
    version: "1.0.0",
    office: "^1.0",
    description: "Sales pipeline: deals through stages, won/lost, activities (calls, meetings, tasks) on deals, contacts and companies.",
    permissions: {
      declares: [
        { key: P.read, label: "View deals and activities" },
        { key: P.write, label: "Create, edit, move and close deals" },
        { key: P.activity, label: "Log activities and tasks" },
        { key: P.pipeline, label: "Manage pipeline stages" },
      ],
      requires: ["core:contacts.read", "core:companies.read"],
    },
    entities: ["deal", "stage", "activity"],
    events: {
      emits: [
        { type: "crm.deal.created" }, { type: "crm.deal.stage_changed" }, { type: "crm.deal.won" }, { type: "crm.deal.lost" },
        { type: "crm.deal.reopened" }, { type: "crm.activity.created" }, { type: "crm.activity.completed" },
      ],
      subscribes: ["invoicing.invoice.paid"],
    },
    workflow: {
      triggers: ["crm.deal.created", "crm.deal.stage_changed", "crm.deal.won", "crm.deal.lost", "crm.activity.created", "crm.activity.completed"],
      actions: [
        { key: "crm.create_deal", label: "Create deal" },
        { key: "crm.log_activity", label: "Log activity or task" },
      ],
    },
    ui: {
      slots: [
        { slot: "nav.main", label: "Deals", icon: "handshake", route: "/deals", permission: P.read },
        { slot: "entity.tab:contact", label: "Deals", component: "DealsTab", permission: P.read },
        { slot: "entity.tab:company", label: "Deals", component: "DealsTab", permission: P.read },
        { slot: "entity.tab:contact", label: "Activity", component: "ActivityTab", permission: P.read },
        { slot: "entity.tab:company", label: "Activity", component: "ActivityTab", permission: P.read },
        { slot: "dashboard.widget", label: "Pipeline", component: "PipelineWidget", permission: P.read },
      ],
    },
    settings: SETTINGS_SCHEMA as unknown as Record<string, unknown>,
    api: { basePath: "/crm" },
    lifecycle: ["enable"],
  },
  migrationsDir: fileURLToPath(new URL("../migrations", import.meta.url)),
  lifecycle: { enable: (ctx) => seedStages(ctx) },
  routes: [
    // stages
    route({ method: "GET", path: "/stages", permission: P.read, handler: async (ctx) => ({ data: await listStages(ctx) }) }),
    route({ method: "POST", path: "/stages", permission: P.pipeline, body: StageIn, status: 201, handler: (ctx, { body }) => createStage(ctx, body) }),
    route({ method: "PATCH", path: "/stages/:id", permission: P.pipeline, params: Id, body: StagePatch, handler: (ctx, { params, body }) => updateStage(ctx, params.id, body) }),
    route({ method: "DELETE", path: "/stages/:id", permission: P.pipeline, params: Id, handler: async (ctx, { params }) => { await deleteStage(ctx, params.id); } }),
    route({
      method: "PUT", path: "/stages/order", permission: P.pipeline, body: z.object({ ids: z.array(z.uuid()).min(1).max(50) }),
      handler: async (ctx, { body }) => ({ data: await reorderStages(ctx, body.ids) }),
    }),
    // deals
    route({ method: "GET", path: "/board", permission: P.read, handler: (ctx) => board(ctx) }),
    route({ method: "GET", path: "/summary", permission: P.read, handler: (ctx) => summary(ctx) }),
    route({ method: "GET", path: "/deals", permission: P.read, query: DealQuery, handler: (ctx, { query }) => listDeals(ctx, query) }),
    route({
      method: "POST", path: "/deals", permission: P.write, body: DealIn, status: 201,
      handler: async (ctx, { body }) => deal(ctx, (await createDeal(ctx, body)).id),
    }),
    route({ method: "GET", path: "/deals/:id", permission: P.read, params: Id, handler: (ctx, { params }) => deal(ctx, params.id) }),
    route({
      method: "PATCH", path: "/deals/:id", permission: P.write, params: Id, body: DealPatch,
      handler: async (ctx, { params, body }) => { await updateDeal(ctx, params.id, body); return deal(ctx, params.id); },
    }),
    route({ method: "DELETE", path: "/deals/:id", permission: P.write, params: Id, handler: async (ctx, { params }) => { await deleteDeal(ctx, params.id); } }),
    route({
      method: "POST", path: "/deals/:id/move", permission: P.write, params: Id, body: z.object({ stageId: z.uuid() }),
      handler: async (ctx, { params, body }) => { await moveDeal(ctx, params.id, body.stageId); return deal(ctx, params.id); },
    }),
    route({
      method: "POST", path: "/deals/:id/won", permission: P.write, params: Id,
      handler: async (ctx, { params }) => { await closeDeal(ctx, params.id, "won"); return deal(ctx, params.id); },
    }),
    route({
      method: "POST", path: "/deals/:id/lost", permission: P.write, params: Id, body: z.object({ reason: z.string().trim().max(500).optional() }).default({}),
      handler: async (ctx, { params, body }) => { await closeDeal(ctx, params.id, "lost", body.reason || undefined); return deal(ctx, params.id); },
    }),
    route({
      method: "POST", path: "/deals/:id/reopen", permission: P.write, params: Id,
      handler: async (ctx, { params }) => { await reopenDeal(ctx, params.id); return deal(ctx, params.id); },
    }),
    // activities
    route({ method: "GET", path: "/activities", permission: P.read, query: ActivityQuery, handler: (ctx, { query }) => listActivities(ctx, query) }),
    route({
      method: "POST", path: "/activities", permission: P.activity, body: ActivityIn, status: 201,
      handler: async (ctx, { body }) => activityDto(await createActivity(ctx, body)),
    }),
    route({
      method: "PATCH", path: "/activities/:id", permission: P.activity, params: Id, body: ActivityPatch,
      handler: async (ctx, { params, body }) => activityDto(await updateActivity(ctx, params.id, body)),
    }),
    route({ method: "DELETE", path: "/activities/:id", permission: P.activity, params: Id, handler: async (ctx, { params }) => { await deleteActivity(ctx, params.id); } }),
  ],
  handlers: {
    // An invoice drafted from a won deal (source "crm.deal:<id>") got paid: note it on the deal's timeline.
    "invoicing.invoice.paid": async (ctx, e) => {
      const p = InvoicePaidV1.safeParse(e.payload);
      const dealId = p.success ? /^crm\.deal:([0-9a-f-]{36})$/.exec(p.data.source ?? "")?.[1] : undefined;
      if (!p.success || !dealId) return;
      const [d] = await ctx.db.select({ id: deals.id }).from(deals).where(eq(deals.id, dealId));
      if (!d) return;
      const fmt = new Intl.NumberFormat("en", { style: "currency", currency: p.data.currency });
      const amount = fmt.format(p.data.total / 10 ** (fmt.resolvedOptions().maximumFractionDigits ?? 2));
      await createActivity(ctx, { type: "note", dealId, subject: `Invoice ${p.data.number ?? ""} paid (${amount})`.replace("  ", " ") });
    },
  },
  actions: {
    "crm.create_deal": action({
      label: "Create deal",
      input: z.object({
        title: z.string().min(1).max(300), value: z.number().int().min(0).default(0), currency: z.string().regex(/^[A-Z]{3}$/).optional(),
        contactId: z.uuid().optional(), companyId: z.uuid().optional(), stageId: z.uuid().optional(),
      }),
      run: async (ctx, i) => {
        const d = await createDeal(ctx, i);
        return { id: d.id, stageId: d.stageId, value: d.value };
      },
    }),
    "crm.log_activity": action({
      label: "Log activity or task",
      input: z.object({
        type: z.enum(["note", "call", "email", "meeting", "task"]).default("task"), subject: z.string().min(1).max(300), body: z.string().max(10000).optional(),
        dealId: z.uuid().optional(), contactId: z.uuid().optional(), companyId: z.uuid().optional(),
        dueInDays: z.number().int().min(0).max(365).optional().describe("for tasks: due date from now"),
      }),
      run: async (ctx, i) => {
        const a = await createActivity(ctx, {
          type: i.type, subject: i.subject, body: i.body, dealId: i.dealId, contactId: i.contactId, companyId: i.companyId,
          dueAt: i.dueInDays !== undefined ? new Date(Date.now() + i.dueInDays * 86_400_000).toISOString() : undefined,
        });
        return { id: a.id, dueAt: a.dueAt?.toISOString() ?? null };
      },
    }),
  },
});

export { dealDto, settingsOf };
