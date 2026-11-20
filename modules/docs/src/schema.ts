// Mirrors migrations/0001_init.sql (SQL is the source of truth).
import { boolean, customType, date, integer, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (n: string) => timestamp(n, { withTimezone: true });
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const STATUSES = ["file", "draft", "sent", "completed", "declined", "expired", "cancelled"] as const;
export type Status = (typeof STATUSES)[number];
export const VISIBILITY = ["team", "private"] as const;
export const FIELD_KINDS = ["signature", "initials", "date", "name", "text"] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export const documents = pgTable("docs_documents", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  title: text("title").notNull(),
  folder: text("folder").notNull().default(""),
  visibility: text("visibility").$type<(typeof VISIBILITY)[number]>().notNull().default("team"),
  status: text("status").$type<Status>().notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  data: bytea("data").notNull(),
  pageCount: integer("page_count"),
  signedData: bytea("signed_data"),
  signedSha256: text("signed_sha256"),
  ordered: boolean("ordered").notNull().default(false),
  message: text("message"),
  expiresOn: date("expires_on"),
  remindEveryDays: integer("remind_every_days").notNull().default(0),
  appUrl: text("app_url"),
  companyName: text("company_name"),
  templateId: uuid("template_id"),
  employeeId: uuid("employee_id"),
  contactId: uuid("contact_id"),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  sentAt: ts("sent_at"),
  completedAt: ts("completed_at"),
});

export const signers = pgTable("docs_signers", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  documentId: uuid("document_id").notNull(),
  position: integer("position").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  userId: uuid("user_id"),
  contactId: uuid("contact_id"),
  token: text("token"),
  status: text("status").$type<"pending" | "signed" | "declined">().notNull().default("pending"),
  viewedAt: ts("viewed_at"),
  signedAt: ts("signed_at"),
  declinedAt: ts("declined_at"),
  declineReason: text("decline_reason"),
  signatureKind: text("signature_kind").$type<"typed" | "drawn">(),
  signatureText: text("signature_text"),
  signatureImage: bytea("signature_image"),
  initialsText: text("initials_text"),
  initialsImage: bytea("initials_image"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  notifiedAt: ts("notified_at"),
  lastRemindedAt: ts("last_reminded_at"),
  remindersSent: integer("reminders_sent").notNull().default(0),
  mailError: text("mail_error"),
});

export const fields = pgTable("docs_fields", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  documentId: uuid("document_id").notNull(),
  signerId: uuid("signer_id").notNull(),
  kind: text("kind").$type<FieldKind>().notNull(),
  page: integer("page").notNull(),
  x: real("x").notNull(),
  y: real("y").notNull(),
  w: real("w").notNull(),
  h: real("h").notNull(),
  required: boolean("required").notNull().default(true),
  label: text("label"),
  value: text("value"),
});

export const templates = pgTable("docs_templates", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  body: text("body").notNull(),
  folder: text("folder").notNull().default(""),
  createdBy: uuid("created_by"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const activity = pgTable("docs_activity", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  documentId: uuid("document_id").notNull(),
  at: ts("at").notNull().defaultNow(),
  action: text("action").notNull(),
  signerId: uuid("signer_id"),
  actorName: text("actor_name"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  detail: text("detail"),
});
