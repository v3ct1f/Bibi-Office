// Mirrors migrations/0001_init.sql (SQL is the source of truth).
import { boolean, customType, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (n: string) => timestamp(n, { withTimezone: true });
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export type Folder = "inbox" | "sent" | "drafts" | "spam" | "trash" | "archive";
export const FOLDERS: Folder[] = ["inbox", "sent", "drafts", "spam", "trash", "archive"];
export interface Addr { name: string; email: string }

export const accounts = pgTable("mail_accounts", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
  address: text("address").notNull(),
  displayName: text("display_name").notNull(),
  source: text("source").$type<"workmail" | "local">().notNull(),
  providerRef: text("provider_ref"),
  status: text("status").$type<"active" | "paused">().notNull().default("active"),
  signature: text("signature").notNull().default(""),
  syncCursor: text("sync_cursor"),
  lastSyncedAt: ts("last_synced_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const labels = pgTable("mail_labels", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull().default("gray"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const messages = pgTable("mail_messages", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
  accountId: uuid("account_id").notNull(),
  threadId: uuid("thread_id").notNull(),
  folder: text("folder").$type<Folder>().notNull(),
  remoteUid: text("remote_uid"),
  messageIdHdr: text("message_id_hdr"),
  inReplyTo: text("in_reply_to"),
  refs: text("refs").array().notNull().default([]),
  fromName: text("from_name").notNull().default(""),
  fromEmail: text("from_email").notNull().default(""),
  toAddrs: jsonb("to_addrs").$type<Addr[]>().notNull().default([]),
  ccAddrs: jsonb("cc_addrs").$type<Addr[]>().notNull().default([]),
  bccAddrs: jsonb("bcc_addrs").$type<Addr[]>().notNull().default([]),
  subject: text("subject").notNull().default(""),
  subjectNorm: text("subject_norm").notNull().default(""),
  bodyText: text("body_text").notNull().default(""),
  bodyHtml: text("body_html"),
  snippet: text("snippet").notNull().default(""),
  isRead: boolean("is_read").notNull().default(false),
  isStarred: boolean("is_starred").notNull().default(false),
  hasAttachments: boolean("has_attachments").notNull().default(false),
  hasRemoteImages: boolean("has_remote_images").notNull().default(false),
  date: ts("date").notNull().defaultNow(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const attachments = pgTable("mail_attachments", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
  messageId: uuid("message_id").notNull(),
  name: text("name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  data: bytea("data").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const messageLabels = pgTable("mail_message_labels", {
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
  messageId: uuid("message_id").notNull(),
  labelId: uuid("label_id").notNull(),
});
