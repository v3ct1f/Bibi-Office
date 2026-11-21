import { sql, type SQL } from "drizzle-orm";
import { metric, type ModuleContext } from "@office/sdk";
import { settingsOf } from "./service.ts";

const READ = "invoicing:invoice.read";
const cents = async (ctx: ModuleContext, q: SQL) => {
  const [r] = await ctx.db.execute<{ n: string | null }>(q) as unknown as { n: string | null }[];
  return { value: Number(r?.n ?? 0) / 100, currency: settingsOf(ctx).currency };
};

/** Invoices in the default currency only; other currencies can't be added up without exchange rates. */
export const metrics = {
  "invoicing.revenue": metric({
    label: "Revenue", description: "Invoices issued in the period, before tax (drafts and voided invoices left out).",
    group: "money", unit: "money", kind: "total", better: "up", permission: READ, link: "/invoices",
    compute: (ctx, r) => cents(ctx, sql`select sum(subtotal_cents) as n from invoicing_invoices
      where status in ('sent', 'paid') and currency = ${settingsOf(ctx).currency} and issue_date >= ${r.from} and issue_date < ${r.to}`),
  }),
  "invoicing.invoiced": metric({
    label: "Invoiced (incl. tax)", description: "Total of invoices issued in the period, tax included.",
    group: "money", unit: "money", kind: "total", better: "up", permission: READ, link: "/invoices",
    compute: (ctx, r) => cents(ctx, sql`select sum(total_cents) as n from invoicing_invoices
      where status in ('sent', 'paid') and currency = ${settingsOf(ctx).currency} and issue_date >= ${r.from} and issue_date < ${r.to}`),
  }),
  "invoicing.payments_received": metric({
    label: "Payments received", description: "Money received against invoices in the period.",
    group: "money", unit: "money", kind: "total", better: "up", permission: READ, link: "/invoices",
    compute: (ctx, r) => cents(ctx, sql`select sum(p.amount_cents) as n from invoicing_payments p
      join invoicing_invoices i on i.id = p.invoice_id
      where i.currency = ${settingsOf(ctx).currency} and p.paid_on >= ${r.from} and p.paid_on < ${r.to}`),
  }),
  "invoicing.unpaid": metric({
    label: "Unpaid invoices", description: "Money customers still owe at the end of the period.",
    group: "money", unit: "money", kind: "snapshot", better: "down", permission: READ, link: "/invoices",
    compute: (ctx, r) => cents(ctx, sql`select sum(greatest(i.total_cents - coalesce(
        (select sum(p.amount_cents) from invoicing_payments p where p.invoice_id = i.id and p.paid_on < ${r.to}), 0), 0)) as n
      from invoicing_invoices i
      where i.status in ('sent', 'paid', 'void') and i.currency = ${settingsOf(ctx).currency} and i.issue_date < ${r.to}
        and (i.voided_at is null or i.voided_at >= ${r.end})`),
  }),
  "invoicing.overdue": metric({
    label: "Overdue invoices", description: "Money owed on invoices past their due date, at the end of the period.",
    group: "money", unit: "money", kind: "snapshot", better: "down", permission: READ, link: "/invoices",
    compute: (ctx, r) => cents(ctx, sql`select sum(greatest(i.total_cents - coalesce(
        (select sum(p.amount_cents) from invoicing_payments p where p.invoice_id = i.id and p.paid_on < ${r.to}), 0), 0)) as n
      from invoicing_invoices i
      where i.status in ('sent', 'paid', 'void') and i.currency = ${settingsOf(ctx).currency} and i.issue_date < ${r.to}
        and i.due_date < least(${r.to}::date, current_date) and (i.voided_at is null or i.voided_at >= ${r.end})`),
  }),
};
