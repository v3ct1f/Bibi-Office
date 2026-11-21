import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  apiKeys, memberRoles, memberships, rolePermissions, roles, tenants, users, uuidv7, withTenant,
  type Db, type Tx,
} from "@office/db";
import { conflict, notFound, unauthorized, forbidden, badRequest } from "./errors.ts";
import { SYSTEM_ROLES, hasPermission } from "./permissions.ts";
import { audit } from "./audit.ts";
import { emitEvent } from "./events.ts";
import type { RequestContext } from "./context.ts";

// ───────── Users (from OIDC claims) ─────────
export interface IdpClaims { sub: string; email: string; name?: string | undefined }

/** Just-in-time provisioning on first authenticated request. */
export async function upsertUser(db: Db, c: IdpClaims) {
  const [u] = await db.insert(users)
    .values({ id: uuidv7(), idpSubject: c.sub, email: c.email.toLowerCase(), name: c.name ?? null })
    .onConflictDoUpdate({
      target: users.idpSubject,
      set: { email: c.email.toLowerCase(), name: c.name ?? null },
      setWhere: sql`${users.email} is distinct from ${c.email.toLowerCase()} or ${users.name} is distinct from ${c.name ?? null}`,
    })
    .returning();
  if (u) return u;
  const [existing] = await db.select().from(users).where(eq(users.idpSubject, c.sub));
  return existing!;
}

export async function listUserTenants(db: Db, userId: string) {
  return db.select({ id: tenants.id, slug: tenants.slug, name: tenants.name, status: memberships.status })
    .from(memberships).innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(memberships.userId, userId), eq(tenants.status, "active")));
}

// ───────── Tenants ─────────
async function seedSystemRoles(tx: Tx, tenantId: string) {
  const ids: Record<string, string> = {};
  for (const [key, r] of Object.entries(SYSTEM_ROLES)) {
    const id = uuidv7();
    ids[key] = id;
    await tx.insert(roles).values({ id, tenantId, key, name: r.name, system: true });
    await tx.insert(rolePermissions).values(r.permissions.map((permission) => ({ tenantId, roleId: id, permission })));
  }
  return ids;
}

/**
 * Adds system roles introduced after the tenant was created (e.g. "manager"), with their default permissions.
 * Existing roles are left untouched so an owner's edits are kept. Returns role ids by key.
 */
export async function ensureSystemRoles(tx: Tx, tenantId: string): Promise<Record<string, string>> {
  const existing = await tx.select({ id: roles.id, key: roles.key }).from(roles).where(eq(roles.system, true));
  const ids: Record<string, string> = Object.fromEntries(existing.map((r) => [r.key, r.id]));
  for (const [key, r] of Object.entries(SYSTEM_ROLES)) {
    if (ids[key]) continue;
    const id = uuidv7();
    await tx.insert(roles).values({ id, tenantId, key, name: r.name, system: true }).onConflictDoNothing();
    const [row] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, key));
    ids[key] = row!.id;
    if (row!.id === id) await tx.insert(rolePermissions).values(r.permissions.map((permission) => ({ tenantId, roleId: id, permission })));
  }
  return ids;
}

export async function createTenant(
  db: Db, input: { slug: string; name: string; region?: string | undefined }, owner: { userId: string },
  meta: { requestId: string; ip?: string | undefined; userAgent?: string | undefined },
) {
  const tenantId = uuidv7();
  return withTenant(db, tenantId, async (tx) => {
    const [dupe] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, input.slug));
    if (dupe) throw conflict("Slug already taken");
    const [t] = await tx.insert(tenants)
      .values({ id: tenantId, slug: input.slug, name: input.name, region: input.region ?? "eu" }).returning();
    const roleIds = await seedSystemRoles(tx, tenantId);
    const membershipId = uuidv7();
    await tx.insert(memberships).values({ id: membershipId, tenantId, userId: owner.userId });
    await tx.insert(memberRoles).values({ tenantId, membershipId, roleId: roleIds.owner! });
    const ctx: RequestContext = {
      tenantId, requestId: meta.requestId, ip: meta.ip, userAgent: meta.userAgent,
      actor: { type: "user", id: owner.userId, userId: owner.userId, membershipId, permissions: new Set(["*"]) },
    };
    await audit(tx, ctx, "tenant.created", { type: "tenant", id: tenantId }, { slug: input.slug, name: input.name });
    await emitEvent(tx, ctx, "core.tenant.created", { id: tenantId, slug: input.slug });
    return t!;
  });
}

export async function getTenant(db: Db, tenantId: string) {
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  return t ?? null;
}

