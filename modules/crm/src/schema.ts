// Mirrors migrations/0001_init.sql (SQL is the source of truth).
import { bigint, date, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (n: string) => timestamp(n, { withTimezone: true });

export type StageKind = "open" | "won" | "lost";
export type DealStatus = StageKind;
export type ActivityKind = "note" | "call" | "meeting" | "email" | "stage" | "system";

export const pipelines = pgTable("crm_pipelines", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  position: integer("position").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const stages = pgTable("crm_stages", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  pipelineId: uuid("pipeline_id").notNull(),
  name: text("name").notNull(),
  position: integer("position").notNull(),
  probability: integer("probability").notNull(),
  kind: text("kind").$type<StageKind>().notNull(),
});

export const deals = pgTable("crm_deals", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  pipelineId: uuid("pipeline_id").notNull(),
  stageId: uuid("stage_id").notNull(),
  title: text("title").notNull(),
  valueCents: bigint("value_cents", { mode: "number" }).notNull(),
  currency: text("currency").notNull(),
  status: text("status").$type<DealStatus>().notNull(),
  companyId: uuid("company_id"),
  contactId: uuid("contact_id"),
  ownerId: uuid("owner_id"),
  expectedClose: date("expected_close", { mode: "string" }),
  nextStep: text("next_step"),
  nextStepDate: date("next_step_date", { mode: "string" }),
  notes: text("notes"),
  lostReason: text("lost_reason"),
  closedAt: ts("closed_at"),
  stageChangedAt: ts("stage_changed_at").notNull().defaultNow(),
  createdBy: text("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const activities = pgTable("crm_activities", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  dealId: uuid("deal_id").notNull(),
  kind: text("kind").$type<ActivityKind>().notNull(),
  body: text("body").notNull(),
  createdBy: text("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
