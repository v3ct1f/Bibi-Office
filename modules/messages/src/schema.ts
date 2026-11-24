// Mirrors migrations/0001_init.sql (SQL is the source of truth).
import { boolean, customType, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

export type MessageKind = "text" | "system" | "poll" | "event" | "contact" | "sticker" | "gif";

const ts = (n: string) => timestamp(n, { withTimezone: true });
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const conversations = pgTable("messages_conversations", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  kind: text("kind").$type<"direct" | "group">().notNull(),
  name: text("name"),
  directKey: text("direct_key"),
  createdBy: uuid("created_by"),
  lastMessageAt: ts("last_message_at").notNull().defaultNow(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const members = pgTable("messages_members", {
  tenantId: uuid("tenant_id").notNull(),
  conversationId: uuid("conversation_id").notNull(),
  userId: uuid("user_id").notNull(),
  role: text("role").$type<"manager" | "member">().notNull(),
  lastReadAt: ts("last_read_at").notNull().defaultNow(),
  joinedAt: ts("joined_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.conversationId, t.userId] })]);

export const files = pgTable("messages_files", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  conversationId: uuid("conversation_id").notNull(),
  name: text("name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  complete: boolean("complete").notNull(),
  partCount: integer("part_count").notNull(),
  uploadedBy: uuid("uploaded_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const messages = pgTable("messages_messages", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  conversationId: uuid("conversation_id").notNull(),
  senderId: uuid("sender_id"),
  kind: text("kind").$type<MessageKind>().notNull(),
  body: text("body").notNull(),
  fileId: uuid("file_id"),
  data: jsonb("data").$type<Record<string, unknown> | null>(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  editedAt: ts("edited_at"),
  deletedAt: ts("deleted_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const fileParts = pgTable("messages_file_parts", {
  tenantId: uuid("tenant_id").notNull(),
  fileId: uuid("file_id").notNull(),
  idx: integer("idx").notNull(),
  data: bytea("data").notNull(),
}, (t) => [primaryKey({ columns: [t.fileId, t.idx] })]);

export const pollVotes = pgTable("messages_poll_votes", {
  tenantId: uuid("tenant_id").notNull(),
  messageId: uuid("message_id").notNull(),
  userId: uuid("user_id").notNull(),
  optionId: text("option_id").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.messageId, t.userId, t.optionId] })]);

export const eventAnswers = pgTable("messages_event_answers", {
  tenantId: uuid("tenant_id").notNull(),
  messageId: uuid("message_id").notNull(),
  userId: uuid("user_id").notNull(),
  answer: text("answer").$type<"going" | "maybe" | "no">().notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.messageId, t.userId] })]);
