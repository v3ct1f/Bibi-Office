import { sql } from "drizzle-orm";
import { metric } from "@office/sdk";

// Everyone's leave is HR information.
const MANAGE = "hr:people.manage";
const days = (kinds: string[]) => metric({
  label: kinds.length === 1 ? "Sick days" : "Leave days",
  description: kinds.length === 1 ? "Sick leave days starting in the period." : "Days of vacation, sick and other leave starting in the period.",
  group: "team", unit: "days", kind: "total", better: "down", permission: MANAGE, link: "/people",
  compute: async (ctx, r) => {
    const [x] = await ctx.db.execute<{ n: string | null }>(sql`select sum(days) as n from hr_leave
      where kind in ${sql.raw(`(${kinds.map((k) => `'${k}'`).join(", ")})`)} and start_date >= ${r.from} and start_date < ${r.to}`) as unknown as { n: string | null }[];
    return Number(x?.n ?? 0);
  },
});

export const metrics = {
  "hr.leave_days": days(["vacation", "sick", "personal", "other"]),
  "hr.sick_days": days(["sick"]),
};
