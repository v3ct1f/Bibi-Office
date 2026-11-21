// Mirrors migrations/0001_init.sql (SQL is the source of truth).
import { boolean, date, integer, jsonb, numeric, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (n: string) => timestamp(n, { withTimezone: true });
const amount = (n: string) => numeric(n, { precision: 18, scale: 2, mode: "number" });

export const PERIODS = ["week", "month", "quarter", "year"] as const;
export type PeriodKind = (typeof PERIODS)[number];
export const COMPARE = ["previous", "last_year", "none"] as const;
export type Compare = (typeof COMPARE)[number];
export const CHARTS = ["bar", "line", "none"] as const;
export type Chart = (typeof CHARTS)[number];

export const boards = pgTable("kpi_boards", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  position: integer("position").notNull(),
  period: text("period").$type<PeriodKind>().notNull(),
  compare: text("compare").$type<Compare>().notNull(),
  digestEnabled: boolean("digest_enabled").notNull(),
  digestWeekday: smallint("digest_weekday").notNull(),
  digestHour: smallint("digest_hour").notNull(),
  digestRecipients: jsonb("digest_recipients").$type<string[]>().notNull(),
  digestLastSentAt: ts("digest_last_sent_at"),
  digestLastError: text("digest_last_error"),
  appUrl: text("app_url"),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const tiles = pgTable("kpi_tiles", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  boardId: uuid("board_id").notNull(),
  position: integer("position").notNull(),
  metricKey: text("metric_key").notNull(),
  label: text("label"),
  chart: text("chart").$type<Chart>().notNull(),
});

export const targets = pgTable("kpi_targets", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  metricKey: text("metric_key").notNull(),
  period: text("period").$type<PeriodKind>().notNull(),
  value: amount("value").notNull(),
  updatedBy: uuid("updated_by"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const manualMetrics = pgTable("kpi_manual_metrics", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  unit: text("unit").$type<"count" | "money" | "hours" | "minutes" | "days" | "percent">().notNull(),
  currency: text("currency"),
  kind: text("kind").$type<"total" | "snapshot">().notNull(),
  better: text("better").$type<"up" | "down">().notNull(),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const manualValues = pgTable("kpi_manual_values", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  metricId: uuid("metric_id").notNull(),
  onDate: date("on_date", { mode: "string" }).notNull(),
  value: amount("value").notNull(),
  note: text("note"),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
