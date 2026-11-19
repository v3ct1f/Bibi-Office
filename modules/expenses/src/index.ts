import { fileURLToPath } from "node:url";
import { z } from "zod";
import { action, defineModule, file, route, type ModuleContext } from "@office/sdk";
import {
  attachReceipt, CategoryIn, CategoryPatch, createCategory, createExpense, decide, deleteExpense, ExpenseIn, ExpensePatch, ExpenseQuery,
  exportCsv, ExportQuery, getExpense, listCategories, listExpenses, P, readReceipt, reimburse, removeReceipt, seedCategories,
  SETTINGS_SCHEMA, settingsOf, submitExpense, summary, updateCategory, updateExpense,
} from "./service.ts";
import { metrics } from "./metrics.ts";

const Id = z.object({ id: z.uuid() });
const dto = (ctx: ModuleContext, id: string) => getExpense(ctx, id);
const Note = z.object({ note: z.string().trim().max(1000).optional() }).default({});

export default defineModule({
  manifest: {
    key: "expenses",
    name: "Expenses",
    version: "1.0.0",
    office: "^1.0",
    description: "Expense claims with receipts: members submit, approvers approve or reject, finance marks them reimbursed and exports to accounting.",
    permissions: {
      declares: [
        { key: P.submit, label: "Create and submit own expenses", defaultRoles: ["member"] },
        { key: P.readAll, label: "View everyone's expenses" },
        { key: P.approve, label: "Approve or reject expenses" },
        { key: P.reimburse, label: "Mark expenses reimbursed and export" },
        { key: P.categories, label: "Manage expense categories" },
      ],
      requires: ["core:documents.read", "core:documents.write"],
    },
    entities: ["expense", "category"],
    events: {
      emits: [
        { type: "expenses.expense.submitted" }, { type: "expenses.expense.approved" },
        { type: "expenses.expense.rejected" }, { type: "expenses.expense.reimbursed" },
      ],
      subscribes: [],
    },
    workflow: {
      triggers: ["expenses.expense.submitted", "expenses.expense.approved", "expenses.expense.rejected", "expenses.expense.reimbursed"],
      actions: [{ key: "expenses.approve", label: "Approve expense" }],
    },
    ui: {
      slots: [
        { slot: "nav.main", label: "Expenses", icon: "wallet", route: "/expenses", permission: P.submit },
        { slot: "dashboard.widget", label: "Expenses", component: "ExpensesWidget", permission: P.submit },
      ],
    },
    settings: SETTINGS_SCHEMA as unknown as Record<string, unknown>,
    api: { basePath: "/expenses" },
    lifecycle: ["enable"],
  },
  metrics,
  migrationsDir: fileURLToPath(new URL("../migrations", import.meta.url)),
  lifecycle: { enable: (ctx) => seedCategories(ctx) },
  routes: [
    // categories (everyone who can submit needs the list)
    route({
      method: "GET", path: "/categories", permission: P.submit, query: z.object({ archived: z.enum(["true", "false"]).optional() }),
      handler: async (ctx, { query }) => ({ data: await listCategories(ctx, query.archived === "true") }),
    }),
    route({ method: "POST", path: "/categories", permission: P.categories, body: CategoryIn, status: 201, handler: (ctx, { body }) => createCategory(ctx, body) }),
    route({ method: "PATCH", path: "/categories/:id", permission: P.categories, params: Id, body: CategoryPatch, handler: (ctx, { params, body }) => updateCategory(ctx, params.id, body) }),
    // reporting
    route({ method: "GET", path: "/summary", permission: P.submit, handler: (ctx) => summary(ctx) }),
    route({
      method: "GET", path: "/export.csv", permission: P.reimburse, query: ExportQuery,
      handler: async (ctx, { query }) => file({
        contentType: "text/csv; charset=utf-8", filename: `expenses-${query.from ?? "start"}-${query.to ?? new Date().toISOString().slice(0, 10)}.csv`,
        body: new TextEncoder().encode(await exportCsv(ctx, query)),
      }),
    }),
    // expenses (visibility: own, or all with read_all / approve / reimburse)
    route({ method: "GET", path: "/expenses", permission: P.submit, query: ExpenseQuery, handler: (ctx, { query }) => listExpenses(ctx, query) }),
    route({
      method: "POST", path: "/expenses", permission: P.submit, body: ExpenseIn, status: 201,
      handler: async (ctx, { body }) => dto(ctx, (await createExpense(ctx, body)).id),
    }),
    route({ method: "GET", path: "/expenses/:id", permission: P.submit, params: Id, handler: (ctx, { params }) => dto(ctx, params.id) }),
    route({
      method: "PATCH", path: "/expenses/:id", permission: P.submit, params: Id, body: ExpensePatch,
      handler: async (ctx, { params, body }) => { await updateExpense(ctx, params.id, body); return dto(ctx, params.id); },
    }),
    route({ method: "DELETE", path: "/expenses/:id", permission: P.submit, params: Id, handler: async (ctx, { params }) => { await deleteExpense(ctx, params.id); } }),
    route({
      method: "POST", path: "/expenses/:id/receipt", permission: P.submit, params: Id, upload: true,
      query: z.object({ filename: z.string().min(1).max(255) }),
      handler: async (ctx, { params, file: f }) => { await attachReceipt(ctx, params.id, f!); return dto(ctx, params.id); },
    }),
    route({ method: "DELETE", path: "/expenses/:id/receipt", permission: P.submit, params: Id, handler: async (ctx, { params }) => { await removeReceipt(ctx, params.id); return dto(ctx, params.id); } }),
    route({
      method: "GET", path: "/expenses/:id/receipt", permission: P.submit, params: Id,
      handler: async (ctx, { params }) => {
        const { file: f, bytes } = await readReceipt(ctx, params.id);
        return file({ contentType: f.mime, filename: f.filename, body: bytes, inline: f.mime === "application/pdf" || f.mime.startsWith("image/") });
      },
    }),
    route({ method: "POST", path: "/expenses/:id/submit", permission: P.submit, params: Id, handler: async (ctx, { params }) => { await submitExpense(ctx, params.id); return dto(ctx, params.id); } }),
    route({
      method: "POST", path: "/expenses/:id/approve", permission: P.approve, params: Id, body: Note,
      handler: async (ctx, { params, body }) => { await decide(ctx, params.id, "approved", body.note); return dto(ctx, params.id); },
    }),
    route({
      method: "POST", path: "/expenses/:id/reject", permission: P.approve, params: Id, body: z.object({ note: z.string().trim().min(1).max(1000) }),
      handler: async (ctx, { params, body }) => { await decide(ctx, params.id, "rejected", body.note); return dto(ctx, params.id); },
    }),
    route({
      method: "POST", path: "/reimburse", permission: P.reimburse,
      body: z.object({ ids: z.array(z.uuid()).min(1).max(500), reference: z.string().trim().max(200).optional() }),
      handler: async (ctx, { body }) => ({ reimbursed: (await reimburse(ctx, [...new Set(body.ids)], body.reference)).length }),
    }),
  ],
  actions: {
    // e.g. workflow "expenses.expense.submitted" + condition amount < 5000 -> auto-approve small claims.
    "expenses.approve": action({
      label: "Approve expense",
      input: z.object({ id: z.uuid().describe("expense id, e.g. {{payload.id}}"), note: z.string().max(1000).optional() }),
      run: async (ctx, i) => {
        const r = await decide(ctx, i.id, "approved", i.note ?? "Approved by workflow");
        return { id: r.id, status: r.status };
      },
    }),
  },
});

export { settingsOf };
