import { bigint, char, date, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (n: string) => timestamp(n, { withTimezone: true });

export const stages = pgTable("crm_stages", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  position: integer("position").notNull(),
  probability: integer("probability").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type DealStatus = "open" | "won" | "lost";
export const deals = pgTable("crm_deals", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  title: text("title").notNull(),
  value: bigint("value", { mode: "number" }).notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  stageId: uuid("stage_id").notNull(),
  status: text("status").$type<DealStatus>().notNull(),
  contactId: uuid("contact_id"),
  companyId: uuid("company_id"),
  ownerId: uuid("owner_id"),
  expectedClose: date("expected_close"),
  notes: text("notes"),
  lostReason: text("lost_reason"),
  closedAt: ts("closed_at"),
  stageChangedAt: ts("stage_changed_at").notNull().defaultNow(),
  createdBy: text("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type ActivityType = "note" | "call" | "email" | "meeting" | "task";
export const activities = pgTable("crm_activities", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  type: text("type").$type<ActivityType>().notNull(),
  subject: text("subject").notNull(),
  body: text("body"),
  dealId: uuid("deal_id"),
  contactId: uuid("contact_id"),
  companyId: uuid("company_id"),
  dueAt: ts("due_at"),
  doneAt: ts("done_at"),
  createdBy: text("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
