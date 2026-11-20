// Mirrors migrations/0001_init.sql (SQL is the source of truth).
import { bigint, customType, date, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (n: string) => timestamp(n, { withTimezone: true });
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
const num = (n: string, precision: number, scale: number) => numeric(n, { precision, scale, mode: "number" });

export const EMPLOYMENT = ["full_time", "part_time", "temporary", "freelance", "intern"] as const;
export type Employment = (typeof EMPLOYMENT)[number];
export const BASIS = ["hourly", "monthly", "yearly"] as const;
export type Basis = (typeof BASIS)[number];
/** Time away (counted as taken) vs. changes to the allowance. */
export const LEAVE_KINDS = ["vacation", "sick", "personal", "other"] as const;
export const ALLOWANCE_KINDS = ["adjustment", "carry_over"] as const;
export type LeaveKind = (typeof LEAVE_KINDS)[number] | (typeof ALLOWANCE_KINDS)[number];
export const DOC_CATEGORIES = ["contract", "id", "certificate", "other"] as const;
export type DocCategory = (typeof DOC_CATEGORIES)[number];
export const CHECKLIST_KINDS = ["onboarding", "offboarding", "other"] as const;
export type ChecklistKind = (typeof CHECKLIST_KINDS)[number];
export const TASK_OWNERS = ["employee", "manager", "hr"] as const;
export type TaskOwner = (typeof TASK_OWNERS)[number];
export interface TemplateItem { title: string; owner: TaskOwner; dueDays: number }

export const employees = pgTable("hr_employees", {
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
  jobTitle: text("job_title"),
  department: text("department"),
  managerId: uuid("manager_id"),
  employmentType: text("employment_type").$type<Employment>(),
  weeklyHours: num("weekly_hours", 5, 2),
  startDate: date("start_date"),
  endDate: date("end_date"),
  workPhone: text("work_phone"),
  birthDate: date("birth_date"),
  personalEmail: text("personal_email"),
  personalPhone: text("personal_phone"),
  address: text("address"),
  emergencyName: text("emergency_name"),
  emergencyRelation: text("emergency_relation"),
  emergencyPhone: text("emergency_phone"),
  notes: text("notes"),
  allowanceDays: num("allowance_days", 5, 1),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.userId] })]);

export const pay = pgTable("hr_pay", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
  effectiveFrom: date("effective_from").notNull(),
  basis: text("basis").$type<Basis>().notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  currency: text("currency").notNull(),
  note: text("note"),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const leave = pgTable("hr_leave", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
  year: integer("year").notNull(),
  kind: text("kind").$type<LeaveKind>().notNull(),
  days: num("days", 5, 1).notNull(),
  startDate: date("start_date"),
  endDate: date("end_date"),
  source: text("source").$type<"schedule" | "manual">().notNull(),
  refId: uuid("ref_id"),
  note: text("note"),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const documents = pgTable("hr_documents", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
  name: text("name").notNull(),
  category: text("category").$type<DocCategory>().notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  data: bytea("data"),
  source: text("source").$type<"upload" | "docs">().notNull().default("upload"),
  refId: uuid("ref_id"),
  expiresOn: date("expires_on"),
  remindedAt: ts("reminded_at"),
  uploadedBy: uuid("uploaded_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const templates = pgTable("hr_templates", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").$type<ChecklistKind>().notNull(),
  items: jsonb("items").$type<TemplateItem[]>().notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const checklists = pgTable("hr_checklists", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").$type<ChecklistKind>().notNull(),
  startDate: date("start_date").notNull(),
  completedAt: ts("completed_at"),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const tasks = pgTable("hr_tasks", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  checklistId: uuid("checklist_id").notNull(),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  ownerId: uuid("owner_id"),
  dueDate: date("due_date"),
  doneAt: ts("done_at"),
  doneBy: uuid("done_by"),
});
