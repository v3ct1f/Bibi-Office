// Mirrors migrations/0001_init.sql (SQL is the source of truth).
import { date, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Registrant } from "./provider.ts";

const ts = (n: string) => timestamp(n, { withTimezone: true });

export type DomainStatus = "awaiting_payment" | "dns_pending" | "active" | "removed";
export type MailboxStatus = "active" | "suspended" | "deleted";
export type SuspendReason = "colleague_removed" | "feature_off" | "by_hand" | "domain_removed";

export const domains = pgTable("workmail_domains", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  source: text("source").$type<"bought" | "connected">().notNull(),
  status: text("status").$type<DomainStatus>().notNull(),
  providerRef: text("provider_ref"),
  priceCents: integer("price_cents"),
  currency: text("currency"),
  paymentRef: text("payment_ref"),
  lastError: text("last_error"),
  registrant: jsonb("registrant").$type<Registrant>(),
  registeredAt: ts("registered_at"),
  expiresOn: date("expires_on", { mode: "string" }),
  dnsCheckedAt: ts("dns_checked_at"),
  /** When it was removed from Work email (a bought one stays the business's until it expires, not renewed). */
  removedAt: ts("removed_at"),
  createdBy: text("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const mailboxes = pgTable("workmail_mailboxes", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  domainId: uuid("domain_id").notNull(),
  localPart: text("local_part").notNull(),
  displayName: text("display_name").notNull(),
  userId: uuid("user_id"),
  status: text("status").$type<MailboxStatus>().notNull().default("active"),
  suspendReason: text("suspend_reason").$type<SuspendReason>(),
  providerRef: text("provider_ref"),
  createdBy: text("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
