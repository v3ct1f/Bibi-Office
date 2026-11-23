// Mirrors migrations/0001_init.sql (SQL is the source of truth).
import { bigint, boolean, date, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (n: string) => timestamp(n, { withTimezone: true });

export const STATUSES = ["new", "contacted", "qualified", "disqualified", "converted"] as const;
export type LeadStatus = (typeof STATUSES)[number];
export const SOURCES = ["manual", "web_form", "referral", "event", "phone", "email", "social", "ads", "workflow", "other"] as const;
export type LeadSource = (typeof SOURCES)[number];
export type ActivityKind = "note" | "call" | "meeting" | "email" | "status" | "system";

export const leads = pgTable("leads_leads", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  email: text("email"),
  phone: text("phone"),
  companyName: text("company_name"),
  jobTitle: text("job_title"),
  source: text("source").$type<LeadSource>().notNull(),
  status: text("status").$type<LeadStatus>().notNull(),
  ownerId: uuid("owner_id"),
  valueCents: bigint("value_cents", { mode: "number" }).notNull(),
  currency: text("currency").notNull(),
  followUpOn: date("follow_up_on", { mode: "string" }),
  message: text("message"),
  notes: text("notes"),
  disqualifyReason: text("disqualify_reason"),
  contactId: uuid("contact_id"),
  companyId: uuid("company_id"),
  convertedAt: ts("converted_at"),
  statusChangedAt: ts("status_changed_at").notNull().defaultNow(),
  createdBy: text("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const activities = pgTable("leads_activities", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  leadId: uuid("lead_id").notNull(),
  kind: text("kind").$type<ActivityKind>().notNull(),
  body: text("body").notNull(),
  createdBy: text("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const forms = pgTable("leads_forms", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  token: text("token").notNull(),
  enabled: boolean("enabled").notNull(),
  heading: text("heading").notNull(),
  intro: text("intro"),
  thanks: text("thanks").notNull(),
  askPhone: boolean("ask_phone").notNull(),
  askCompany: boolean("ask_company").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
