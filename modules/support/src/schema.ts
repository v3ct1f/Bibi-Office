import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (n: string) => timestamp(n, { withTimezone: true });

export const counters = pgTable("support_counters", {
  tenantId: uuid("tenant_id").primaryKey(),
  lastNo: integer("last_no").notNull(),
});

export type TicketStatus = "new" | "open" | "pending" | "solved";
export type Priority = "low" | "normal" | "high" | "urgent";
export type Channel = "email" | "web" | "internal";

export const tickets = pgTable("support_tickets", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  number: integer("number").notNull(),
  subject: text("subject").notNull(),
  status: text("status").$type<TicketStatus>().notNull(),
  priority: text("priority").$type<Priority>().notNull(),
  channel: text("channel").$type<Channel>().notNull(),
  requesterName: text("requester_name"),
  requesterEmail: text("requester_email").notNull(),
  contactId: uuid("contact_id"),
  assigneeId: uuid("assignee_id"),
  dueAt: ts("due_at"),
  firstResponseAt: ts("first_response_at"),
  slaBreachedAt: ts("sla_breached_at"),
  solvedAt: ts("solved_at"),
  lastMessageAt: ts("last_message_at").notNull().defaultNow(),
  createdBy: text("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type MessageKind = "customer" | "reply" | "note";
export const messages = pgTable("support_messages", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  ticketId: uuid("ticket_id").notNull(),
  kind: text("kind").$type<MessageKind>().notNull(),
  authorId: uuid("author_id"),
  fromEmail: text("from_email"),
  fromName: text("from_name"),
  body: text("body").notNull(),
  messageId: text("message_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type Ticket = typeof tickets.$inferSelect;
export type Message = typeof messages.$inferSelect;
