import { sql } from "drizzle-orm";
import { flowSum, metric, scalar, type MetricSpec } from "@office/sdk";
import { settingsOf } from "./service.ts";

const READ = "invoicing:invoice.read";
const otherCurrency = (from: string, cur: string, extra = sql``) =>
  sql`select count(*) as v from ${sql.raw(from)} where i.currency <> ${cur} ${extra}`;

export const metrics: Record<string, MetricSpec> = {
  "invoicing.revenue": metric({
    label: "Payments received", description: "Money received on invoices, by payment date.", permission: READ, unit: "money", kind: "flow",
    compute: async (ctx, r) => {
      const cur = settingsOf(ctx).currency;
      const from = "invoicing_payments p join invoicing_invoices i on i.tenant_id = p.tenant_id and i.id = p.invoice_id";
      const v = await flowSum(ctx, r, { from, at: "p.paid_on", isDate: true, value: "p.amount", where: sql`i.currency = ${cur}` });
      const excluded = await scalar(ctx, otherCurrency(from, cur, sql`and p.paid_on between ${r.fromDate}::date and ${r.toDate}::date`));
      return { ...v, currency: cur, excluded: excluded ?? 0 };
    },
  }),
  "invoicing.invoiced": metric({
    label: "Invoiced", description: "Total of invoices issued, by issue date (void invoices left out).", permission: READ, unit: "money", kind: "flow",
    compute: async (ctx, r) => {
      const cur = settingsOf(ctx).currency;
      const v = await flowSum(ctx, r, { from: "invoicing_invoices i", at: "i.issue_date", isDate: true, value: "i.total", where: sql`i.status in ('open', 'paid') and i.currency = ${cur}` });
      return { ...v, currency: cur };
    },
  }),
  "invoicing.outstanding": metric({
    label: "Outstanding", description: "Unpaid balance of open invoices.", permission: READ, unit: "money", kind: "stock",
    compute: async (ctx) => {
      const cur = settingsOf(ctx).currency;
      return { value: await scalar(ctx, sql`select coalesce(sum(total - amount_paid), 0) as v from invoicing_invoices where status = 'open' and currency = ${cur}`), currency: cur };
    },
  }),
  "invoicing.overdue": metric({
    label: "Overdue", description: "Unpaid balance of open invoices past their due date.", permission: READ, unit: "money", kind: "stock", lowerIsBetter: true,
    compute: async (ctx) => {
      const cur = settingsOf(ctx).currency;
      return { value: await scalar(ctx, sql`select coalesce(sum(total - amount_paid), 0) as v from invoicing_invoices where status = 'open' and currency = ${cur} and due_date < (now() at time zone 'UTC')::date`), currency: cur };
    },
  }),
};
