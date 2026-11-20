import { fileURLToPath } from "node:url";
import { z } from "zod";
import { defineModule, job, route } from "@office/sdk";
import {
  addLeave, addPay, assignChecklist, ChecklistInput, ChecklistQuery, config, createTemplate, deleteChecklist, deleteDocument, deleteLeave, deletePay,
  deleteTemplate, directory, DirectoryQuery, DocumentInput, DocumentPatch, downloadDocument, expiringDocuments, getChecklist, getProfile, LeaveInput,
  leaveOverview, listChecklists, listDocuments, listPay, listTemplates, myTasks, onDocsCompleted, onTimeOffApproved, onTimeOffCancelled, P, PayInput, personLeave,
  ProfilePatch, remindExpiring, summary, TaskPatch, TemplateInput, updateDocument, updateProfile, updateTask, updateTemplate, uploadDocument,
} from "./service.ts";

const Id = z.object({ id: z.uuid() });
const User = z.object({ userId: z.uuid() });
const Year = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() });
const EVENTS = ["hr.employee.updated", "hr.pay.changed", "hr.document.expiring", "hr.checklist.assigned", "hr.checklist.completed"];

export default defineModule({
  manifest: {
    key: "hr",
    name: "HR",
    version: "1.0.0",
    office: "^1.0",
    description: "Employee profiles and directory, org chart, vacation allowances and balances (from approved time off), employee documents with expiry reminders, onboarding and offboarding checklists, and restricted pay history.",
    icon: "users",
    category: "team",
    permissions: {
      declares: [
        { key: P.READ, label: "See the team directory and org chart, and your own profile, leave, documents and tasks" },
        { key: P.MANAGE, label: "Edit everyone's profiles and private details, leave, documents and checklists" },
        { key: P.PAY, label: "See and change pay (salary or hourly rate)" },
      ],
      requires: ["core:members.read"],
    },
    // Pay: only owners and admins by default; grant hr:pay.manage to another role under Settings → Roles.
    roles: { manager: [P.READ, P.MANAGE], member: [P.READ], viewer: [P.READ] },
    entities: ["employee"],
    events: { emits: EVENTS.map((type) => ({ type })), subscribes: ["scheduling.time_off.approved", "scheduling.time_off.cancelled", "docs.request.completed"] },
    workflow: { triggers: EVENTS, actions: [] },
    ui: {
      slots: [
        { slot: "nav.main", label: "People", icon: "users", route: "/people", permission: P.READ },
        { slot: "dashboard.widget", label: "People", component: "PeopleWidget", permission: P.READ },
      ],
    },
    settings: {
      type: "object",
      properties: {
        defaultAllowanceDays: { type: "number", title: "Vacation days per year", description: "Default yearly allowance; can be changed per person.", default: 25, minimum: 0, maximum: 366 },
        reminderDays: { type: "integer", title: "Remind before documents expire (days)", default: 30, minimum: 1, maximum: 365 },
        currency: { type: "string", title: "Pay currency", description: "Three-letter code, e.g. EUR.", default: "EUR", pattern: "^[A-Z]{3}$" },
      },
      additionalProperties: false,
    },
    api: { basePath: "/hr" },
  },
  migrationsDir: fileURLToPath(new URL("../migrations", import.meta.url)),
  routes: [
    route({ method: "GET", path: "/config", permission: P.READ, handler: (ctx) => config(ctx) }),
    route({ method: "GET", path: "/summary", permission: P.READ, handler: (ctx) => summary(ctx) }),

    route({ method: "GET", path: "/people", permission: P.READ, query: DirectoryQuery, handler: (ctx, { query }) => directory(ctx, query) }),
    route({ method: "GET", path: "/people/:userId", permission: P.READ, params: User, handler: (ctx, { params }) => getProfile(ctx, params.userId) }),
    route({ method: "PATCH", path: "/people/:userId", permission: P.READ, params: User, body: ProfilePatch, handler: (ctx, { params, body }) => updateProfile(ctx, params.userId, body) }),

    route({ method: "GET", path: "/people/:userId/pay", permission: P.READ, params: User, handler: (ctx, { params }) => listPay(ctx, params.userId) }),
    route({ method: "POST", path: "/people/:userId/pay", permission: P.PAY, params: User, status: 201, body: PayInput, handler: (ctx, { params, body }) => addPay(ctx, params.userId, body) }),
    route({ method: "DELETE", path: "/pay/:id", permission: P.PAY, params: Id, status: 204, handler: (ctx, { params }) => deletePay(ctx, params.id) }),

    route({ method: "GET", path: "/leave", permission: P.READ, query: Year, handler: (ctx, { query }) => leaveOverview(ctx, query.year) }),
    route({ method: "GET", path: "/people/:userId/leave", permission: P.READ, params: User, query: Year, handler: (ctx, { params, query }) => personLeave(ctx, params.userId, query.year) }),
    route({ method: "POST", path: "/people/:userId/leave", permission: P.MANAGE, params: User, status: 201, body: LeaveInput, handler: (ctx, { params, body }) => addLeave(ctx, params.userId, body) }),
    route({ method: "DELETE", path: "/leave/:id", permission: P.MANAGE, params: Id, status: 204, handler: (ctx, { params }) => deleteLeave(ctx, params.id) }),

    route({ method: "GET", path: "/people/:userId/documents", permission: P.READ, params: User, handler: (ctx, { params }) => listDocuments(ctx, params.userId) }),
    route({
      method: "POST", path: "/people/:userId/documents", permission: P.MANAGE, params: User, status: 201, body: DocumentInput, bodyLimit: 10 * 1024 * 1024,
      handler: (ctx, { params, body }) => uploadDocument(ctx, params.userId, body),
    }),
    route({ method: "GET", path: "/documents/expiring", permission: P.MANAGE, handler: (ctx) => expiringDocuments(ctx) }),
    route({ method: "GET", path: "/documents/:id", permission: P.READ, params: Id, handler: (ctx, { params }) => downloadDocument(ctx, params.id) }),
    route({ method: "PATCH", path: "/documents/:id", permission: P.MANAGE, params: Id, body: DocumentPatch, handler: (ctx, { params, body }) => updateDocument(ctx, params.id, body) }),
    route({ method: "DELETE", path: "/documents/:id", permission: P.MANAGE, params: Id, status: 204, handler: (ctx, { params }) => deleteDocument(ctx, params.id) }),

    route({ method: "GET", path: "/templates", permission: P.READ, handler: (ctx) => listTemplates(ctx) }),
    route({ method: "POST", path: "/templates", permission: P.MANAGE, status: 201, body: TemplateInput, handler: (ctx, { body }) => createTemplate(ctx, body) }),
    route({ method: "PUT", path: "/templates/:id", permission: P.MANAGE, params: Id, body: TemplateInput, handler: (ctx, { params, body }) => updateTemplate(ctx, params.id, body) }),
    route({ method: "DELETE", path: "/templates/:id", permission: P.MANAGE, params: Id, status: 204, handler: (ctx, { params }) => deleteTemplate(ctx, params.id) }),

    route({ method: "GET", path: "/checklists", permission: P.READ, query: ChecklistQuery, handler: (ctx, { query }) => listChecklists(ctx, query) }),
    route({ method: "POST", path: "/people/:userId/checklists", permission: P.MANAGE, params: User, status: 201, body: ChecklistInput, handler: (ctx, { params, body }) => assignChecklist(ctx, params.userId, body) }),
    route({ method: "GET", path: "/checklists/:id", permission: P.READ, params: Id, handler: (ctx, { params }) => getChecklist(ctx, params.id) }),
    route({ method: "DELETE", path: "/checklists/:id", permission: P.MANAGE, params: Id, status: 204, handler: (ctx, { params }) => deleteChecklist(ctx, params.id) }),
    route({ method: "PATCH", path: "/tasks/:id", permission: P.READ, params: Id, body: TaskPatch, handler: (ctx, { params, body }) => updateTask(ctx, params.id, body) }),
    route({ method: "GET", path: "/my-tasks", permission: P.READ, handler: (ctx) => myTasks(ctx) }),
  ],
  handlers: {
    "scheduling.time_off.approved": async (ctx, e) => { await onTimeOffApproved(ctx, e.payload as never); },
    "scheduling.time_off.cancelled": async (ctx, e) => { await onTimeOffCancelled(ctx, e.payload as { id: string }); },
    "docs.request.completed": async (ctx, e) => { await onDocsCompleted(ctx, e.payload as never); },
  },
  jobs: {
    document_reminders: job({ label: "Remind about expiring employee documents", everyMinutes: 360, run: remindExpiring }),
  },
});
