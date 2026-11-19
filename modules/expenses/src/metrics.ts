import { sql } from "drizzle-orm";
import { flowSum, metric, scalar, type MetricSpec } from "@office/sdk";
import { settingsOf } from "./service.ts";

export const metrics: Record<string, MetricSpec> = {
  "expenses.spend": metric({
    label: "Approved spend", description: "Approved and reimbursed expenses, by date spent.", permission: "expenses:expense.read_all", unit: "money", kind: "flow",
    compute: async (ctx, r) => {
      const cur = settingsOf(ctx).currency;
      return { ...(await flowSum(ctx, r, { from: "expenses_expenses", at: "spent_on", isDate: true, value: "amount", where: sql`status in ('approved', 'reimbursed') and currency = ${cur}` })), currency: cur };
    },
  }),
  "expenses.to_approve": metric({
    label: "Waiting for approval", description: "Expenses submitted and not yet approved or rejected.", permission: "expenses:expense.approve", unit: "count", kind: "stock", lowerIsBetter: true,
    compute: async (ctx) => ({ value: await scalar(ctx, sql`select count(*) as v from expenses_expenses where status = 'submitted'`) }),
  }),
};
