import { fileURLToPath } from "node:url";
import { z } from "zod";
import { defineModule, job, route } from "@office/sdk";
import {
  approveExpense, createExpense, DecisionInput, DEFAULT_CATEGORIES, deleteExpense, ExpenseInput, ExpensePatch, exportCsv, FileInput,
  getExpense, getFile, listExpenses, ListQuery, P, payExpense, purgeOrphanFiles, rejectExpense, RejectInput, settingsOf, submitExpense,
  summary, updateExpense, uploadFile, MAX_FILE_BYTES,
} from "./service.ts";

const Id = z.object({ id: z.uuid() });
const EVENTS = ["created", "submitted", "approved", "rejected", "paid"].map((e) => `expenses.expense.${e}`);

export default defineModule({
  manifest: {
    key: "expenses",
    name: "Invoices & Expenses",
    version: "1.0.0",
    office: "^1.0",
    description: "Snap a receipt or upload a supplier invoice: the details are read for you to check. Managers approve or reject, then mark them paid. Filters and CSV export.",
    icon: "wallet",
    category: "finance",
    permissions: {
      declares: [
        { key: P.READ, label: "See your own expenses" },
        { key: P.SUBMIT, label: "Add and submit expenses" },
        { key: P.REVIEW, label: "See everyone's expenses, approve, reject and mark paid" },
      ],
      requires: ["core:members.read"],
    },
    roles: { manager: [P.READ, P.SUBMIT, P.REVIEW], member: [P.READ, P.SUBMIT] },
    entities: ["expense"],
    events: { emits: EVENTS.map((type) => ({ type })), subscribes: [] },
    workflow: { triggers: EVENTS, actions: [] },
    ui: {
      slots: [
        { slot: "nav.main", label: "Expenses", icon: "wallet", route: "/expenses", permission: P.READ },
        { slot: "global.create", label: "Expense", route: "/expenses/new", permission: P.SUBMIT },
        { slot: "dashboard.widget", label: "Expenses", component: "ExpensesWidget", permission: P.READ },
      ],
    },
    settings: {
      type: "object",
      properties: {
        currency: { type: "string", title: "Default currency", default: "EUR", pattern: "^[A-Z]{3}$" },
        categories: {
          type: "array", title: "Categories", description: "Shown when adding an expense.",
          items: { type: "string", minLength: 1, maxLength: 80 }, maxItems: 50, default: DEFAULT_CATEGORIES,
        },
      },
      additionalProperties: false,
    },
    api: { basePath: "/expenses" },
  },
  migrationsDir: fileURLToPath(new URL("../migrations", import.meta.url)),
  routes: [
    route({
      method: "GET", path: "/config", permission: P.READ,
      handler: async (ctx) => ({
        ...settingsOf(ctx), me: ctx.actor.userId ?? null, canSubmit: ctx.authz.can(P.SUBMIT), canReview: ctx.authz.can(P.REVIEW), maxFileBytes: MAX_FILE_BYTES,
      }),
    }),
    route({
      method: "GET", path: "/people", permission: P.REVIEW,
      handler: async (ctx) => (await ctx.people.list()).map((p) => ({ userId: p.userId, name: p.name })),
    }),
    route({ method: "GET", path: "/summary", permission: P.READ, handler: (ctx) => summary(ctx) }),
    route({ method: "GET", path: "/expenses", permission: P.READ, query: ListQuery, handler: (ctx, { query }) => listExpenses(ctx, query) }),
    route({ method: "GET", path: "/export", permission: P.READ, query: ListQuery, handler: (ctx, { query }) => exportCsv(ctx, query) }),
    route({ method: "POST", path: "/expenses", permission: P.SUBMIT, status: 201, body: ExpenseInput, handler: (ctx, { body }) => createExpense(ctx, body) }),
    route({ method: "GET", path: "/expenses/:id", permission: P.READ, params: Id, handler: (ctx, { params }) => getExpense(ctx, params.id) }),
    route({ method: "PATCH", path: "/expenses/:id", permission: P.READ, params: Id, body: ExpensePatch, handler: (ctx, { params, body }) => updateExpense(ctx, params.id, body) }),
    route({ method: "DELETE", path: "/expenses/:id", permission: P.READ, params: Id, status: 204, handler: (ctx, { params }) => deleteExpense(ctx, params.id) }),
    route({ method: "POST", path: "/expenses/:id/submit", permission: P.SUBMIT, params: Id, handler: (ctx, { params }) => submitExpense(ctx, params.id) }),
    route({ method: "POST", path: "/expenses/:id/approve", permission: P.REVIEW, params: Id, body: DecisionInput, handler: (ctx, { params, body }) => approveExpense(ctx, params.id, body.comment) }),
    route({ method: "POST", path: "/expenses/:id/reject", permission: P.REVIEW, params: Id, body: RejectInput, handler: (ctx, { params, body }) => rejectExpense(ctx, params.id, body.comment) }),
    route({ method: "POST", path: "/expenses/:id/pay", permission: P.REVIEW, params: Id, handler: (ctx, { params }) => payExpense(ctx, params.id) }),
    route({ method: "POST", path: "/files", permission: P.SUBMIT, status: 201, body: FileInput, bodyLimit: 8 * 1024 * 1024, handler: (ctx, { body }) => uploadFile(ctx, body) }),
    route({ method: "GET", path: "/files/:id", permission: P.READ, params: Id, handler: (ctx, { params }) => getFile(ctx, params.id) }),
  ],
  jobs: {
    purge_orphan_files: job({ label: "Remove abandoned uploads", everyMinutes: 360, run: purgeOrphanFiles }),
  },
});
