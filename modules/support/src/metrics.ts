import { sql, type SQL } from "drizzle-orm";
import { metric, type ModuleContext } from "@office/sdk";

const READ = "support:tickets.read";
const num = async (ctx: ModuleContext, q: SQL) => {
  const v = (await ctx.db.execute<{ n: string | null }>(q) as unknown as { n: string | null }[])[0]?.n;
  return v == null ? null : Number(v);
};

export const metrics = {
  "support.new_tickets": metric({
    label: "New tickets", description: "Tickets created in the period.",
    group: "support", unit: "count", kind: "total", better: "down", permission: READ, link: "/support",
    compute: (ctx, r) => num(ctx, sql`select count(*) as n from support_tickets where created_at >= ${r.start} and created_at < ${r.end}`),
  }),
  "support.solved": metric({
    label: "Tickets solved", description: "Tickets marked solved in the period.",
    group: "support", unit: "count", kind: "total", better: "up", permission: READ, link: "/support",
    compute: (ctx, r) => num(ctx, sql`select count(*) as n from support_tickets where status = 'solved' and solved_at >= ${r.start} and solved_at < ${r.end}`),
  }),
  "support.open_tickets": metric({
    label: "Open tickets", description: "Tickets not solved at the end of the period.",
    group: "support", unit: "count", kind: "snapshot", better: "down", permission: READ, link: "/support",
    compute: (ctx, r) => num(ctx, sql`select count(*) as n from support_tickets
      where created_at < ${r.end} and (status <> 'solved' or solved_at >= ${r.end})`),
  }),
  "support.first_response": metric({
    label: "First response time", description: "Average time to the first reply, for tickets created in the period.",
    group: "support", unit: "minutes", kind: "total", better: "down", permission: READ, link: "/support",
    compute: (ctx, r) => num(ctx, sql`select avg(extract(epoch from (first_response_at - created_at)) / 60) as n from support_tickets
      where first_response_at is not null and created_at >= ${r.start} and created_at < ${r.end}`),
  }),
  "support.targets_missed": metric({
    label: "Response targets missed", description: "Tickets created in the period whose first reply came late, or is late now.",
    group: "support", unit: "count", kind: "total", better: "down", permission: READ, link: "/support",
    compute: (ctx, r) => num(ctx, sql`select count(*) as n from support_tickets
      where first_response_due is not null and created_at >= ${r.start} and created_at < ${r.end}
        and coalesce(first_response_at, now()) > first_response_due`),
  }),
};
