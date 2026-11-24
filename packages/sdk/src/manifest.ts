import { z } from "zod";

export const MODULE_KEY_RE = /^[a-z][a-z0-9-]{1,40}$/;
const key = z.string().regex(MODULE_KEY_RE);
const eventType = z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
const semver = z.string().regex(/^\d+\.\d+\.\d+(?:-[\w.]+)?$/);
const permission = z.string().regex(/^[a-z][a-z0-9-]*:[a-z][a-z0-9_.-]*$/);

export const UI_SLOTS = [
  "nav.main", "nav.settings", "page", "dashboard.widget", "global.create", "command.palette",
] as const;
const slot = z.union([
  z.enum(UI_SLOTS),
  z.string().regex(/^entity\.(tab|action|sidebar):[a-z][a-z0-9_]*$/),
]);

/** Groups on the "Add features" page. */
export const MODULE_CATEGORIES = ["finance", "sales", "team", "operations", "other"] as const;
/** System roles (besides owner/admin, who always get everything) a module can grant permissions to on enable. */
export const GRANTABLE_ROLES = ["manager", "member", "viewer"] as const;

export const ManifestSchema = z.object({
  key,
  name: z.string().min(1).max(80),
  version: semver,
  office: z.string().min(1).max(40),            // compatible core range, e.g. "^1.0"
  description: z.string().max(500).default(""),
  /** Icon name for the feature card and nav (see web shell/icons.tsx). */
  icon: z.string().regex(/^[a-z][a-z0-9-]{0,30}$/).optional(),
  category: z.enum(MODULE_CATEGORIES).default("other"),
  /**
   * Who can use the module: permissions granted to each system role when the module is enabled.
   * Owner ("*") and Admin (every declared permission) are implicit. Roles left out get nothing.
   */
  roles: z.partialRecord(z.enum(GRANTABLE_ROLES), z.array(permission)).default({}),
  dependsOn: z.array(key).default([]),
  permissions: z.object({
    declares: z.array(z.object({ key: permission, label: z.string().min(1).max(120) })).default([]),
    requires: z.array(permission).default([]),
  }).default({ declares: [], requires: [] }),
  entities: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).default([]),
  events: z.object({
    emits: z.array(z.object({ type: eventType, schema: z.string().optional() })).default([]),
    subscribes: z.array(eventType).default([]),
  }).default({ emits: [], subscribes: [] }),
  workflow: z.object({
    triggers: z.array(eventType).default([]),
    actions: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*$/), label: z.string().optional(), input: z.string().optional() })).default([]),
  }).default({ triggers: [], actions: [] }),
  ui: z.object({
    slots: z.array(z.object({
      slot, label: z.string().optional(), icon: z.string().optional(), route: z.string().optional(),
      component: z.string().optional(), permission: permission.optional(),
      /** nav.main only: module-relative GET path answering { count } (e.g. unread messages), shown next to the label and refreshed every few seconds. */
      badge: z.string().regex(/^\/[a-z0-9/_-]*$/).optional(),
    })).default([]),
  }).default({ slots: [] }),
  /** JSON Schema (draft 2020-12 subset) for tenant settings; "x-secret": true marks secrets. */
  settings: z.record(z.string(), z.unknown()).default({ type: "object", properties: {} }),
  api: z.object({ basePath: z.string().regex(/^\/[a-z0-9-]+$/) }).optional(),
  lifecycle: z.array(z.enum(["install", "enable", "disable", "upgrade", "uninstall"])).default([]),
}).strict().superRefine((m, ctx) => {
  for (const p of m.permissions.declares) {
    if (!p.key.startsWith(`${m.key}:`)) ctx.addIssue({ code: "custom", message: `declared permission ${p.key} must start with "${m.key}:"` });
  }
  const declared = new Set(m.permissions.declares.map((p) => p.key));
  for (const [role, perms] of Object.entries(m.roles)) {
    for (const p of perms ?? []) {
      if (!declared.has(p)) ctx.addIssue({ code: "custom", message: `roles.${role} grants ${p}, which is not in permissions.declares` });
    }
  }
  for (const e of m.events.emits) {
    if (!e.type.startsWith(`${m.key}.`)) ctx.addIssue({ code: "custom", message: `emitted event ${e.type} must start with "${m.key}."` });
  }
  for (const a of m.workflow.actions) {
    if (!a.key.startsWith(`${m.key}.`)) ctx.addIssue({ code: "custom", message: `action ${a.key} must start with "${m.key}."` });
  }
  const emitted = new Set(m.events.emits.map((e) => e.type));
  for (const t of m.workflow.triggers) {
    if (!emitted.has(t)) ctx.addIssue({ code: "custom", message: `trigger ${t} must be in events.emits` });
  }
  if (m.dependsOn.includes(m.key)) ctx.addIssue({ code: "custom", message: "module cannot depend on itself" });
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type ManifestInput = z.input<typeof ManifestSchema>;

export function parseManifest(input: unknown): Manifest {
  const r = ManifestSchema.safeParse(input);
  if (!r.success) throw new Error(`Invalid module manifest: ${z.prettifyError(r.error)}`);
  return r.data;
}

/** Postgres table prefix for a module: "support-inbox" -> "support_inbox". */
export const tablePrefix = (moduleKey: string) => moduleKey.replaceAll("-", "_");
