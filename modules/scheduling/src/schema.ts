// Mirrors migrations/0001_init.sql (SQL is the source of truth).
import { boolean, date, integer, pgTable, text, time, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (n: string) => timestamp(n, { withTimezone: true });

export const COLORS = ["blue", "green", "orange", "purple", "pink", "teal", "red", "gray"] as const;
export type Color = (typeof COLORS)[number];
export type TimeOffKind = "vacation" | "sick" | "personal" | "other";
export type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";
export type SwapStatus = "pending" | "accepted" | "declined" | "approved" | "rejected" | "cancelled";

export const positions = pgTable("scheduling_positions", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  color: text("color").$type<Color>().notNull(),
  archived: boolean("archived").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const shifts = pgTable("scheduling_shifts", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  positionId: uuid("position_id"),
  day: date("day").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  breakMinutes: integer("break_minutes").notNull(),
  notes: text("notes"),
  publishedAt: ts("published_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const timeOff = pgTable("scheduling_time_off", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  kind: text("kind").$type<TimeOffKind>().notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  reason: text("reason"),
  status: text("status").$type<RequestStatus>().notNull(),
  decidedBy: uuid("decided_by"),
  decidedAt: ts("decided_at"),
  decisionComment: text("decision_comment"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const swaps = pgTable("scheduling_swaps", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  shiftId: uuid("shift_id").notNull(),
  fromEmployeeId: uuid("from_employee_id").notNull(),
  toEmployeeId: uuid("to_employee_id").notNull(),
  targetShiftId: uuid("target_shift_id"),
  message: text("message"),
  status: text("status").$type<SwapStatus>().notNull(),
  decidedBy: uuid("decided_by"),
  decidedAt: ts("decided_at"),
  decisionComment: text("decision_comment"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const clockEntries = pgTable("scheduling_clock_entries", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  shiftId: uuid("shift_id"),
  clockIn: ts("clock_in").notNull(),
  clockOut: ts("clock_out"),
  note: text("note"),
  source: text("source").$type<"clock" | "manual">().notNull(),
  editedBy: uuid("edited_by"),
  editedAt: ts("edited_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
