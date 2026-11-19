// Mirrors migrations/0001_init.sql (SQL is the source of truth).
import { bigint, date, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (n: string) => timestamp(n, { withTimezone: true });
const cents = (n: string) => bigint(n, { mode: "number" });

export interface Address { line1?: string; line2?: string; postalCode?: string; city?: string; region?: string; country?: string }
export interface BillTo { name: string; contactName?: string; email?: string; phone?: string; taxId?: string; address?: Address }
/** Seller details frozen onto an invoice when it is finalized (logo excluded: it stays in settings). */
export interface Seller {
  name?: string; email?: string; phone?: string; website?: string; registrationNumber?: string; taxId?: string;
  address?: Address; bankName?: string; iban?: string; bic?: string; paymentInstructions?: string; footer?: string;
}

export const invoices = pgTable("invoicing_invoices", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  number: text("number"),
  status: text("status").$type<"draft" | "sent" | "paid" | "void">().notNull(),
  companyId: uuid("company_id"),
  contactId: uuid("contact_id"),
  billTo: jsonb("bill_to").$type<BillTo>().notNull(),
  currency: text("currency").notNull(),
  issueDate: date("issue_date", { mode: "string" }).notNull(),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  notes: text("notes"),
  reference: text("reference"),
  serviceDate: date("service_date", { mode: "string" }),
  seller: jsonb("seller").$type<Seller>(),
  subtotalCents: cents("subtotal_cents").notNull(),
  taxCents: cents("tax_cents").notNull(),
  totalCents: cents("total_cents").notNull(),
  paidCents: cents("paid_cents").notNull(),
  source: text("source").notNull(),
  sourceRef: text("source_ref"),
  sentAt: ts("sent_at"),
  paidAt: ts("paid_at"),
  voidedAt: ts("voided_at"),
  voidReason: text("void_reason"),
  overdueAt: ts("overdue_at"),
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
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
  unitPriceCents: cents("unit_price_cents").notNull(),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull(),
  netCents: cents("net_cents").notNull(),
  taxCents: cents("tax_cents").notNull(),
});

export const payments = pgTable("invoicing_payments", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  invoiceId: uuid("invoice_id").notNull(),
  amountCents: cents("amount_cents").notNull(),
  paidOn: date("paid_on", { mode: "string" }).notNull(),
  method: text("method"),
  reference: text("reference"),
  createdBy: text("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const sequences = pgTable("invoicing_sequences", {
  tenantId: uuid("tenant_id").notNull(),
  period: text("period").notNull(),
  lastValue: integer("last_value").notNull(),
});
