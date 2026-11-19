import { bigint, char, date, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const money = (n: string) => bigint(n, { mode: "number" });
const ts = (n: string) => timestamp(n, { withTimezone: true });

export interface PartySnapshot { name: string; email?: string | null; address?: string | null; taxId?: string | null; paymentInstructions?: string | null; footer?: string | null }

export const invoices = pgTable("invoicing_invoices", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  number: text("number"),
  status: text("status").$type<"draft" | "open" | "paid" | "void">().notNull(),
  contactId: uuid("contact_id"),
  companyId: uuid("company_id"),
  currency: char("currency", { length: 3 }).notNull(),
  issueDate: date("issue_date"),
  dueDate: date("due_date"),
  notes: text("notes"),
  customer: jsonb("customer").$type<PartySnapshot>(),
  seller: jsonb("seller").$type<PartySnapshot>(),
  subtotal: money("subtotal").notNull(),
  taxTotal: money("tax_total").notNull(),
  total: money("total").notNull(),
  amountPaid: money("amount_paid").notNull(),
  source: text("source"),
  sentAt: ts("sent_at"),
  overdueAt: ts("overdue_at"),
  paidAt: ts("paid_at"),
  voidedAt: ts("voided_at"),
  voidReason: text("void_reason"),
  reminderCount: integer("reminder_count").notNull(),
  lastRemindedAt: ts("last_reminded_at"),
  createdBy: text("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const lines = pgTable("invoicing_invoice_lines", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  position: integer("position").notNull(),
  description: text("description").notNull(),
  quantityMilli: money("quantity_milli").notNull(),
  unitPrice: money("unit_price").notNull(),
  taxRateBp: integer("tax_rate_bp").notNull(),
  net: money("net").notNull(),
  tax: money("tax").notNull(),
});

export const payments = pgTable("invoicing_payments", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  amount: money("amount").notNull(),
  paidOn: date("paid_on").notNull(),
  method: text("method").$type<"bank_transfer" | "card" | "cash" | "other">().notNull(),
  reference: text("reference"),
  createdBy: text("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const sequences = pgTable("invoicing_sequences", {
  tenantId: uuid("tenant_id").notNull(),
  scope: text("scope").notNull(),
  lastValue: money("last_value").notNull(),
});
