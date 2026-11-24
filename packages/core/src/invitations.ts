import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { invitations, memberRoles, memberships, roles, tenants, users, uuidv7, type Tx } from "@office/db";
import { badRequest, conflict, forbidden, notFound } from "./errors.ts";
import { audit } from "./audit.ts";
import { emitEvent } from "./events.ts";
import { assertHolds, resolveMembership, rolePerms } from "./identity.ts";
import { hasPermission } from "./permissions.ts";
import { assertRoomForPerson } from "./plans.ts";
import type { RequestContext } from "./context.ts";

/**
 * Invitations: nobody is added to a company without saying yes. An admin invites an email address with
 * roles; the person opens the link while signed in with that same address and accepts.
 */
export const INVITATION_DAYS = 7;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const hashToken = (t: string) => createHash("sha256").update(t).digest();
const open = () => and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt));

async function rolesByKey(tx: Tx, keys: string[]) {
  return keys.length ? tx.select().from(roles).where(inArray(roles.key, keys)) : [];
}

/** The roles someone may hand out when adding a person (no owner unless you are one; nothing you don't hold). */
export async function checkGrantableRoles(tx: Tx, ctx: RequestContext, input: { email: string; roles: string[] }) {
  const email = input.email.trim().toLowerCase();
  const keys = [...new Set(input.roles)];
  if (!keys.length) throw badRequest("Pick at least one role");
  const found = await rolesByKey(tx, keys);
  if (found.length !== keys.length) throw badRequest("Unknown role");
  if (found.some((r) => r.key === "owner") && !ctx.actor.permissions.has("*")) throw forbidden("Only owners can add owners");
  assertHolds(ctx, await rolePerms(tx, found.map((r) => r.id)), "add someone with these roles");

  const [member] = await tx.select({ id: memberships.id }).from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, ctx.tenantId), sql`lower(${users.email}) = ${email}`)); // memberships has no RLS
  if (member) throw conflict("This person is already a member");
  return { email, keys, found };
}

/**
 * Adds a colleague whose sign-in account the owner has just created (with a starting password), so there is
 * nobody to ask: the account is new and belongs to this business's say-so.
 */
export async function addCreatedColleague(tx: Tx, ctx: RequestContext, input: { userId: string; email: string; roles: string[] }) {
  const { found, keys } = await checkGrantableRoles(tx, ctx, input);
  await assertRoomForPerson(tx, ctx.tenantId, input.email.trim().toLowerCase());
  const membershipId = uuidv7();
  await tx.insert(memberships).values({ id: membershipId, tenantId: ctx.tenantId, userId: input.userId });
  await tx.insert(memberRoles).values(found.map((r) => ({ tenantId: ctx.tenantId, membershipId, roleId: r.id })));
  // An open invitation for the same address isn't needed any more.
  await tx.update(invitations).set({ revokedAt: new Date() }).where(and(eq(invitations.email, input.email.trim().toLowerCase()), open()));
  await audit(tx, ctx, "member.added", { type: "membership", id: membershipId }, { userId: input.userId, roles: keys, accountCreated: true });
  await emitEvent(tx, ctx, "core.member.added", { membershipId, userId: input.userId, roles: keys });
  return { id: membershipId };
}

export async function createInvitation(tx: Tx, ctx: RequestContext, input: { email: string; roles: string[] }) {
  const { email, keys } = await checkGrantableRoles(tx, ctx, input);
  await assertRoomForPerson(tx, ctx.tenantId, email);

  // A new invitation replaces an open one for the same address (its link stops working).
  await tx.update(invitations).set({ revokedAt: new Date() }).where(and(eq(invitations.email, email), open()));
  const id = uuidv7();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITATION_DAYS * 86_400_000);
  await tx.insert(invitations).values({
    id, tenantId: ctx.tenantId, email, roles: keys, tokenHash: hashToken(token), invitedBy: ctx.actor.userId ?? null, expiresAt,
  });
  await audit(tx, ctx, "invitation.created", { type: "invitation", id }, { email, roles: keys });
  return { id, email, roles: keys, expiresAt, token };
}

/** Open invitations (not accepted or withdrawn), newest first; expired ones are flagged. */
export async function listInvitations(tx: Tx) {
  const rows = await tx.select({
    id: invitations.id, email: invitations.email, roles: invitations.roles, expiresAt: invitations.expiresAt,
    createdAt: invitations.createdAt, invitedBy: invitations.invitedBy, invitedByName: users.name, invitedByEmail: users.email,
  }).from(invitations).leftJoin(users, eq(users.id, invitations.invitedBy)).where(open()).orderBy(sql`${invitations.createdAt} desc`);
  const now = Date.now();
  return rows.map(({ invitedByName, invitedByEmail, ...r }) => ({
    ...r, expired: r.expiresAt.getTime() < now, invitedByName: invitedByName || invitedByEmail || null,
  }));
}

