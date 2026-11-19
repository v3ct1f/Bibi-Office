// Mirrors migrations/*.sql (SQL is source of truth). Generated columns (search) omitted.
import {
  pgTable, uuid, text, timestamp, jsonb, boolean, bigint, smallint, integer, customType, primaryKey,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
const ts = (n: string) => timestamp(n, { withTimezone: true, mode: "date" });
const base = {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  custom: jsonb("custom").$type<Record<string, unknown>>().notNull().default({}),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  deletedAt: ts("deleted_at"),
};

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("free"),
  region: text("region").notNull().default("eu"),
  status: text("status").$type<"active" | "suspended" | "deleted">().notNull().default("active"),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  idpSubject: text("idp_subject").notNull(),
  email: text("email").notNull(),
  name: text("name"),
  locale: text("locale").notNull().default("en"),
  tz: text("tz").notNull().default("UTC"),
  status: text("status").$type<"active" | "disabled">().notNull().default("active"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id").notNull(),
  status: text("status").$type<"active" | "invited" | "suspended">().notNull().default("active"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  hash: bytea("hash").notNull(),
  scopes: text("scopes").array().notNull().default([]),
  createdBy: uuid("created_by"),
  expiresAt: ts("expires_at"),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const modules = pgTable("modules", {
  key: text("key").primaryKey(),
  version: text("version").notNull(),
  manifest: jsonb("manifest").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  system: boolean("system").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const rolePermissions = pgTable("role_permissions", {
  tenantId: uuid("tenant_id").notNull(),
  roleId: uuid("role_id").notNull(),
  permission: text("permission").notNull(),
}, (t) => [primaryKey({ columns: [t.roleId, t.permission] })]);

export const memberRoles = pgTable("member_roles", {
  tenantId: uuid("tenant_id").notNull(),
  membershipId: uuid("membership_id").notNull(),
  roleId: uuid("role_id").notNull(),
}, (t) => [primaryKey({ columns: [t.membershipId, t.roleId] })]);

export const tenantModules = pgTable("tenant_modules", {
  tenantId: uuid("tenant_id").notNull(),
  moduleKey: text("module_key").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  version: text("version").notNull(),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  enabledAt: ts("enabled_at"),
  enabledBy: uuid("enabled_by"),
}, (t) => [primaryKey({ columns: [t.tenantId, t.moduleKey] })]);

export const companies = pgTable("companies", {
  ...base,
  name: text("name").notNull(),
  domain: text("domain"),
  taxId: text("tax_id"),
  address: jsonb("address").$type<Record<string, unknown>>(),
});

export const contacts = pgTable("contacts", {
  ...base,
  companyId: uuid("company_id"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  email: text("email"),
  phone: text("phone"),
});

export const documents = pgTable("documents", {
  ...base,
  title: text("title").notNull(),
  storageKey: text("storage_key"),
  mime: text("mime"),
  size: bigint("size", { mode: "number" }),
  sha256: text("sha256"),
  ownerId: uuid("owner_id"),
  folder: text("folder").notNull().default("/"),
});

export const tasks = pgTable("tasks", {
  ...base,
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").$type<"open" | "in_progress" | "done" | "cancelled">().notNull().default("open"),
  priority: smallint("priority").notNull().default(2),
  dueAt: ts("due_at"),
  assigneeId: uuid("assignee_id"),
});

export const links = pgTable("links", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  fromType: text("from_type").notNull(),
  fromId: uuid("from_id").notNull(),
  toType: text("to_type").notNull(),
  toId: uuid("to_id").notNull(),
  rel: text("rel").notNull().default("related"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  body: text("body").notNull(),
  authorId: uuid("author_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const outbox = pgTable("outbox", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  type: text("type").notNull(),
  version: integer("version").notNull().default(1),
  payload: jsonb("payload").notNull(),
  actorType: text("actor_type"),
  actorId: uuid("actor_id"),
  causationId: uuid("causation_id"),
  correlationId: uuid("correlation_id"),
  depth: integer("depth").notNull().default(0),
  occurredAt: ts("occurred_at").notNull().defaultNow(),
  publishedAt: ts("published_at"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  seq: bigint("seq", { mode: "number" }).notNull(),
  actorType: text("actor_type").$type<"user" | "api_key" | "system" | "module">().notNull(),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: uuid("entity_id"),
  diff: jsonb("diff"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  requestId: text("request_id"),
  at: ts("at").notNull().defaultNow(),
  prevHash: bytea("prev_hash"),
  hash: bytea("hash").notNull(),
});
