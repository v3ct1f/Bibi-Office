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
  /** "starter" | "business" | "complete" (see core/plans.ts), or "free" / "paid" for businesses without plan limits. */
  plan: text("plan").notNull().default("free"),
  planInterval: text("plan_interval").$type<"monthly" | "yearly">().notNull().default("monthly"),
  /** True while the payment is a pretend one (test mode). */
  planTest: boolean("plan_test").notNull().default(false),
  planChangedAt: ts("plan_changed_at"),
  /** Features the program owner allows this business to turn on; null = all. */
  allowedModules: text("allowed_modules").array(),
  /** Set when the business came from a paid Stripe subscription. */
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  /** When the business was deleted (erased for good 30 days later), and when its paid subscription ended (erased 90 days later). */
  deletedAt: ts("deleted_at"),
  subscriptionEndedAt: ts("subscription_ended_at"),
  /** Paused because a payment failed (cleared when it is paid). Not set for a pause by hand. */
  billingPausedAt: ts("billing_paused_at"),
  /** Paid extras turned on for this business, e.g. "workmail". */
  addons: text("addons").array().notNull().default([]),
  region: text("region").notNull().default("eu"),
  status: text("status").$type<"active" | "suspended" | "deleted">().notNull().default("active"),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  /** Currency this business likes to see its numbers in (null = EUR). Never changes stored amounts or existing invoices. */
  displayCurrency: text("display_currency"),
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
  /** The language and currency this person picked in the app (null = not chosen yet). */
  uiLocale: text("ui_locale"),
  uiCurrency: text("ui_currency"),
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

/** People who may set up their own business: paid on Stripe, or invited by the program owner (global; no tenant). */
export const ownerSignups = pgTable("owner_signups", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  source: text("source").$type<"stripe" | "program_owner" | "demo">().notNull(),
  createdBy: text("created_by").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  termsVersion: text("terms_version"),
  createdAt: ts("created_at").notNull().defaultNow(),
  usedAt: ts("used_at"),
  tenantId: uuid("tenant_id"),
  endedAt: ts("ended_at"),
  cancelledAt: ts("cancelled_at"),
  /** The plan chosen at sign-up (core/plans.ts), its billing interval, and whether the payment was only a pretend one. */
  plan: text("plan"),
  planInterval: text("plan_interval").$type<"monthly" | "yearly">(),
  planTest: boolean("plan_test").notNull().default(false),
  workmailMailboxes: integer("workmail_mailboxes"),
  workmailDomain: text("workmail_domain"),
});

/** Program owners of this installation (global; no tenant). */
export const platformAdmins = pgTable("platform_admins", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  addedBy: text("added_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** History of program-owner changes (append-only). */
export const platformAudit = pgTable("platform_audit", {
  id: uuid("id").primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  email: text("email").notNull(),
  roles: text("roles").array().notNull().default([]),
  tokenHash: bytea("token_hash").notNull(),
  invitedBy: uuid("invited_by"),
  expiresAt: ts("expires_at").notNull(),
  acceptedAt: ts("accepted_at"),
  acceptedBy: uuid("accepted_by"),
  revokedAt: ts("revoked_at"),
  byPlatform: boolean("by_platform").notNull().default(false),
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
  disabledAt: ts("disabled_at"),
  disabledBy: uuid("disabled_by"),
  secrets: bytea("secrets"),
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

// ───────── Session 3: platform ─────────
export const eventConsumptions = pgTable("event_consumptions", {
  tenantId: uuid("tenant_id").notNull(),
  eventId: uuid("event_id").notNull(),
  consumer: text("consumer").notNull(),
  consumedAt: ts("consumed_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.eventId, t.consumer] })]);

export interface WorkflowTrigger { event: string }
export interface WorkflowAction { key: string; input?: Record<string, unknown> }

export const workflows = pgTable("workflows", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  trigger: jsonb("trigger").$type<WorkflowTrigger>().notNull(),
  conditions: jsonb("conditions").$type<unknown>(),
  actions: jsonb("actions").$type<WorkflowAction[]>().notNull(),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by"),
  /** Whose access the workflow runs with: the person who last saved it. */
  runAs: uuid("run_as"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  deletedAt: ts("deleted_at"),
});

export interface StepResult { key: string; status: "succeeded" | "failed" | "skipped"; output?: unknown; error?: string; at: string }

export const workflowRuns = pgTable("workflow_runs", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  workflowId: uuid("workflow_id").notNull(),
  workflowVersion: integer("workflow_version").notNull(),
  eventId: uuid("event_id").notNull(),
  status: text("status").$type<"pending" | "running" | "succeeded" | "failed" | "skipped" | "cancelled">().notNull().default("pending"),
  plan: jsonb("plan").$type<{ event: Record<string, unknown> & { id: string; type: string; payload: unknown; depth: number; correlationId: string }; actions: WorkflowAction[]; runAs?: string | null }>().notNull(),
  steps: jsonb("steps").$type<StepResult[]>().notNull().default([]),
  error: text("error"),
  engineRunId: text("engine_run_id"),
  startedAt: ts("started_at").notNull().defaultNow(),
  endedAt: ts("ended_at"),
});

export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  url: text("url").notNull(),
  description: text("description"),
  secretEnc: bytea("secret_enc").notNull(),
  events: text("events").array().notNull(),
  active: boolean("active").notNull().default(true),
  failureStreak: integer("failure_streak").notNull().default(0),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  endpointId: uuid("endpoint_id").notNull(),
  eventId: uuid("event_id").notNull(),
  eventType: text("event_type").notNull(),
  body: jsonb("body").notNull(),
  status: text("status").$type<"pending" | "delivered" | "failed">().notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  statusCode: integer("status_code"),
  lastError: text("last_error"),
  nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
  deliveredAt: ts("delivered_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