// ───────── Authorization data ─────────
/** Active membership + effective permissions for a user in a tenant, or null. */
export async function resolveMembership(tx: Tx, tenantId: string, userId: string) {
  const [m] = await tx.select().from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId), eq(memberships.status, "active")));
  if (!m) return null;
  const perms = await tx.selectDistinct({ p: rolePermissions.permission })
    .from(memberRoles).innerJoin(rolePermissions, eq(rolePermissions.roleId, memberRoles.roleId))
    .where(eq(memberRoles.membershipId, m.id));
  return { membershipId: m.id, permissions: new Set(perms.map((r) => r.p)) };
}

// ───────── API keys: "ok_<uuid-no-dashes>_<base64url secret>" ─────────
const KEY_RE = /^ok_([0-9a-f]{32})_([A-Za-z0-9_-]{43})$/;
const hmac = (pepper: string, secret: string) => createHmac("sha256", pepper).update(secret).digest();
const hexToUuid = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;

export async function createApiKey(
  tx: Tx, ctx: RequestContext, pepper: string,
  input: { name: string; scopes: string[]; expiresAt?: Date | undefined },
) {
  // A key can never hold more than its creator.
  for (const s of input.scopes) {
    if (!hasPermission(ctx.actor.permissions, s)) throw forbidden(`Cannot grant ${s}`);
  }
  const id = uuidv7();
  const secret = randomBytes(32).toString("base64url");
  await tx.insert(apiKeys).values({
    id, tenantId: ctx.tenantId, name: input.name, hash: hmac(pepper, secret), scopes: input.scopes,
    createdBy: ctx.actor.userId ?? null, expiresAt: input.expiresAt ?? null,
  });
  await audit(tx, ctx, "apikey.created", { type: "api_key", id }, { name: input.name, scopes: input.scopes });
  return { id, token: `ok_${id.replaceAll("-", "")}_${secret}` };
}

export async function verifyApiKey(db: Db, pepper: string, token: string) {
  const m = KEY_RE.exec(token);
  if (!m) throw unauthorized("Invalid API key");
  const id = hexToUuid(m[1]!);
  const [k] = await db.select().from(apiKeys).where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)));
  const expected = hmac(pepper, m[2]!);
  if (!k || k.hash.length !== expected.length || !timingSafeEqual(k.hash, expected)) throw unauthorized("Invalid API key");
  if (k.expiresAt && k.expiresAt < new Date()) throw unauthorized("API key expired");
  // Best effort; avoid write amplification by updating at most once a minute.
  db.update(apiKeys).set({ lastUsedAt: new Date() })
    .where(and(eq(apiKeys.id, id), sql`coalesce(${apiKeys.lastUsedAt}, 'epoch') < now() - interval '1 minute'`))
    .catch(() => {});
  return { id: k.id, tenantId: k.tenantId, createdBy: k.createdBy, scopes: new Set(k.scopes) };
}

export async function listApiKeys(tx: Tx, ctx: RequestContext) {
  return tx.select({
    id: apiKeys.id, name: apiKeys.name, scopes: apiKeys.scopes, expiresAt: apiKeys.expiresAt,
    lastUsedAt: apiKeys.lastUsedAt, revokedAt: apiKeys.revokedAt, createdAt: apiKeys.createdAt,
  }).from(apiKeys).where(eq(apiKeys.tenantId, ctx.tenantId));
}

export async function revokeApiKey(tx: Tx, ctx: RequestContext, id: string) {
  const r = await tx.update(apiKeys).set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.tenantId, ctx.tenantId), isNull(apiKeys.revokedAt))).returning({ id: apiKeys.id });
  if (!r.length) throw notFound("API key");
  await audit(tx, ctx, "apikey.revoked", { type: "api_key", id });
}

// ───────── Members ─────────
export async function listMembers(tx: Tx, ctx: RequestContext) {
  const rows = await tx.select({
    id: memberships.id, userId: users.id, email: users.email, name: users.name, status: memberships.status,
    createdAt: memberships.createdAt,
  }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.tenantId, ctx.tenantId));
  const mr = rows.length ? await tx.select({ membershipId: memberRoles.membershipId, key: roles.key })
    .from(memberRoles).innerJoin(roles, eq(roles.id, memberRoles.roleId))
    .where(inArray(memberRoles.membershipId, rows.map((r) => r.id))) : [];
  return rows.map((r) => ({ ...r, roles: mr.filter((x) => x.membershipId === r.id).map((x) => x.key) }));
}