export async function revokeInvitation(tx: Tx, ctx: RequestContext, id: string) {
  const r = await tx.update(invitations).set({ revokedAt: new Date() }).where(and(eq(invitations.id, id), open()))
    .returning({ id: invitations.id, email: invitations.email });
  if (!r.length) throw notFound("Invitation");
  await audit(tx, ctx, "invitation.revoked", { type: "invitation", id }, { email: r[0]!.email });
}

/** Finds an invitation by its link token, inside the invitation's tenant (tx is bound to it). */
async function byToken(tx: Tx, token: string) {
  if (!TOKEN_RE.test(token)) throw notFound("Invitation");
  const [inv] = await tx.select().from(invitations).where(eq(invitations.tokenHash, hashToken(token)));
  if (!inv) throw notFound("Invitation");
  return inv;
}

function stateOf(inv: typeof invitations.$inferSelect) {
  if (inv.acceptedAt) return "accepted" as const;
  if (inv.revokedAt) return "withdrawn" as const;
  if (inv.expiresAt.getTime() < Date.now()) return "expired" as const;
  return "open" as const;
}

/** What the invite page shows. Anyone signed in who holds the link may look; only the invited address may accept. */
export async function viewInvitation(tx: Tx, tenantId: string, token: string, user: { userId: string; email: string }) {
  const inv = await byToken(tx, token);
  const [t] = await tx.select({ name: tenants.name, slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId));
  const [by] = inv.invitedBy ? await tx.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, inv.invitedBy)) : [];
  const roleRows = await rolesByKey(tx, inv.roles);
  const member = await resolveMembership(tx, tenantId, user.userId);
  return {
    tenant: { id: tenantId, name: t?.name ?? "", slug: t?.slug ?? "" },
    invitedBy: by ? by.name || by.email : null,
    email: inv.email,
    roles: roleRows.map((r) => r.name),
    expiresAt: inv.expiresAt,
    status: stateOf(inv),
    yourEmail: user.email.toLowerCase(),
    emailMatches: user.email.toLowerCase() === inv.email,
    alreadyMember: !!member,
  };
}

export async function acceptInvitation(
  tx: Tx, tenantId: string, token: string, user: { userId: string; email: string },
  meta: { requestId: string; ip?: string | undefined; userAgent?: string | undefined },
) {
  const found = await byToken(tx, token);
  // Lock it, so a double click can't create two memberships.
  const [inv] = await tx.select().from(invitations).where(eq(invitations.id, found.id)).for("update");
  const [t] = await tx.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId));
  const state = stateOf(inv!);
  if (state === "withdrawn") throw conflict("This invitation was withdrawn. Ask for a new one.");
  if (state === "expired") throw conflict("This invitation has expired. Ask for a new one.");
  if (state === "accepted") {
    if (inv!.acceptedBy === user.userId) return { tenantId, slug: t!.slug };
    throw conflict("This invitation was already used.");
  }
  if (user.email.toLowerCase() !== inv!.email) {
    throw forbidden(`This invitation is for ${inv!.email}. Sign in with that email address to accept it.`);
  }
  if (await resolveMembership(tx, tenantId, user.userId)) {
    await tx.update(invitations).set({ acceptedAt: new Date(), acceptedBy: user.userId }).where(eq(invitations.id, inv!.id));
    return { tenantId, slug: t!.slug };
  }
  // The inviter must still be a member who holds what the roles give; otherwise the invitation lapses.
  // Invitations from the program owner (a new business's first owner) don't depend on a member.
  const roleRows = await rolesByKey(tx, inv!.roles);
  if (!inv!.byPlatform) {
    const inviter = inv!.invitedBy ? await resolveMembership(tx, tenantId, inv!.invitedBy) : null;
    const perms = await rolePerms(tx, roleRows.map((r) => r.id));
    if (!inviter || perms.some((p) => !hasPermission(inviter.permissions, p))) {
      throw conflict("This invitation is no longer valid. Ask for a new one.");
    }
  }

  const membershipId = uuidv7();
  const existing = await tx.select({ id: memberships.id }).from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, user.userId)));
  if (existing.length) throw conflict("Your membership of this company is suspended. Ask an admin.");
  await tx.insert(memberships).values({ id: membershipId, tenantId, userId: user.userId });
  if (roleRows.length) await tx.insert(memberRoles).values(roleRows.map((r) => ({ tenantId, membershipId, roleId: r.id })));
  await tx.update(invitations).set({ acceptedAt: new Date(), acceptedBy: user.userId }).where(eq(invitations.id, inv!.id));

  const ctx: RequestContext = {
    tenantId, requestId: meta.requestId, ip: meta.ip, userAgent: meta.userAgent,
    actor: { type: "user", id: user.userId, userId: user.userId, membershipId, permissions: new Set() },
  };
  const roleKeys = roleRows.map((r) => r.key);
  await audit(tx, ctx, "member.added", { type: "membership", id: membershipId }, { userId: user.userId, roles: roleKeys, invitationId: inv!.id });
  await emitEvent(tx, ctx, "core.member.added", { membershipId, userId: user.userId, roles: roleKeys });
  return { tenantId, slug: t!.slug };
}
