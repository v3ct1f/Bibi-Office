// Mirrors migrations/0001_init.sql (SQL is the source of truth).
import { boolean, date, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (n: string) => timestamp(n, { withTimezone: true });

export const KINDS = ["meeting", "ticket"] as const;
export type Kind = (typeof KINDS)[number];
export const VISIBILITY = ["team", "private"] as const;
export interface Attendee { name: string; email?: string | undefined }

export const summaries = pgTable("ai_summaries", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  kind: text("kind").$type<Kind>().notNull(),
  title: text("title").notNull(),
  visibility: text("visibility").$type<(typeof VISIBILITY)[number]>().notNull().default("team"),
  sourceText: text("source_text").notNull(),
  sourceName: text("source_name"),
  sourceRef: uuid("source_ref"),
  sourceLabel: text("source_label"),
  meetingDate: date("meeting_date"),
  attendees: jsonb("attendees").$type<Attendee[]>().notNull().default([]),
  contactId: uuid("contact_id"),
  dealId: uuid("deal_id"),
  summary: text("summary").notNull(),
  keyPoints: jsonb("key_points").$type<string[]>().notNull().default([]),
  decisions: jsonb("decisions").$type<string[]>().notNull().default([]),
  openQuestions: jsonb("open_questions").$type<string[]>().notNull().default([]),
  followUpSubject: text("follow_up_subject"),
  followUpBody: text("follow_up_body"),
  suggestedReply: text("suggested_reply"),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  edited: boolean("edited").notNull().default(false),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const actionItems = pgTable("ai_action_items", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  summaryId: uuid("summary_id").notNull(),
  position: integer("position").notNull(),
  text: text("text").notNull(),
  ownerName: text("owner_name"),
  ownerUserId: uuid("owner_user_id"),
  dueOn: date("due_on"),
  taskId: uuid("task_id"),
});

export const usage = pgTable("ai_usage", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  at: ts("at").notNull().defaultNow(),
  purpose: text("purpose").$type<"meeting" | "ticket" | "test">().notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  userId: uuid("user_id"),
});