export async function setMemberRoles(
  tx: Tx, ctx: RequestContext, membershipId: string, roleKeys: string[], o: { skipAudit?: boolean } = {},
) {
  const [m] = await tx.select().from(memberships)
    .where(and(eq(memberships.id, membershipId), eq(memberships.tenantId, ctx.tenantId)));
  if (!m) throw notFound("Member");
  const found = roleKeys.length ? await tx.select().from(roles).where(inArray(roles.key, roleKeys)) : [];
  if (found.length !== new Set(roleKeys).size) throw badRequest("Unknown role");
  if (found.some((r) => r.key === "owner") && !ctx.actor.permissions.has("*")) throw forbidden("Only owners can grant owner");
  // No escalation: you can only hand out, or take away, access you hold yourself.
  assertHolds(ctx, await rolePerms(tx, found.map((r) => r.id)), "give these roles");
  assertHolds(ctx, await memberPerms(tx, membershipId), "change the roles of this member");
  await tx.delete(memberRoles).where(eq(memberRoles.membershipId, membershipId));
  if (found.length) {
    await tx.insert(memberRoles).values(found.map((r) => ({ tenantId: ctx.tenantId, membershipId, roleId: r.id })));
  }
  await assertOwnerRemains(tx);
  if (!o.skipAudit) await audit(tx, ctx, "member.roles_set", { type: "membership", id: membershipId }, { roles: roleKeys });
}

export async function removeMember(tx: Tx, ctx: RequestContext, membershipId: string) {
  assertHolds(ctx, await memberPerms(tx, membershipId), "remove this member");
  const r = await tx.delete(memberships)
    .where(and(eq(memberships.id, membershipId), eq(memberships.tenantId, ctx.tenantId))).returning();
  if (!r.length) throw notFound("Member");
  await assertOwnerRemains(tx);
  await audit(tx, ctx, "member.removed", { type: "membership", id: membershipId }, { userId: r[0]!.userId });
  await emitEvent(tx, ctx, "core.member.removed", { membershipId, userId: r[0]!.userId });
}

export async function rolePerms(tx: Tx, roleIds: string[]): Promise<string[]> {
  if (!roleIds.length) return [];
  const rows = await tx.selectDistinct({ p: rolePermissions.permission }).from(rolePermissions).where(inArray(rolePermissions.roleId, roleIds));
  return rows.map((r) => r.p);
}

async function memberPerms(tx: Tx, membershipId: string): Promise<string[]> {
  const rows = await tx.select({ id: memberRoles.roleId }).from(memberRoles).where(eq(memberRoles.membershipId, membershipId));
  return rolePerms(tx, rows.map((r) => r.id));
}

/** Throws unless the actor holds every one of these permissions (so admins can't grant themselves, or strip from owners, more than they have). */
export function assertHolds(ctx: RequestContext, perms: Iterable<string>, what: string) {
  const missing = [...perms].filter((p) => !hasPermission(ctx.actor.permissions, p));
  if (missing.length) throw forbidden(`You can't ${what}: it involves access you don't have yourself (${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ", …" : ""})`);
}

async function assertOwnerRemains(tx: Tx) {
  const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(memberRoles)
    .innerJoin(roles, eq(roles.id, memberRoles.roleId))
    .innerJoin(memberships, eq(memberships.id, memberRoles.membershipId))
    .where(and(eq(roles.key, "owner"), eq(memberships.status, "active")));
  if (!row || row.n < 1) throw conflict("Tenant must keep at least one owner");
}

// ───────── Roles ─────────
export async function listRoles(tx: Tx) {
  const rs = await tx.select().from(roles);
  const ps = await tx.select().from(rolePermissions);
  return rs.map((r) => ({ ...r, permissions: ps.filter((p) => p.roleId === r.id).map((p) => p.permission).sort() }));
}

export async function upsertRole(
  tx: Tx, ctx: RequestContext, input: { key: string; name: string; permissions: string[] },
) {
  const [existing] = await tx.select().from(roles).where(eq(roles.key, input.key));
  if (existing?.system) throw forbidden("System roles are managed by the platform");
  assertHolds(ctx, input.permissions, "grant these permissions");
  if (existing) assertHolds(ctx, await rolePerms(tx, [existing.id]), "change this role");
  const id = existing?.id ?? uuidv7();
  if (existing) await tx.update(roles).set({ name: input.name }).where(eq(roles.id, id));
  else await tx.insert(roles).values({ id, tenantId: ctx.tenantId, key: input.key, name: input.name });
  await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
  const perms = [...new Set(input.permissions)];
  if (perms.length) await tx.insert(rolePermissions).values(perms.map((permission) => ({ tenantId: ctx.tenantId, roleId: id, permission })));
  await audit(tx, ctx, existing ? "role.updated" : "role.created", { type: "role", id }, input);
  return { id, ...input, permissions: perms, system: false };
}

export async function deleteRole(tx: Tx, ctx: RequestContext, key: string) {
  const [r] = await tx.select().from(roles).where(eq(roles.key, key));
  if (!r) throw notFound("Role");
  if (r.system) throw forbidden("System roles cannot be deleted");
  assertHolds(ctx, await rolePerms(tx, [r.id]), "delete this role");
  await tx.delete(roles).where(eq(roles.id, r.id));
  await audit(tx, ctx, "role.deleted", { type: "role", id: r.id }, { key });
}
