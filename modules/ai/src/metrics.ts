import { flowSum, metric, type MetricSpec } from "@office/sdk";
import { sql } from "drizzle-orm";
import { P } from "./service.ts";

export const metrics: Record<string, MetricSpec> = {
  "ai.summaries": metric({
    label: "AI summaries", description: "Summaries made in the period.", permission: P.read, unit: "count", kind: "flow",
    compute: (ctx, r) => flowSum(ctx, r, { from: "ai_summaries", at: "created_at", value: "1", where: sql`status = 'done'` }),
  }),
};
