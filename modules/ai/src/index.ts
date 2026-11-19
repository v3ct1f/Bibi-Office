import { fileURLToPath } from "node:url";
import { z } from "zod";
import { action, defineModule, moduleErrors, route } from "@office/sdk";
import {
  createSummary, createTasks, deleteSummary, getSummary, ListQuery, listSummaries, P, SETTINGS_SCHEMA, status, SummarizeIn, TasksIn, textFromUpload, UploadQuery,
} from "./service.ts";

const Id = z.object({ id: z.uuid() });

export default defineModule({
  manifest: {
    key: "ai",
    name: "AI summaries",
    version: "1.0.0",
    office: "^1.0",
    description: "Summaries of meeting notes, transcripts and email threads with Claude: key points, decisions and action items that can become tasks. Uses your own Anthropic API key, with a monthly token limit.",
    permissions: {
      declares: [
        { key: P.read, label: "See summaries", defaultRoles: ["member"] },
        { key: P.create, label: "Send text to AI for a summary", defaultRoles: ["member"] },
        { key: P.manage, label: "Delete anyone's summaries" },
      ],
      requires: ["core:tasks.write"],
    },
    entities: ["summary"],
    events: { emits: [{ type: "ai.summary.created" }], subscribes: [] },
    workflow: { triggers: ["ai.summary.created"], actions: [{ key: "ai.summarize", label: "Summarize text with AI" }] },
    ui: {
      slots: [
        { slot: "nav.main", label: "Summaries", icon: "sparkles", route: "/summaries", permission: P.read },
      ],
    },
    settings: SETTINGS_SCHEMA as unknown as Record<string, unknown>,
    api: { basePath: "/ai" },
    lifecycle: [],
  },
  migrationsDir: fileURLToPath(new URL("../migrations", import.meta.url)),
  routes: [
    route({ method: "GET", path: "/status", permission: P.read, handler: (ctx) => status(ctx) }),
    route({ method: "GET", path: "/summaries", permission: P.read, query: ListQuery, handler: (ctx, { query }) => listSummaries(ctx, query) }),
    route({ method: "POST", path: "/summaries", permission: P.create, body: SummarizeIn, status: 201, handler: (ctx, { body }) => createSummary(ctx, body) }),
    route({ method: "POST", path: "/summaries/upload", permission: P.create, query: UploadQuery, upload: true, status: 201,
      handler: async (ctx, { query, file }) => {
        const text = textFromUpload(file!);
        const i = SummarizeIn.safeParse({ kind: query.kind, title: query.title || file!.filename.replace(/\.[^.]+$/, ""), text });
        if (!i.success) throw moduleErrors.badRequest(i.error.issues[0]!.message);
        return createSummary(ctx, i.data);
      } }),
    route({ method: "GET", path: "/summaries/:id", permission: P.read, params: Id, handler: (ctx, { params }) => getSummary(ctx, params.id) }),
    route({ method: "DELETE", path: "/summaries/:id", permission: P.create, params: Id, handler: (ctx, { params }) => deleteSummary(ctx, params.id) }),
    route({ method: "POST", path: "/summaries/:id/tasks", permission: P.create, params: Id, body: TasksIn, status: 201, handler: (ctx, { params, body }) => createTasks(ctx, params.id, body.items) }),
  ],
  actions: {
    "ai.summarize": action({
      label: "Summarize text with AI",
      input: z.object({
        text: z.string().min(20).max(200_000).describe("e.g. {{payload.text}}"), kind: z.enum(["meeting", "email", "notes"]).default("notes"), title: z.string().max(200).optional(),
      }),
      run: async (ctx, i) => {
        const s = await createSummary(ctx, i);
        return { summaryId: s.id, status: s.status, title: s.title, tldr: s.result?.tldr ?? null, actionItems: s.result?.actionItems ?? [] };
      },
    }),
  },
});
