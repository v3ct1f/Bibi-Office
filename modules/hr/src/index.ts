import { fileURLToPath } from "node:url";
import { z } from "zod";
import { action, defineModule, file, route } from "@office/sdk";
import {
  addHoliday, cancelLeave, createEmployee, createType, decideLeave, DecideIn, DirectoryQuery, DocQuery, EmployeeIn, EmployeePatch, getEmployee,
  HolidayIn, LeaveIn, LeaveQuery, LeaveTypeIn, LeaveTypePatch, listDocs, listEmployees, listHolidays, listLeave, listTypes, mine, P, RangeQuery,
  readDoc, removeDoc, removeHoliday, requestLeave, seedTypes, SelfPatch, SETTINGS_SCHEMA, summary, today, updateEmployee, updateSelf, updateType,
  uploadDoc, whosOff,
} from "./service.ts";
import { metrics } from "./metrics.ts";

const Id = z.object({ id: z.uuid() });
const DocId = z.object({ id: z.uuid(), docId: z.uuid() });
const EVENTS = ["hr.employee.created", "hr.employee.updated", "hr.employee.left", "hr.leave.requested", "hr.leave.approved", "hr.leave.rejected", "hr.leave.cancelled"];

export default defineModule({
  manifest: {
    key: "hr",
    name: "People",
    version: "1.0.0",
    office: "^1.0",
    description: "Employee directory and records, managers, documents, and time off with balances, approvals and a team calendar.",
    permissions: {
      declares: [
        { key: P.directory, label: "See the people directory and who's away", defaultRoles: ["member"] },
        { key: P.request, label: "Request own time off", defaultRoles: ["member"] },
        { key: P.approve, label: "Approve anyone's time off" },
        { key: P.manage, label: "Manage employee records, documents, leave types and holidays" },
      ],
      requires: ["core:documents.read", "core:documents.write", "core:mail.send"],
    },
    entities: ["employee", "leave_request"],
    events: { emits: EVENTS.map((type) => ({ type })), subscribes: [] },
    workflow: {
      triggers: EVENTS,
      actions: [{ key: "hr.decide_leave", label: "Approve or reject time off" }],
    },
    ui: {
      slots: [
        { slot: "nav.main", label: "People", icon: "users", route: "/people", permission: P.directory },
        { slot: "dashboard.widget", label: "Who's away", component: "AwayWidget", permission: P.directory },
      ],
    },
    settings: SETTINGS_SCHEMA as unknown as Record<string, unknown>,
    api: { basePath: "/hr" },
    lifecycle: ["enable"],
  },
  metrics,
  migrationsDir: fileURLToPath(new URL("../migrations", import.meta.url)),
  lifecycle: { enable: (ctx) => seedTypes(ctx) },
  routes: [
    // people
    route({ method: "GET", path: "/employees", permission: P.directory, query: DirectoryQuery, handler: (ctx, { query }) => listEmployees(ctx, query) }),
    route({ method: "POST", path: "/employees", permission: P.manage, body: EmployeeIn, status: 201, handler: (ctx, { body }) => createEmployee(ctx, body) }),
    route({ method: "GET", path: "/employees/:id", permission: P.directory, params: Id, handler: (ctx, { params }) => getEmployee(ctx, params.id) }),
    route({ method: "PATCH", path: "/employees/:id", permission: P.manage, params: Id, body: EmployeePatch, handler: (ctx, { params, body }) => updateEmployee(ctx, params.id, body) }),
    route({ method: "GET", path: "/me", permission: P.directory, handler: (ctx) => mine(ctx) }),
    route({ method: "PATCH", path: "/me", permission: P.directory, body: SelfPatch, handler: (ctx, { body }) => updateSelf(ctx, body) }),
    // documents (HR uploads; HR and the person read)
    route({ method: "GET", path: "/employees/:id/documents", permission: P.directory, params: Id, handler: (ctx, { params }) => listDocs(ctx, params.id) }),
    route({ method: "POST", path: "/employees/:id/documents", permission: P.manage, params: Id, query: DocQuery, upload: true, status: 201,
      handler: (ctx, { params, query, file: f }) => uploadDoc(ctx, params.id, query, f) }),
    route({ method: "GET", path: "/employees/:id/documents/:docId", permission: P.directory, params: DocId,
      handler: async (ctx, { params }) => { const { file: f, bytes } = await readDoc(ctx, params.id, params.docId); return file({ contentType: f.mime, filename: f.filename, body: bytes, inline: f.mime === "application/pdf" || f.mime.startsWith("image/") }); } }),
    route({ method: "DELETE", path: "/employees/:id/documents/:docId", permission: P.manage, params: DocId, handler: (ctx, { params }) => removeDoc(ctx, params.id, params.docId) }),
    // time off
    route({ method: "GET", path: "/leave", permission: P.directory, query: LeaveQuery, handler: (ctx, { query }) => listLeave(ctx, query) }),
    route({ method: "POST", path: "/leave", permission: P.request, body: LeaveIn, status: 201, handler: (ctx, { body }) => requestLeave(ctx, body) }),
    route({ method: "POST", path: "/leave/:id/approve", permission: P.directory, params: Id, body: DecideIn, handler: (ctx, { params, body }) => decideLeave(ctx, params.id, "approved", body.note) }),
    route({ method: "POST", path: "/leave/:id/reject", permission: P.directory, params: Id, body: DecideIn, handler: (ctx, { params, body }) => decideLeave(ctx, params.id, "rejected", body.note) }),
    route({ method: "POST", path: "/leave/:id/cancel", permission: P.directory, params: Id, handler: (ctx, { params }) => cancelLeave(ctx, params.id) }),
    route({ method: "GET", path: "/calendar", permission: P.directory, query: RangeQuery, handler: (ctx, { query }) => whosOff(ctx, query.from, query.to) }),
    route({ method: "GET", path: "/summary", permission: P.directory, handler: (ctx) => summary(ctx) }),
    // setup
    route({ method: "GET", path: "/leave-types", permission: P.directory, handler: async (ctx) => ({ data: await listTypes(ctx) }) }),
    route({ method: "POST", path: "/leave-types", permission: P.manage, body: LeaveTypeIn, status: 201, handler: (ctx, { body }) => createType(ctx, body) }),
    route({ method: "PATCH", path: "/leave-types/:id", permission: P.manage, params: Id, body: LeaveTypePatch, handler: (ctx, { params, body }) => updateType(ctx, params.id, body) }),
    route({ method: "GET", path: "/holidays", permission: P.directory, query: z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }),
      handler: async (ctx, { query }) => ({ data: await listHolidays(ctx, query.year ?? Number(today(ctx).slice(0, 4))) }) }),
    route({ method: "POST", path: "/holidays", permission: P.manage, body: HolidayIn, status: 201, handler: (ctx, { body }) => addHoliday(ctx, body) }),
    route({ method: "DELETE", path: "/holidays/:id", permission: P.manage, params: Id, handler: (ctx, { params }) => removeHoliday(ctx, params.id) }),
  ],
  actions: {
    "hr.decide_leave": action({
      label: "Approve or reject time off",
      input: z.object({ id: z.uuid().describe("leave request id, e.g. {{payload.id}}"), decision: z.enum(["approve", "reject"]), note: z.string().max(1000).optional() }),
      run: async (ctx, i) => {
        const r = await decideLeave(ctx, i.id, i.decision === "approve" ? "approved" : "rejected", i.note ?? (i.decision === "reject" ? "Rejected by workflow" : undefined));
        return { id: r.id, status: r.status };
      },
    }),
  },
});
