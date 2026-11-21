import { fileURLToPath } from "node:url";
import { z } from "zod";
import { defineModule, job, route } from "@office/sdk";
import {
  BoardInput, BoardPatch, boardValues, config, createBoard, createManual, deleteBoard, deleteManual, digestJob, getBoard, getManual,
  listBoards, listManual, listTargets, ManualInput, ManualPatch, ManualValueInput, P, sendDigest, setManualValue, setTarget, TargetInput,
  testEmail, updateBoard, updateManual, ValuesQuery,
} from "./service.ts";

const Id = z.object({ id: z.uuid() });
const sec = (title: string) => ({ type: "string", title, enum: ["tls", "starttls", "none"], default: "tls", description: "tls = SSL/TLS (usually port 465), starttls = usually port 587" });

export default defineModule({
  manifest: {
    key: "kpi",
    name: "KPI dashboard",
    version: "1.0.0",
    office: "^1.0",
    description: "Your key numbers on shared boards: revenue, payments, expenses, deals, hours, stock and support, live from your other features. Set targets, compare with last month or last year, add numbers you track by hand, and email a weekly summary.",
    icon: "chart",
    category: "other",
    permissions: {
      declares: [
        { key: P.READ, label: "See the KPI boards (each number still needs access to its feature)" },
        { key: P.MANAGE, label: "Make boards, set targets, add hand-typed numbers and the weekly email" },
        { key: P.VALUES, label: "Type in values for hand-typed numbers" },
      ],
      requires: ["core:metrics.read", "core:members.read"],
    },
    roles: { manager: [P.READ, P.MANAGE, P.VALUES], member: [P.READ], viewer: [P.READ] },
    entities: ["board"],
    events: { emits: [], subscribes: [] },
    workflow: { triggers: [], actions: [] },
    ui: {
      slots: [
        { slot: "nav.main", label: "KPIs", icon: "chart", route: "/kpi", permission: P.READ },
        { slot: "dashboard.widget", label: "Key numbers", component: "KpiWidget", permission: P.READ },
      ],
    },
    settings: {
      type: "object",
      properties: {
        timeZone: { type: "string", title: "Time zone", description: "Days, weeks and months start at midnight here, e.g. Europe/Madrid. Also the time of the weekly email.", default: "UTC", maxLength: 60 },
        fromAddress: { type: "string", title: "Send from (email address)", description: "Weekly KPI emails come from this address.", maxLength: 320, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" },
        fromName: { type: "string", title: "Sender name", description: "For example your company name.", maxLength: 100 },
        smtpHost: { type: "string", title: "Outgoing mail server (SMTP)", description: "For example smtp.gmail.com. You can use the same details as your Support mailbox.", maxLength: 255 },
        smtpPort: { type: "integer", title: "SMTP port", minimum: 1, maximum: 65535, default: 465 },
        smtpSecurity: sec("SMTP security"),
        smtpUser: { type: "string", title: "SMTP user name", description: "Usually the email address", maxLength: 320 },
        smtpPassword: { type: "string", title: "SMTP password", "x-secret": true, maxLength: 500 },
      },
      additionalProperties: false,
    },
    api: { basePath: "/kpi" },
  },
  migrationsDir: fileURLToPath(new URL("../migrations", import.meta.url)),
  routes: [
    route({ method: "GET", path: "/config", permission: P.READ, handler: (ctx) => config(ctx) }),
    route({ method: "POST", path: "/email/test", permission: P.MANAGE, handler: (ctx) => testEmail(ctx) }),

    route({ method: "GET", path: "/boards", permission: P.READ, handler: (ctx) => listBoards(ctx) }),
    route({ method: "POST", path: "/boards", permission: P.MANAGE, status: 201, body: BoardInput, handler: (ctx, { body }) => createBoard(ctx, body) }),
    route({ method: "GET", path: "/boards/:id", permission: P.READ, params: Id, handler: (ctx, { params }) => getBoard(ctx, params.id) }),
    route({ method: "PATCH", path: "/boards/:id", permission: P.MANAGE, params: Id, body: BoardPatch, handler: (ctx, { params, body }) => updateBoard(ctx, params.id, body) }),
    route({ method: "DELETE", path: "/boards/:id", permission: P.MANAGE, params: Id, status: 204, handler: (ctx, { params }) => deleteBoard(ctx, params.id) }),
    route({ method: "GET", path: "/boards/:id/values", permission: P.READ, params: Id, query: ValuesQuery, handler: (ctx, { params, query }) => boardValues(ctx, params.id, query) }),
    route({ method: "POST", path: "/boards/:id/email", permission: P.MANAGE, params: Id, handler: (ctx, { params }) => sendDigest(ctx, params.id) }),

    route({ method: "GET", path: "/targets", permission: P.READ, handler: (ctx) => listTargets(ctx) }),
    route({ method: "PUT", path: "/targets", permission: P.MANAGE, body: TargetInput, handler: (ctx, { body }) => setTarget(ctx, body) }),

    route({ method: "GET", path: "/manual", permission: P.READ, handler: (ctx) => listManual(ctx) }),
    route({ method: "POST", path: "/manual", permission: P.MANAGE, status: 201, body: ManualInput, handler: (ctx, { body }) => createManual(ctx, body) }),
    route({ method: "GET", path: "/manual/:id", permission: P.READ, params: Id, handler: (ctx, { params }) => getManual(ctx, params.id) }),
    route({ method: "PATCH", path: "/manual/:id", permission: P.MANAGE, params: Id, body: ManualPatch, handler: (ctx, { params, body }) => updateManual(ctx, params.id, body) }),
    route({ method: "DELETE", path: "/manual/:id", permission: P.MANAGE, params: Id, status: 204, handler: (ctx, { params }) => deleteManual(ctx, params.id) }),
    route({ method: "PUT", path: "/manual/:id/values", permission: P.VALUES, params: Id, body: ManualValueInput, handler: (ctx, { params, body }) => setManualValue(ctx, params.id, body) }),
  ],
  jobs: {
    digest: job({ label: "Send weekly KPI emails", everyMinutes: 15, run: digestJob }),
  },
});
