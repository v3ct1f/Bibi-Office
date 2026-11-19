// Mirrors migrations/0001_init.sql (SQL is the source of truth).
import { bigint, customType, date, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (n: string) => timestamp(n, { withTimezone: true });
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export type ExpenseStatus = "draft" | "submitted" | "approved" | "rejected" | "paid";
export type ExpenseKind = "receipt" | "invoice";
export type HistoryAction = "created" | "edited" | "submitted" | "approved" | "rejected" | "paid";

export const files = pgTable("expenses_files", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  data: bytea("data").notNull(),
  uploadedBy: uuid("uploaded_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const expenses = pgTable("expenses_expenses", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  kind: text("kind").$type<ExpenseKind>().notNull(),
  status: text("status").$type<ExpenseStatus>().notNull(),
  employeeId: uuid("employee_id").notNull(),
  vendor: text("vendor").notNull(),
  docDate: date("doc_date").notNull(),
  dueDate: date("due_date"),
  invoiceNumber: text("invoice_number"),
  category: text("category"),
  description: text("description"),
  currency: text("currency").notNull(),
  subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull(),
  taxCents: bigint("tax_cents", { mode: "number" }).notNull(),
  totalCents: bigint("total_cents", { mode: "number" }).notNull(),
  fileId: uuid("file_id"),
  ocrText: text("ocr_text"),
  submittedAt: ts("submitted_at"),
  decidedBy: uuid("decided_by"),
  decidedAt: ts("decided_at"),
  decisionComment: text("decision_comment"),
  paidAt: ts("paid_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const lines = pgTable("expenses_lines", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  expenseId: uuid("expense_id").notNull(),
  position: integer("position").notNull(),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
});

export const history = pgTable("expenses_history", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  expenseId: uuid("expense_id").notNull(),
  action: text("action").$type<HistoryAction>().notNull(),
  actorId: uuid("actor_id"),
  comment: text("comment"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
