import { sql, type SQL } from "drizzle-orm";
import { metric, type ModuleContext } from "@office/sdk";
import { settingsOf } from "./service.ts";

// Company-wide totals need the reviewer permission (plain readers only see their own expenses).
const REVIEW = "expenses:expense.review";
const one = async (ctx: ModuleContext, q: SQL, money = true) => {
  const [r] = await ctx.db.execute<{ n: string | null }>(q) as unknown as { n: string | null }[];
  const n = Number(r?.n ?? 0);
  return money ? { value: n / 100, currency: settingsOf(ctx).currency } : n;
};
const approved = sql`status in ('approved', 'paid')`;

export const metrics = {
  "expenses.spent": metric({
    label: "Expenses", description: "Approved and paid expenses dated in the period, tax included.",
    group: "money", unit: "money", kind: "total", better: "down", permission: REVIEW, link: "/expenses",
    compute: (ctx, r) => one(ctx, sql`select sum(total_cents) as n from expenses_expenses
      where ${approved} and currency = ${settingsOf(ctx).currency} and doc_date >= ${r.from} and doc_date < ${r.to}`),
  }),
  "expenses.spent_net": metric({
    label: "Expenses before tax", description: "Approved and paid expenses dated in the period, before tax.",
    group: "money", unit: "money", kind: "total", better: "down", permission: REVIEW, link: "/expenses",
    compute: (ctx, r) => one(ctx, sql`select sum(subtotal_cents) as n from expenses_expenses
      where ${approved} and currency = ${settingsOf(ctx).currency} and doc_date >= ${r.from} and doc_date < ${r.to}`),
  }),
  "expenses.awaiting_approval": metric({
    label: "Expenses to approve", description: "Expenses submitted and waiting for a decision, right now.",
    group: "money", unit: "count", kind: "snapshot", better: "down", permission: REVIEW, link: "/expenses",
    compute: async (ctx, r) => r.current ? one(ctx, sql`select count(*) as n from expenses_expenses where status = 'submitted'`, false) : null,
  }),
};
