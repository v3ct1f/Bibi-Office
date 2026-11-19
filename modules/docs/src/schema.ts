import { boolean, customType, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (n: string) => timestamp(n, { withTimezone: true });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const templates = pgTable("docs_templates", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  archived: boolean("archived").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type DocStatus = "draft" | "sent" | "completed" | "declined" | "voided" | "expired";
export const documents = pgTable("docs_documents", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  status: text("status").$type<DocStatus>().notNull(),
  templateId: uuid("template_id"),
  contactId: uuid("contact_id"),
  message: text("message"),
  inOrder: boolean("in_order").notNull(),
  contentHash: text("content_hash"),
  expiresAt: ts("expires_at"),
  sentAt: ts("sent_at"),
  completedAt: ts("completed_at"),
  voidReason: text("void_reason"),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type SignerStatus = "waiting" | "pending" | "viewed" | "signed" | "declined";
export const signers = pgTable("docs_signers", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  documentId: uuid("document_id").notNull(),
  position: integer("position").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  status: text("status").$type<SignerStatus>().notNull(),
  tokenHash: bytea("token_hash"),
  viewedAt: ts("viewed_at"),
  signedAt: ts("signed_at"),
  signedName: text("signed_name"),
  signaturePng: bytea("signature_png"),
  signedIp: text("signed_ip"),
  declineReason: text("decline_reason"),
  lastSentAt: ts("last_sent_at"),
});

export type EventKind = "created" | "sent" | "reminded" | "viewed" | "signed" | "declined" | "completed" | "voided" | "expired";
export const events = pgTable("docs_events", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  documentId: uuid("document_id").notNull(),
  signerId: uuid("signer_id"),
  kind: text("kind").$type<EventKind>().notNull(),
  actor: text("actor"),
  ip: text("ip"),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
  at: ts("at").notNull().defaultNow(),
});

export type Template = typeof templates.$inferSelect;
export type Doc = typeof documents.$inferSelect;
export type Signer = typeof signers.$inferSelect;
export type DocEvent = typeof events.$inferSelect;
