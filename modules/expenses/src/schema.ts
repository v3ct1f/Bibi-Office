import { bigint, boolean, char, date, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (n: string) => timestamp(n, { withTimezone: true });

export const categories = pgTable("expenses_categories", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  code: text("code"),
  position: integer("position").notNull(),
  archived: boolean("archived").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type ExpenseStatus = "draft" | "submitted" | "approved" | "rejected" | "reimbursed";
export const expenses = pgTable("expenses_expenses", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  submitterId: uuid("submitter_id").notNull(),
  status: text("status").$type<ExpenseStatus>().notNull(),
  spentOn: date("spent_on").notNull(),
  merchant: text("merchant").notNull(),
  categoryId: uuid("category_id"),
  amount: bigint("amount", { mode: "number" }).notNull(),
  tax: bigint("tax", { mode: "number" }).notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  description: text("description"),
  receiptId: uuid("receipt_id"),
  receiptName: text("receipt_name"),
  receiptMime: text("receipt_mime"),
  submittedAt: ts("submitted_at"),
  decidedBy: text("decided_by"),
  decidedAt: ts("decided_at"),
  decisionNote: text("decision_note"),
  reimbursedAt: ts("reimbursed_at"),
  reimbursedBy: text("reimbursed_by"),
  reimbursementRef: text("reimbursement_ref"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
