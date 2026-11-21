import { sql } from "drizzle-orm";
import { metric, type ModuleContext } from "@office/sdk";
import { currencyOf } from "./service.ts";

const READ = "inventory:stock.read";
const n = async (ctx: ModuleContext, q: ReturnType<typeof sql>) =>
  Number((await ctx.db.execute<{ n: string | null }>(q) as unknown as { n: string | null }[])[0]?.n ?? 0);

export const metrics = {
  "inventory.low_stock": metric({
    label: "Items low on stock", description: "Items at or below their minimum stock, right now.",
    group: "operations", unit: "count", kind: "snapshot", better: "down", permission: READ, link: "/inventory",
    compute: async (ctx, r) => r.current
      ? n(ctx, sql`select count(*) as n from inventory_items where not archived and min_stock > 0 and stock <= min_stock`)
      : null,
  }),
  "inventory.purchases": metric({
    label: "Purchases received", description: "Cost of purchase orders received in the period.",
    group: "operations", unit: "money", kind: "total", better: "down", permission: READ, link: "/purchase-orders",
    compute: async (ctx, r) => ({
      value: await n(ctx, sql`select sum(coalesce(l.received_qty, l.quantity) * l.unit_cost_cents) as n
        from inventory_orders o join inventory_order_lines l on l.order_id = o.id
        where o.status = 'received' and o.currency = ${currencyOf(ctx)} and o.received_at >= ${r.start} and o.received_at < ${r.end}`) / 100,
      currency: currencyOf(ctx),
    }),
  }),
};
