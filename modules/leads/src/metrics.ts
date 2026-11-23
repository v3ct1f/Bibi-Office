import { sql, type SQL } from "drizzle-orm";
import { metric, type ModuleContext } from "@office/sdk";

const READ = "leads:lead.read";
const row = async (ctx: ModuleContext, q: SQL) =>
  (await ctx.db.execute<Record<string, string | null>>(q) as unknown as Record<string, string | null>[])[0] ?? {};

export const metrics = {
  "leads.new_leads": metric({
    label: "New leads", description: "Leads added in the period (by hand, from the web form or by workflows).",
    group: "sales", unit: "count", kind: "total", better: "up", permission: READ, link: "/leads",
    compute: async (ctx, r) => Number((await row(ctx, sql`select count(*) as n from leads_leads
      where created_at >= ${r.start} and created_at < ${r.end}`)).n ?? 0),
  }),
  "leads.converted": metric({
    label: "Leads converted", description: "Leads that became customers in the period.",
    group: "sales", unit: "count", kind: "total", better: "up", permission: READ, link: "/leads",
    compute: async (ctx, r) => Number((await row(ctx, sql`select count(*) as n from leads_leads
      where converted_at >= ${r.start} and converted_at < ${r.end}`)).n ?? 0),
  }),
  "leads.conversion_rate": metric({
    label: "Lead conversion rate", description: "Share of leads decided in the period that became customers (the rest were disqualified).",
    group: "sales", unit: "percent", kind: "total", better: "up", permission: READ, link: "/leads",
    compute: async (ctx, r) => {
      const x = await row(ctx, sql`select count(*) filter (where status = 'converted') as won, count(*) as decided from leads_leads
        where status in ('converted', 'disqualified') and status_changed_at >= ${r.start} and status_changed_at < ${r.end}`);
      const decided = Number(x.decided ?? 0);
      return decided ? (Number(x.won ?? 0) / decided) * 100 : null;
    },
  }),
  "leads.open_leads": metric({
    label: "Open leads", description: "Leads still being worked on (new, contacted or qualified) right now.",
    group: "sales", unit: "count", kind: "snapshot", better: "up", permission: READ, link: "/leads",
    compute: async (ctx) => Number((await row(ctx, sql`select count(*) as n from leads_leads
      where status in ('new', 'contacted', 'qualified')`)).n ?? 0),
  }),
};
