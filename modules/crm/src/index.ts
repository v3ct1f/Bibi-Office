import { metrics } from "./metrics.ts";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { action, defineModule, route } from "@office/sdk";
import {
  ActivityInput, addActivity, board, BoardQuery, createDeal, createPipeline, DealInput, DealPatch, deleteDeal, deletePipeline,
  ensureDefaultPipeline, getDeal, ListQuery, listDeals, listPipelines, MoveInput, moveDeal, PipelineInput, PipelinePatch,
  settingsOf, stageForOutcome, summary, updateDeal, updatePipeline,
} from "./service.ts";

const READ = "crm:deal.read", WRITE = "crm:deal.write", MANAGE = "crm:pipeline.manage";
const Id = z.object({ id: z.uuid() });

const EVENTS = [
  "crm.deal.created", "crm.deal.updated", "crm.deal.stage_changed", "crm.deal.won", "crm.deal.lost", "crm.deal.reopened",
  "crm.deal.deleted", "crm.activity.logged",
];

export default defineModule({
  manifest: {
    key: "crm",
    name: "CRM",
    version: "1.0.0",
    office: "^1.0",
    description: "Sales pipeline: deals moving through stages, with notes, calls and next steps. Won deals can become invoices.",
    permissions: {
      declares: [
        { key: READ, label: "View deals and pipelines" },
        { key: WRITE, label: "Create, edit and move deals, log activities" },
        { key: MANAGE, label: "Set up pipelines and stages" },
      ],
      requires: ["core:contacts.read", "core:companies.read"],
    },
    icon: "handshake",
    category: "sales",
    roles: { manager: [READ, WRITE, MANAGE], member: [READ, WRITE], viewer: [READ] },
    entities: ["deal", "pipeline", "stage", "activity"],
    events: { emits: EVENTS.map((type) => ({ type })), subscribes: [] },
    workflow: {
      triggers: EVENTS,
      actions: [
        { key: "crm.create_deal", label: "Create deal" },
        { key: "crm.move_deal", label: "Move deal to stage" },
        { key: "crm.log_activity", label: "Add note to deal" },
      ],
    },
    ui: {
      slots: [
        { slot: "nav.main", label: "Deals", icon: "handshake", route: "/deals", permission: READ },
        { slot: "global.create", label: "Deal", route: "/deals/new", permission: WRITE },
        { slot: "entity.tab:company", label: "Deals", component: "CustomerDealsTab", permission: READ },
        { slot: "entity.tab:contact", label: "Deals", component: "CustomerDealsTab", permission: READ },
        { slot: "dashboard.widget", label: "Sales pipeline", component: "PipelineWidget", permission: READ },
        { slot: "nav.settings", label: "Pipeline settings", route: "/settings" },
      ],
    },
    settings: {
      type: "object",
      properties: {
        currency: { type: "string", title: "Default currency", default: "EUR", pattern: "^[A-Z]{3}$" },
      },
      additionalProperties: false,
    },
    api: { basePath: "/crm" },
  },
  migrationsDir: fileURLToPath(new URL("../migrations", import.meta.url)),
  metrics,
  lifecycle: {
    enable: async (ctx) => { await ensureDefaultPipeline(ctx); },
  },
  routes: [
    route({ method: "GET", path: "/config", permission: READ, handler: async (ctx) => ({ currency: settingsOf(ctx).currency }) }),
    route({ method: "GET", path: "/pipelines", permission: READ, handler: (ctx) => listPipelines(ctx) }),
    route({ method: "POST", path: "/pipelines", permission: MANAGE, status: 201, body: PipelineInput, handler: (ctx, { body }) => createPipeline(ctx, body) }),
    route({ method: "PATCH", path: "/pipelines/:id", permission: MANAGE, params: Id, body: PipelinePatch, handler: (ctx, { params, body }) => updatePipeline(ctx, params.id, body) }),
    route({ method: "DELETE", path: "/pipelines/:id", permission: MANAGE, params: Id, status: 204, handler: (ctx, { params }) => deletePipeline(ctx, params.id) }),
    route({ method: "GET", path: "/board", permission: READ, query: BoardQuery, handler: (ctx, { query }) => board(ctx, query.pipelineId) }),
    route({ method: "GET", path: "/summary", permission: READ, handler: (ctx) => summary(ctx) }),
    route({ method: "GET", path: "/deals", permission: READ, query: ListQuery, handler: (ctx, { query }) => listDeals(ctx, query) }),
    route({ method: "POST", path: "/deals", permission: WRITE, status: 201, body: DealInput, handler: (ctx, { body }) => createDeal(ctx, body) }),
    route({ method: "GET", path: "/deals/:id", permission: READ, params: Id, handler: (ctx, { params }) => getDeal(ctx, params.id) }),
    route({ method: "PATCH", path: "/deals/:id", permission: WRITE, params: Id, body: DealPatch, handler: (ctx, { params, body }) => updateDeal(ctx, params.id, body) }),
    route({ method: "DELETE", path: "/deals/:id", permission: WRITE, params: Id, status: 204, handler: (ctx, { params }) => deleteDeal(ctx, params.id) }),
    route({ method: "POST", path: "/deals/:id/move", permission: WRITE, params: Id, body: MoveInput, handler: (ctx, { params, body }) => moveDeal(ctx, params.id, body) }),
    route({
      method: "POST", path: "/deals/:id/activities", permission: WRITE, params: Id, body: ActivityInput, status: 201,
      handler: (ctx, { params, body }) => addActivity(ctx, params.id, body),
    }),
  ],
  actions: {
    "crm.create_deal": action({
      label: "Create deal",
      input: z.object({
        title: z.string().min(1).max(300),
        amount: z.coerce.number().min(0).max(1e12).optional().describe("Deal value in major units, e.g. 1500.00"),
        currency: z.string().regex(/^[A-Z]{3}$/).optional().describe("Defaults to the CRM setting"),
        companyId: z.uuid().optional().describe("Usually {{payload.companyId}} or {{payload.id}}"),
        contactId: z.uuid().optional().describe("Usually {{payload.id}} for a new contact"),
        stage: z.string().max(60).optional().describe("Stage name; defaults to the first stage"),
      }),
      run: async (ctx, i) => {
        let stageId: string | undefined;
        if (i.stage) {
          const p = (await listPipelines(ctx))[0]!;
          stageId = p.stages.find((s) => s.name.toLowerCase() === i.stage!.trim().toLowerCase())?.id;
          if (!stageId) throw new Error(`No stage “${i.stage}” in the ${p.name} pipeline`);
        }
        const d = await createDeal(ctx, DealInput.parse({
          title: i.title, valueCents: Math.round((i.amount ?? 0) * 100), currency: i.currency,
          companyId: i.companyId ?? null, contactId: i.contactId ?? null, stageId,
        }));
        return { dealId: d.id, stage: d.stageName };
      },
    }),
    "crm.move_deal": action({
      label: "Move deal to stage",
      input: z.object({
        dealId: z.uuid().describe("Usually {{payload.id}}"),
        stage: z.string().min(1).max(60).describe("Stage name, or won / lost"),
        lostReason: z.string().max(500).optional(),
      }),
      run: async (ctx, i) => {
        const d = await moveDeal(ctx, i.dealId, { stageId: await stageForOutcome(ctx, i.dealId, i.stage), lostReason: i.lostReason ?? null });
        return { dealId: d.id, status: d.status, stage: d.stageName };
      },
    }),
    "crm.log_activity": action({
      label: "Add note to deal",
      input: z.object({ dealId: z.uuid().describe("Usually {{payload.id}}"), body: z.string().min(1).max(10_000) }),
      run: async (ctx, i) => ({ activityId: (await addActivity(ctx, i.dealId, { kind: "note", body: i.body })).id }),
    }),
  },
});
