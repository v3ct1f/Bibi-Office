import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import {
  invitations, memberRoles, memberships, roles, tenantModules, tenants, users, uuidv7, withTenant, type Db, type Tx,
} from "@office/db";
import { badRequest, conflict, notFound } from "./errors.ts";
import { audit } from "./audit.ts";
import { emitEvent } from "./events.ts";
import { seedSystemRoles } from "./identity.ts";
import { INVITATION_DAYS } from "./invitations.ts";
import type { RequestContext } from "./context.ts";

/**
 * The program owner's view of the businesses using the app: names, owners, size and status.
 * Never a business's own data (contacts, invoices, ...); the program owner is not a member.
 */
export interface PlatformAdmin { userId: string; email: string }
/** Who acts: a program owner, or the payment system (no user, audited as platform:stripe). */
export type PlatformActor = { userId: string | null; email: string };
type Meta = { requestId: string; ip?: string | undefined };

/** The request context for the program owner acting on one business (audited as platform:<email>). */
export const platformContext = (tenantId: string, admin: PlatformActor, meta: Meta): RequestContext => ({
  tenantId, requestId: meta.requestId, ip: meta.ip,
  actor: { type: "system", id: `platform:${admin.email}`, permissions: new Set() },
});

async function ownerInvite(tx: Tx, tenantId: string, email: string, admin: PlatformActor) {
  await tx.update(invitations).set({ revokedAt: new Date() })
    .where(and(eq(invitations.byPlatform, true), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
  await tx.update(invitations).set({ revokedAt: new Date() })
    .where(and(eq(invitations.email, email), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
  const id = uuidv7();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITATION_DAYS * 86_400_000);
  await tx.insert(invitations).values({
    id, tenantId, email, roles: ["owner"], tokenHash: createHash("sha256").update(token).digest(),
    invitedBy: admin.userId ?? null, byPlatform: true, expiresAt,
  });
  return { id, email, expiresAt, token };
}

export async function listBusinesses(db: Db) {
  const ts = await db.select().from(tenants).where(ne(tenants.status, "deleted")).orderBy(sql`${tenants.createdAt} desc`);
  const counts = ts.length
    ? await db.select({ t: memberships.tenantId, n: sql<number>`count(*)::int` }).from(memberships)
      .where(and(inArray(memberships.tenantId, ts.map((t) => t.id)), eq(memberships.status, "active"))).groupBy(memberships.tenantId)
    : [];
  const out = [];
  for (const t of ts) {
    // Owners, features and the open owner invitation sit behind each business's row-level security.
    const extra = await withTenant(db, t.id, async (tx) => {
      const owners = await tx.select({ email: users.email, name: users.name }).from(memberRoles)
        .innerJoin(roles, eq(roles.id, memberRoles.roleId))
        .innerJoin(memberships, eq(memberships.id, memberRoles.membershipId))
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(roles.key, "owner"), eq(memberships.status, "active")));
      const mods = await tx.select({ k: tenantModules.moduleKey }).from(tenantModules).where(eq(tenantModules.enabled, true));
      const [invite] = await tx.select({ email: invitations.email, expiresAt: invitations.expiresAt }).from(invitations)
        .where(and(eq(invitations.byPlatform, true), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
        .orderBy(sql`${invitations.createdAt} desc`).limit(1);
      return {
        owners, features: mods.map((m) => m.k).sort(),
        ownerInvite: invite ? { ...invite, expired: invite.expiresAt.getTime() < Date.now() } : null,
      };
    });
    out.push({
      id: t.id, name: t.name, slug: t.slug, region: t.region, status: t.status, createdAt: t.createdAt, allowedFeatures: t.allowedModules, paid: !!t.stripeSubscriptionId,
      members: counts.find((c) => c.t === t.id)?.n ?? 0, ...extra,
    });
  }
  return out;
}

/** Creates a business with no members yet and invites its owner (they become owner by accepting). */
export async function createBusiness(
  db: Db, admin: PlatformActor,
  input: { name: string; slug: string; region?: "eu" | "us" | undefined; ownerEmail: string; stripe?: { customerId: string | null; subscriptionId: string } },
  meta: Meta,
) {
  const tenantId = uuidv7();
  return withTenant(db, tenantId, async (tx) => {
    const [dupe] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, input.slug));
    if (dupe) throw conflict("That web address is already taken");
    const [t] = await tx.insert(tenants).values({ id: tenantId, slug: input.slug, name: input.name, region: input.region ?? "eu",
      ...(input.stripe ? { stripeCustomerId: input.stripe.customerId, stripeSubscriptionId: input.stripe.subscriptionId, plan: "paid" } : {}),
    }).returning();
    await seedSystemRoles(tx, tenantId);
    const inv = await ownerInvite(tx, tenantId, input.ownerEmail.trim().toLowerCase(), admin);
    const ctx = platformContext(tenantId, admin, meta);
    await audit(tx, ctx, "tenant.created", { type: "tenant", id: tenantId }, { slug: input.slug, name: input.name, by: "platform", ownerEmail: inv.email, ...(input.stripe ? { paid: true } : {}) });
    await emitEvent(tx, ctx, "core.tenant.created", { id: tenantId, slug: input.slug });
    return { tenant: t!, invite: inv };
  });
}

/** A fresh owner invitation (the first expired or went to the wrong address); it replaces the open one. */
export async function inviteBusinessOwner(db: Db, admin: PlatformAdmin, tenantId: string, email: string, meta: Meta) {
  return withTenant(db, tenantId, async (tx) => {
    const [t] = await tx.select().from(tenants).where(and(eq(tenants.id, tenantId), ne(tenants.status, "deleted")));
    if (!t) throw notFound("Business");
    const inv = await ownerInvite(tx, tenantId, email.trim().toLowerCase(), admin);
    await audit(tx, platformContext(tenantId, admin, meta), "invitation.created", { type: "invitation", id: inv.id }, { email: inv.email, roles: ["owner"], by: "platform" });
    return { tenant: t, invite: inv };
  });
}

/** Pause (nobody can use it; data is kept) or reactivate a business. */
export async function setBusinessStatus(db: Db, admin: PlatformActor, tenantId: string, status: "active" | "suspended", meta: Meta) {
  return withTenant(db, tenantId, async (tx) => {
    const [t] = await tx.update(tenants).set({ status })
      .where(and(eq(tenants.id, tenantId), ne(tenants.status, "deleted"))).returning();
    if (!t) throw notFound("Business");
    await audit(tx, platformContext(tenantId, admin, meta), status === "suspended" ? "tenant.paused" : "tenant.resumed", { type: "tenant", id: tenantId });
    return { id: t.id, status: t.status };
  });
}

/**
 * Deletes a business: it disappears for everyone (members, API keys, invitations, scheduled work) and can't be
 * reopened from the app. Its records stay in the database. The caller must type the business name to confirm.
 */
export async function deleteBusiness(db: Db, admin: PlatformAdmin, tenantId: string, confirmName: string, meta: Meta) {
  return withTenant(db, tenantId, async (tx) => {
    const [t] = await tx.select().from(tenants).where(and(eq(tenants.id, tenantId), ne(tenants.status, "deleted"))).for("update");
    if (!t) throw notFound("Business");
    if (confirmName.trim().toLowerCase() !== t.name.trim().toLowerCase()) throw badRequest("Type the business name exactly to confirm");
    await tx.update(tenants).set({ status: "deleted" }).where(eq(tenants.id, tenantId));
    await tx.update(invitations).set({ revokedAt: new Date() }).where(and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
    await audit(tx, platformContext(tenantId, admin, meta), "tenant.deleted", { type: "tenant", id: tenantId }, { name: t.name, slug: t.slug, was: t.status });
    return { id: t.id, name: t.name, status: "deleted" as const };
  });
}
