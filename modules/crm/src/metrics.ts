import { sql, type SQL } from "drizzle-orm";
import { metric, type ModuleContext } from "@office/sdk";
import { settingsOf } from "./service.ts";

const READ = "crm:deal.read";
const row = async (ctx: ModuleContext, q: SQL) =>
  (await ctx.db.execute<Record<string, string | null>>(q) as unknown as Record<string, string | null>[])[0] ?? {};
const money = (ctx: ModuleContext, n: string | null | undefined) => ({ value: Number(n ?? 0) / 100, currency: settingsOf(ctx).currency });

/** Deal values in the CRM's default currency only. */
export const metrics = {
  "crm.won_value": metric({
    label: "Deals won (value)", description: "Value of deals won in the period.",
    group: "sales", unit: "money", kind: "total", better: "up", permission: READ, link: "/deals",
    compute: async (ctx, r) => money(ctx, (await row(ctx, sql`select sum(value_cents) as n from crm_deals
      where status = 'won' and currency = ${settingsOf(ctx).currency} and closed_at >= ${r.start} and closed_at < ${r.end}`)).n),
  }),
  "crm.won_count": metric({
    label: "Deals won", description: "Number of deals won in the period.",
    group: "sales", unit: "count", kind: "total", better: "up", permission: READ, link: "/deals",
    compute: async (ctx, r) => Number((await row(ctx, sql`select count(*) as n from crm_deals
      where status = 'won' and closed_at >= ${r.start} and closed_at < ${r.end}`)).n ?? 0),
  }),
  "crm.new_deals": metric({
    label: "New deals", description: "Deals added in the period.",
    group: "sales", unit: "count", kind: "total", better: "up", permission: READ, link: "/deals",
    compute: async (ctx, r) => Number((await row(ctx, sql`select count(*) as n from crm_deals
      where created_at >= ${r.start} and created_at < ${r.end}`)).n ?? 0),
  }),
  "crm.win_rate": metric({
    label: "Win rate", description: "Share of deals closed in the period that were won.",
    group: "sales", unit: "percent", kind: "total", better: "up", permission: READ, link: "/deals",
    compute: async (ctx, r) => {
      const x = await row(ctx, sql`select count(*) filter (where status = 'won') as won, count(*) as closed from crm_deals
        where status in ('won', 'lost') and closed_at >= ${r.start} and closed_at < ${r.end}`);
      const closed = Number(x.closed ?? 0);
      return closed ? (Number(x.won ?? 0) / closed) * 100 : null;
    },
  }),
  "crm.pipeline_value": metric({
    label: "Open pipeline", description: "Value of deals still open at the end of the period.",
    group: "sales", unit: "money", kind: "snapshot", better: "up", permission: READ, link: "/deals",
    compute: async (ctx, r) => money(ctx, (await row(ctx, sql`select sum(value_cents) as n from crm_deals
      where currency = ${settingsOf(ctx).currency} and created_at < ${r.end}
        and (status = 'open' or (closed_at is not null and closed_at >= ${r.end}))`)).n),
  }),
};
