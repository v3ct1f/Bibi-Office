import { bigint, date, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { SummaryResult } from "./claude.ts";

export type Kind = "meeting" | "email" | "notes";
export const summaries = pgTable("ai_summaries", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  kind: text("kind").$type<Kind>().notNull(),
  title: text("title").notNull(),
  sourceText: text("source_text"),
  sourceChars: integer("source_chars").notNull(),
  status: text("status").$type<"done" | "refused">().notNull(),
  result: jsonb("result").$type<SummaryResult>(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  tasksCreated: integer("tasks_created").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const usage = pgTable("ai_usage", {
  tenantId: uuid("tenant_id").notNull(),
  month: date("month").notNull(),
  requests: integer("requests").notNull(),
  inputTokens: bigint("input_tokens", { mode: "number" }).notNull(),
  outputTokens: bigint("output_tokens", { mode: "number" }).notNull(),
});

export type Summary = typeof summaries.$inferSelect;
