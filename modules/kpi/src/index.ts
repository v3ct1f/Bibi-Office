import { fileURLToPath } from "node:url";
import { z } from "zod";
import { defineModule, route } from "@office/sdk";
import { create, DashboardIn, DashboardPatch, get, list, P, remove, seed, update } from "./service.ts";

const Id = z.object({ id: z.uuid() });

export default defineModule({
  manifest: {
    key: "kpi",
    name: "KPI dashboard",
    version: "1.0.0",
    office: "^1.0",
    description: "Dashboards of key numbers from your other modules (revenue, overdue invoices, pipeline, spend, tickets, stock and more) with date ranges, comparisons and targets.",
    permissions: {
      declares: [
        { key: P.read, label: "See KPI dashboards", defaultRoles: ["member"] },
        { key: P.manage, label: "Arrange dashboards and set targets" },
      ],
      requires: [],
    },
    entities: ["dashboard"],
    events: { emits: [], subscribes: [] },
    workflow: { triggers: [], actions: [] },
    ui: {
      slots: [
        { slot: "nav.main", label: "KPIs", icon: "gauge", route: "/dashboards", permission: P.read },
        { slot: "dashboard.widget", label: "KPIs this month", component: "KpiWidget", permission: P.read },
      ],
    },
    settings: { type: "object", properties: {}, additionalProperties: false },
    api: { basePath: "/kpi" },
    lifecycle: ["enable"],
  },
  migrationsDir: fileURLToPath(new URL("../migrations", import.meta.url)),
  lifecycle: { enable: (ctx) => seed(ctx) },
  routes: [
    route({ method: "GET", path: "/dashboards", permission: P.read, handler: (ctx) => list(ctx) }),
    route({ method: "POST", path: "/dashboards", permission: P.manage, body: DashboardIn, status: 201, handler: (ctx, { body }) => create(ctx, body) }),
    route({ method: "GET", path: "/dashboards/:id", permission: P.read, params: Id, handler: (ctx, { params }) => get(ctx, params.id) }),
    route({ method: "PATCH", path: "/dashboards/:id", permission: P.manage, params: Id, body: DashboardPatch, handler: (ctx, { params, body }) => update(ctx, params.id, body) }),
    route({ method: "DELETE", path: "/dashboards/:id", permission: P.manage, params: Id, handler: (ctx, { params }) => remove(ctx, params.id) }),
  ],
});
