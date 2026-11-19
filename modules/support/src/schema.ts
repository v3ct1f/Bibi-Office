// Mirrors migrations/0001_init.sql (SQL is the source of truth).
import { bigint, customType, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (n: string) => timestamp(n, { withTimezone: true });
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const STATUSES = ["open", "pending", "solved"] as const;
export type Status = (typeof STATUSES)[number];
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];
export type Kind = "inbound" | "reply" | "note";
export type SendStatus = "sending" | "sent" | "failed";

export const tickets = pgTable("support_tickets", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  seq: integer("seq").notNull(),
  subject: text("subject").notNull(),
  status: text("status").$type<Status>().notNull(),
  priority: text("priority").$type<Priority>().notNull(),
  channel: text("channel").$type<"email" | "manual">().notNull(),
  requesterEmail: text("requester_email"),
  requesterName: text("requester_name"),
  contactId: uuid("contact_id"),
  assigneeId: uuid("assignee_id"),
  firstResponseAt: ts("first_response_at"),
  firstResponseDue: ts("first_response_due"),
  resolutionDue: ts("resolution_due"),
  solvedAt: ts("solved_at"),
  lastMessageAt: ts("last_message_at").notNull().defaultNow(),
  lastInboundAt: ts("last_inbound_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const messages = pgTable("support_messages", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  ticketId: uuid("ticket_id").notNull(),
  kind: text("kind").$type<Kind>().notNull(),
  authorId: uuid("author_id"),
  fromEmail: text("from_email"),
  fromName: text("from_name"),
  toEmails: text("to_emails").array().notNull().default([]),
  ccEmails: text("cc_emails").array().notNull().default([]),
  subject: text("subject"),
  body: text("body").notNull(),
  messageId: text("message_id"),
  inReplyTo: text("in_reply_to"),
  refs: text("refs").array().notNull().default([]),
  sendStatus: text("send_status").$type<SendStatus>(),
  sendError: text("send_error"),
  attempts: integer("attempts").notNull().default(0),
  sentAt: ts("sent_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const files = pgTable("support_files", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  messageId: uuid("message_id").notNull(),
  name: text("name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  data: bytea("data").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const macros = pgTable("support_macros", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  body: text("body").notNull(),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const targets = pgTable("support_targets", {
  tenantId: uuid("tenant_id").notNull(),
  priority: text("priority").$type<Priority>().notNull(),
  firstResponseMin: integer("first_response_min"),
  resolutionMin: integer("resolution_min"),
});

export const sync = pgTable("support_sync", {
  tenantId: uuid("tenant_id").primaryKey(),
  mailboxKey: text("mailbox_key"),
  uidValidity: bigint("uid_validity", { mode: "number" }),
  lastUid: bigint("last_uid", { mode: "number" }).notNull().default(0),
  lastRunAt: ts("last_run_at"),
  lastOkAt: ts("last_ok_at"),
  lastError: text("last_error"),
  imported: integer("imported").notNull().default(0),
});
