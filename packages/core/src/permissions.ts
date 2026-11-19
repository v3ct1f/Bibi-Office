import { forbidden } from "./errors.ts";
import type { RequestContext } from "./context.ts";

export const CORE_PERMISSIONS = [
  "core:tenant.manage",
  "core:members.read", "core:members.manage",
  "core:roles.read", "core:roles.manage",
  "core:modules.read", "core:modules.manage",
  "core:apikeys.manage",
  "core:audit.read",
  "core:contacts.read", "core:contacts.write",
  "core:companies.read", "core:companies.write",
  "core:documents.read", "core:documents.write",
  "core:tasks.read", "core:tasks.write",
  "core:workflows.read", "core:workflows.manage",
  "core:webhooks.manage",
] as const;
export type CorePermission = (typeof CORE_PERMISSIONS)[number];

const DATA_READ = ["core:contacts.read", "core:companies.read", "core:documents.read", "core:tasks.read"];
const DATA_WRITE = ["core:contacts.write", "core:companies.write", "core:documents.write", "core:tasks.write"];

/** Seeded per tenant. Owner = everything. Modules add their permissions to admin on enable. */
export const SYSTEM_ROLES: Record<string, { name: string; permissions: string[] }> = {
  owner: { name: "Owner", permissions: ["*"] },
  admin: {
    name: "Admin",
    permissions: CORE_PERMISSIONS.filter((p) => p !== "core:tenant.manage"),
  },
  member: { name: "Member", permissions: [...DATA_READ, ...DATA_WRITE, "core:members.read", "core:modules.read"] },
  viewer: { name: "Viewer", permissions: [...DATA_READ] },
};

/** Grants: "*" (all), "<module>:*" (all in module), or exact "<module>:<action>". */
export function hasPermission(granted: ReadonlySet<string>, required: string): boolean {
  if (granted.has("*") || granted.has(required)) return true;
  const mod = required.split(":")[0];
  return granted.has(`${mod}:*`);
}

export function requirePermission(ctx: RequestContext, required: string): void {
  if (!hasPermission(ctx.actor.permissions, required)) throw forbidden(`Missing permission ${required}`);
}
