import { and, gte, isNotNull, lt, sql } from "drizzle-orm";
import { metric } from "@office/sdk";
import { shifts } from "./schema.ts";
import { paidMinutes } from "./time.ts";

// Everyone's hours are manager information.
const MANAGE = "scheduling:schedule.manage";

export const metrics = {
  "scheduling.hours_worked": metric({
    label: "Hours worked", description: "Clocked hours that started in the period (a shift still running counts up to now).",
    group: "team", unit: "hours", kind: "total", better: "up", permission: MANAGE, link: "/hours",
    compute: async (ctx, r) => {
      const [x] = await ctx.db.execute<{ m: string | null }>(sql`select sum(extract(epoch from (coalesce(clock_out, now()) - clock_in)) / 60) as m
        from scheduling_clock_entries where clock_in >= ${r.start} and clock_in < ${r.end}`) as unknown as { m: string | null }[];
      return Number(x?.m ?? 0) / 60;
    },
  }),
  "scheduling.hours_planned": metric({
    label: "Hours scheduled", description: "Paid hours of published shifts in the period.",
    group: "team", unit: "hours", kind: "total", better: "up", permission: MANAGE, link: "/schedule",
    compute: async (ctx, r) => {
      const rows = await ctx.db.select().from(shifts).where(and(gte(shifts.day, r.from), lt(shifts.day, r.to), isNotNull(shifts.publishedAt)));
      return rows.reduce((a, s) => a + paidMinutes(s.startTime, s.endTime, s.breakMinutes), 0) / 60;
    },
  }),
};
