import { sql } from "drizzle-orm";
import { flowSum, metric, scalar, type MetricSpec } from "@office/sdk";
import { P } from "./service.ts";

export const metrics: Record<string, MetricSpec> = {
  "docs.signed": metric({
    label: "Documents signed", description: "Documents signed by everyone, by completion date.", permission: P.read, unit: "count", kind: "flow",
    compute: (ctx, r) => flowSum(ctx, r, { from: "docs_documents", at: "completed_at", value: "1", where: sql`status = 'completed'` }),
  }),
  "docs.waiting": metric({
    label: "Waiting for signatures", description: "Documents sent and not yet signed by everyone.", permission: P.read, unit: "count", kind: "stock",
    compute: async (ctx) => ({ value: await scalar(ctx, sql`select count(*) as v from docs_documents where status = 'sent'`) }),
  }),
};
