import { sql } from "drizzle-orm";
import { metric, scalar, type MetricSpec } from "@office/sdk";

export const metrics: Record<string, MetricSpec> = {
  "hr.headcount": metric({
    label: "Headcount", description: "People currently employed (started and not left).", permission: "hr:directory.read", unit: "count", kind: "stock",
    compute: async (ctx) => ({
      value: await scalar(ctx, sql`select count(*) as v from hr_employees where true
        and start_date <= current_date and (end_date is null or end_date >= current_date)`),
    }),
  }),
  "hr.off_today": metric({
    label: "Off today", description: "People on approved leave today.", permission: "hr:directory.read", unit: "count", kind: "stock",
    compute: async (ctx) => ({
      value: await scalar(ctx, sql`select count(distinct employee_id) as v from hr_leave_requests where status = 'approved'
        and current_date between start_date and end_date`),
    }),
  }),
};
