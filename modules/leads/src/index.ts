import { fileURLToPath } from "node:url";
import { z } from "zod";
import { action, defineModule, publicRoute, route } from "@office/sdk";
import { metrics } from "./metrics.ts";
import { SOURCES } from "./schema.ts";
import {
  ActivityInput, addActivity, ConvertInput, convertLead, createLead, deleteLead, FormInput, getForm, getLead, LeadInput, LeadPatch, ListQuery,
  listLeads, PublicSubmit, publicFormView, publicSubmit, replaceFormLink, saveForm, setStatus, settingsOf, StatusInput, summary, Token, updateLead,
} from "./service.ts";

const READ = "leads:lead.read", WRITE = "leads:lead.write", FORM = "leads:form.manage";
const Id = z.object({ id: z.uuid() });

const EVENTS = [
  "leads.lead.created", "leads.lead.updated", "leads.lead.status_changed", "leads.lead.qualified", "leads.lead.disqualified",
  "leads.lead.converted", "leads.lead.deleted", "leads.activity.logged",
];

export default defineModule({
  manifest: {
    key: "leads",
    name: "Leads",
    version: "1.0.0",
    office: "^1.0",
    description: "People who might become customers: collect them by hand or from a web form, follow up, and turn the good ones into customers.",
    permissions: {
      declares: [
        { key: READ, label: "View leads" },
        { key: WRITE, label: "Add, edit, follow up and convert leads" },
        { key: FORM, label: "Set up the public web form" },
      ],
      requires: ["core:contacts.read", "core:contacts.write", "core:companies.read", "core:companies.write", "core:members.read"],
    },
    icon: "user-plus",
    category: "sales",
    roles: { manager: [READ, WRITE, FORM], member: [READ, WRITE], viewer: [READ] },
    entities: ["lead", "activity", "form"],
    events: { emits: EVENTS.map((type) => ({ type })), subscribes: [] },
    workflow: {
      triggers: EVENTS,
      actions: [
        { key: "leads.create_lead", label: "Add lead" },
        { key: "leads.set_status", label: "Change lead status" },
        { key: "leads.log_activity", label: "Add note to lead" },
      ],
    },
    ui: {
      slots: [
        { slot: "nav.main", label: "Leads", icon: "user-plus", route: "/leads", permission: READ },
        { slot: "global.create", label: "Lead", route: "/leads/new", permission: WRITE },
        { slot: "dashboard.widget", label: "Leads", component: "LeadsWidget", permission: READ },
        { slot: "nav.settings", label: "Web form", route: "/form" },
      ],
    },
    settings: {
      type: "object",
      properties: {
        currency: { type: "string", title: "Default currency", default: "EUR", pattern: "^[A-Z]{3}$" },
      },
      additionalProperties: false,
    },
    api: { basePath: "/leads" },
  },
  migrationsDir: fileURLToPath(new URL("../migrations", import.meta.url)),
  metrics,
  routes: [
    route({ method: "GET", path: "/config", permission: READ, handler: async (ctx) => ({ currency: settingsOf(ctx).currency }) }),
    route({ method: "GET", path: "/summary", permission: READ, handler: (ctx) => summary(ctx) }),
    route({
      method: "GET", path: "/people", permission: READ,
      handler: async (ctx) => (await ctx.people.list()).map((p) => ({ userId: p.userId, name: p.name || p.email })),
    }),
    route({ method: "GET", path: "/leads", permission: READ, query: ListQuery, handler: (ctx, { query }) => listLeads(ctx, query) }),
    route({ method: "POST", path: "/leads", permission: WRITE, status: 201, body: LeadInput, handler: (ctx, { body }) => createLead(ctx, body) }),
    route({ method: "GET", path: "/leads/:id", permission: READ, params: Id, handler: (ctx, { params }) => getLead(ctx, params.id) }),
    route({ method: "PATCH", path: "/leads/:id", permission: WRITE, params: Id, body: LeadPatch, handler: (ctx, { params, body }) => updateLead(ctx, params.id, body) }),
    route({ method: "DELETE", path: "/leads/:id", permission: WRITE, params: Id, status: 204, handler: (ctx, { params }) => deleteLead(ctx, params.id) }),
    route({ method: "POST", path: "/leads/:id/status", permission: WRITE, params: Id, body: StatusInput, handler: (ctx, { params, body }) => setStatus(ctx, params.id, body) }),
    route({
      method: "POST", path: "/leads/:id/activities", permission: WRITE, params: Id, body: ActivityInput, status: 201,
      handler: (ctx, { params, body }) => addActivity(ctx, params.id, body),
    }),
    route({ method: "POST", path: "/leads/:id/convert", permission: WRITE, params: Id, body: ConvertInput, handler: (ctx, { params, body }) => convertLead(ctx, params.id, body) }),
    route({ method: "GET", path: "/form", permission: READ, handler: (ctx) => getForm(ctx) }),
    route({ method: "PATCH", path: "/form", permission: FORM, body: FormInput, handler: (ctx, { body }) => saveForm(ctx, body) }),
    route({ method: "POST", path: "/form/replace-link", permission: FORM, handler: (ctx) => replaceFormLink(ctx) }),
  ],
  publicRoutes: [
    publicRoute({ method: "GET", path: "/form/:token", params: Token, handler: (ctx, { params }) => publicFormView(ctx, params.token) }),
    publicRoute({
      method: "POST", path: "/form/:token", params: Token, body: PublicSubmit, status: 201,
      handler: (ctx, { params, body, client }) => publicSubmit(ctx, params.token, body, client),
    }),
  ],
  actions: {
    "leads.create_lead": action({
      label: "Add lead", permission: WRITE,
      input: z.object({
        name: z.string().max(400).optional().describe("Full name, e.g. {{payload.name}}"),
        email: z.string().max(320).optional(),
        phone: z.string().max(50).optional(),
        company: z.string().max(300).optional(),
        message: z.string().max(5000).optional(),
        source: z.enum(SOURCES).optional().describe("Defaults to workflow"),
      }),
      run: async (ctx, i) => {
        const parts = (i.name ?? "").trim().split(/\s+/).filter(Boolean);
        const l = await createLead(ctx, {
          firstName: parts[0] ?? null, lastName: parts.slice(1).join(" ") || null, email: i.email?.trim() || null,
          phone: i.phone || null, companyName: i.company || null, message: i.message || null, source: i.source ?? "workflow", ownerId: null,
        });
        return { leadId: l.id, name: l.name };
      },
    }),
    "leads.set_status": action({
      label: "Change lead status", permission: WRITE,
      input: z.object({
        leadId: z.uuid().describe("Usually {{payload.id}}"),
        status: z.enum(["new", "contacted", "qualified", "disqualified"]),
        reason: z.string().max(500).optional().describe("Why it was disqualified"),
      }),
      run: async (ctx, i) => {
        const l = await setStatus(ctx, i.leadId, { status: i.status, reason: i.reason ?? null });
        return { leadId: l.id, status: l.status };
      },
    }),
    "leads.log_activity": action({
      label: "Add note to lead", permission: WRITE,
      input: z.object({ leadId: z.uuid().describe("Usually {{payload.id}}"), body: z.string().min(1).max(10_000) }),
      run: async (ctx, i) => ({ activityId: (await addActivity(ctx, i.leadId, { kind: "note", body: i.body })).id }),
    }),
  },
});
