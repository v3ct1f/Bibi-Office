// Mirrors migrations/0001_init.sql (SQL is the source of truth).
import { customType, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
  data: bytea("data").notNull(),
  uploadedBy: uuid("uploaded_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const messages = pgTable("messages_messages", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  conversationId: uuid("conversation_id").notNull(),
  senderId: uuid("sender_id"),
  kind: text("kind").$type<"text" | "system">().notNull(),
  body: text("body").notNull(),
  fileId: uuid("file_id"),
  editedAt: ts("edited_at"),
  deletedAt: ts("deleted_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
