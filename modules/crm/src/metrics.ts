import { sql } from "drizzle-orm";
import { flowSum, inRange, metric, scalar, type MetricSpec } from "@office/sdk";
import { settingsOf } from "./service.ts";

const READ = "crm:deal.read";
export const metrics: Record<string, MetricSpec> = {
  "crm.won_value": metric({
    label: "Deals won", description: "Value of deals won, by close date.", permission: READ, unit: "money", kind: "flow",
    compute: async (ctx, r) => {
      const cur = settingsOf(ctx).currency;
      return { ...(await flowSum(ctx, r, { from: "crm_deals", at: "closed_at", value: "value", where: sql`status = 'won' and currency = ${cur}` })), currency: cur };
    },
  }),
  "crm.pipeline": metric({
    label: "Open pipeline", description: "Value of open deals.", permission: READ, unit: "money", kind: "stock",
    compute: async (ctx) => {
      const cur = settingsOf(ctx).currency;
      return { value: await scalar(ctx, sql`select coalesce(sum(value), 0) as v from crm_deals where status = 'open' and currency = ${cur}`), currency: cur };
    },
  }),
  "crm.win_rate": metric({
    label: "Win rate", description: "Deals won out of deals closed (won or lost) in the period.", permission: READ, unit: "percent", kind: "flow",
    compute: async (ctx, r) => ({
      value: await scalar(ctx, sql`select round(100.0 * count(*) filter (where status = 'won') / nullif(count(*), 0), 1) as v
        from crm_deals where status in ('won', 'lost') and ${inRange("closed_at", r)}`),
    }),
  }),
};
