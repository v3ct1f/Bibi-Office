import { sql } from "drizzle-orm";
import { metric, scalar, type MetricSpec } from "@office/sdk";
import { settingsOf } from "./service.ts";

const READ = "inventory:items.read";
export const metrics: Record<string, MetricSpec> = {
  "inventory.stock_value": metric({
    label: "Stock value", description: "On-hand quantity × cost, all locations.", permission: READ, unit: "money", kind: "stock",
    compute: async (ctx) => ({
      value: await scalar(ctx, sql`select coalesce(round(sum(s.quantity * i.cost)), 0) as v from inventory_stock s
        join inventory_items i on i.tenant_id = s.tenant_id and i.id = s.item_id where not i.archived`),
      currency: settingsOf(ctx).currency,
    }),
  }),
  "inventory.low_stock": metric({
    label: "Items to reorder", description: "Items at or below their reorder point.", permission: READ, unit: "count", kind: "stock", lowerIsBetter: true,
    compute: async (ctx) => ({
      value: await scalar(ctx, sql`select count(*) as v from inventory_items i where not i.archived and i.reorder_point is not null
        and coalesce((select sum(quantity) from inventory_stock s where s.tenant_id = i.tenant_id and s.item_id = i.id), 0) <= i.reorder_point`),
    }),
  }),
};
