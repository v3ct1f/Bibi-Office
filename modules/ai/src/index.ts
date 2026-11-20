import { fileURLToPath } from "node:url";
import { z } from "zod";
import { defineModule, route } from "@office/sdk";
import { MODELS } from "./claude.ts";
import {
  config, createMeeting, createTasks, createTicketSummary, deleteSummary, getSummary, ListQuery, listSummaries, MeetingInput, P, regenerate,
  SummaryPatch, TasksInput, testKey, TicketInput, updateSummary, usageReport,
} from "./service.ts";

const Id = z.object({ id: z.uuid() });
const Company = z.object({ companyName: z.string().trim().max(200).optional() });
const EVENTS = ["ai.summary.created", "ai.action_items.tasks_created"];
const LANGUAGES = ["auto", "English", "Spanish", "French", "German", "Italian", "Portuguese", "Dutch", "Catalan"];

export default defineModule({
  manifest: {
    key: "ai",
    name: "AI summaries",
    version: "1.0.0",
    office: "^1.0",
    description: "Claude summarises meeting notes and long support tickets: key points, decisions, action items you can turn into tasks, a follow-up email and a suggested reply. Uses your own Anthropic API key.",
    icon: "sparkles",
    category: "other",
    permissions: {
      declares: [
        { key: P.READ, label: "See shared summaries and your own" },
        { key: P.WRITE, label: "Create meeting and ticket summaries, and turn action items into tasks" },
        { key: P.MANAGE, label: "See and change everyone's summaries, and see AI usage" },
      ],
      requires: ["core:members.read", "core:contacts.read", "core:tasks.write"],
    },
    roles: { manager: [P.READ, P.WRITE, P.MANAGE], member: [P.READ, P.WRITE], viewer: [P.READ] },
    entities: ["summary"],
    events: { emits: EVENTS.map((type) => ({ type })), subscribes: [] },
    workflow: { triggers: EVENTS, actions: [] },
    ui: {
      slots: [
        { slot: "nav.main", label: "Summaries", icon: "sparkles", route: "/ai", permission: P.READ },
        { slot: "global.create", label: "Meeting summary", route: "/ai/new", permission: P.WRITE },
        { slot: "dashboard.widget", label: "AI summaries", component: "AiWidget", permission: P.READ },
        { slot: "entity.tab:contact", label: "Summaries", component: "ContactSummariesTab", permission: P.READ },
        { slot: "entity.sidebar:ticket", label: "AI summary", component: "TicketAiPanel", permission: P.READ },
        { slot: "entity.sidebar:deal", label: "Meeting summaries", component: "DealSummariesPanel", permission: P.READ },
      ],
    },
    settings: {
      type: "object",
      properties: {
        apiKey: {
          type: "string", title: "Anthropic API key", "x-secret": true, maxLength: 300,
          description: "Create one at console.anthropic.com → API keys. Your company pays Anthropic for what it uses. Meeting notes and tickets you summarise are sent to Anthropic to be processed.",
        },
        model: { type: "string", title: "Claude model", enum: [...MODELS], default: MODELS[0], description: "Opus gives the best summaries. Sonnet and Haiku are faster and cheaper." },
        language: { type: "string", title: "Write summaries in", enum: LANGUAGES, default: "auto", description: "auto = the same language as the meeting or the customer" },
        monthlyTokenLimit: {
          type: "integer", title: "Monthly limit (tokens)", default: 1_000_000, minimum: 0, maximum: 1_000_000_000,
          description: "Stops new summaries once this many tokens were used this month. 0 = no limit. A one-hour meeting is about 15,000 tokens.",
        },
      },
      additionalProperties: false,
    },
    api: { basePath: "/ai" },
  },
  migrationsDir: fileURLToPath(new URL("../migrations", import.meta.url)),
  routes: [
    route({ method: "GET", path: "/config", permission: P.READ, handler: (ctx) => config(ctx) }),
    route({ method: "GET", path: "/usage", permission: P.MANAGE, handler: (ctx) => usageReport(ctx) }),
    route({ method: "POST", path: "/test", permission: P.MANAGE, handler: (ctx) => testKey(ctx) }),

    route({ method: "GET", path: "/summaries", permission: P.READ, query: ListQuery, handler: (ctx, { query }) => listSummaries(ctx, query) }),
    route({ method: "POST", path: "/summaries", permission: P.WRITE, status: 201, body: MeetingInput, bodyLimit: 2 * 1024 * 1024, handler: (ctx, { body }) => createMeeting(ctx, body) }),
    route({ method: "POST", path: "/summaries/ticket", permission: P.WRITE, status: 201, body: TicketInput, bodyLimit: 4 * 1024 * 1024, handler: (ctx, { body }) => createTicketSummary(ctx, body) }),
    route({ method: "GET", path: "/summaries/:id", permission: P.READ, params: Id, handler: (ctx, { params }) => getSummary(ctx, params.id) }),
    route({ method: "PATCH", path: "/summaries/:id", permission: P.READ, params: Id, body: SummaryPatch, handler: (ctx, { params, body }) => updateSummary(ctx, params.id, body) }),
    route({ method: "DELETE", path: "/summaries/:id", permission: P.READ, params: Id, status: 204, handler: (ctx, { params }) => deleteSummary(ctx, params.id) }),
    route({ method: "POST", path: "/summaries/:id/regenerate", permission: P.WRITE, params: Id, body: Company, handler: (ctx, { params, body }) => regenerate(ctx, params.id, body.companyName) }),
    route({ method: "POST", path: "/summaries/:id/tasks", permission: P.WRITE, params: Id, body: TasksInput, handler: (ctx, { params, body }) => createTasks(ctx, params.id, body) }),
  ],
});
