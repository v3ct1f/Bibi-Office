import { sql } from "drizzle-orm";
import { flowSum, inRange, metric, scalar, type MetricSpec } from "@office/sdk";

const READ = "support:tickets.read";
export const metrics: Record<string, MetricSpec> = {
  "support.new_tickets": metric({
    label: "New tickets", description: "Tickets opened in the period.", permission: READ, unit: "count", kind: "flow",
    compute: (ctx, r) => flowSum(ctx, r, { from: "support_tickets", at: "created_at", value: "1" }),
  }),
  "support.open_tickets": metric({
    label: "Open tickets", description: "Tickets not solved yet.", permission: READ, unit: "count", kind: "stock", lowerIsBetter: true,
    compute: async (ctx) => ({ value: await scalar(ctx, sql`select count(*) as v from support_tickets where status <> 'solved'`) }),
  }),
  "support.first_response": metric({
    label: "First response time", description: "Median hours to the first reply, for tickets opened in the period.", permission: READ, unit: "hours", kind: "flow", lowerIsBetter: true,
    compute: async (ctx, r) => ({
      value: await scalar(ctx, sql`select round((percentile_cont(0.5) within group (order by extract(epoch from first_response_at - created_at)) / 3600)::numeric, 1) as v
        from support_tickets where first_response_at is not null and ${inRange("created_at", r)}`),
    }),
  }),
};
