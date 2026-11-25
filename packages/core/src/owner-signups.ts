import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { memberRoles, memberships, ownerSignups, platformAudit, tenants, uuidv7, withTenant, type Db } from "@office/db";
import { AppError, conflict, notFound } from "./errors.ts";
import { audit } from "./audit.ts";
import { emitEvent } from "./events.ts";
import { seedSystemRoles } from "./identity.ts";
import type { RequestContext } from "./context.ts";
import type { Region } from "./regions.ts";

/**
 * Owners who set up their own business. Someone pays for a subscription (or the program owner invites them by
 * hand), gets an email to create their sign-in account, signs in with that email address and creates the
 * business themselves: name, web address and region. They become its owner straight away. Each sign-up
 * makes one business.
 */
type Meta = { requestId: string; ip?: string | undefined; userAgent?: string | undefined };
const lower = (e: string) => e.trim().toLowerCase();
/** Not used yet, not withdrawn, and the subscription (if any) hasn't ended. */
const open = and(isNull(ownerSignups.usedAt), isNull(ownerSignups.endedAt), isNull(ownerSignups.cancelledAt));

/** After a paid checkout (Stripe). Returns null when Stripe sent the same checkout again. */
/** Work email chosen at sign-up: how many mailboxes, and the domain the owner would like (bought after the business exists). */
export interface WorkmailWish { mailboxes: number; domain: string | null }

export async function recordPaidSignup(
  db: Db, input: { email: string; customerId: string | null; subscriptionId: string; termsVersion: string | null; workmail?: WorkmailWish | null },
) {
  const [row] = await db.insert(ownerSignups).values({
    id: uuidv7(), email: lower(input.email), source: "stripe", createdBy: "stripe",
    stripeCustomerId: input.customerId, stripeSubscriptionId: input.subscriptionId, termsVersion: input.termsVersion,
    workmailMailboxes: input.workmail?.mailboxes ?? null, workmailDomain: input.workmail?.domain ?? null,
  }).onConflictDoNothing().returning();
  return row ?? null;
}

/**
 * After a pretend payment on the demo checkout page (local development and try-outs only; nothing is charged).
 * The chosen plan goes with it, so the business starts on that plan.
 */
export async function recordDemoSignup(
  db: Db, input: { email: string; plan: string; interval: "monthly" | "yearly"; termsVersion: string; workmail?: WorkmailWish | null },
) {
  const [row] = await db.insert(ownerSignups).values({
    id: uuidv7(), email: lower(input.email), source: "demo", createdBy: "demo",
    plan: input.plan, planInterval: input.interval, planTest: true, termsVersion: input.termsVersion,
    workmailMailboxes: input.workmail?.mailboxes ?? null, workmailDomain: input.workmail?.domain ?? null,
  }).returning();
  return row!;
}

/** The program owner lets someone set up a business without paying through Stripe (e.g. a customer paying by bank transfer). */
export async function inviteOwnerSignup(db: Db, admin: { email: string }, email: string) {
  const addr = lower(email);
  const [already] = await db.select().from(ownerSignups).where(and(eq(ownerSignups.email, addr), open));
  if (already) return already;   // one open invitation per email is enough; resending just emails it again
  const [row] = await db.insert(ownerSignups).values({ id: uuidv7(), email: addr, source: "program_owner", createdBy: admin.email }).returning();
  await db.insert(platformAudit).values({ id: uuidv7(), actor: admin.email, action: "owner_signup.invited", detail: { email: addr } });
  return row!;
}

/** Sign-ups waiting for their owner to create the business, newest first (for Program admin). */
export async function listOpenOwnerSignups(db: Db) {
  const rows = await db.select().from(ownerSignups)
    .where(and(isNull(ownerSignups.usedAt), isNull(ownerSignups.cancelledAt))).orderBy(desc(ownerSignups.createdAt));
  return rows.map((r) => ({ id: r.id, email: r.email, source: r.source, plan: r.plan, createdAt: r.createdAt, ended: !!r.endedAt }));
}

export async function getOwnerSignup(db: Db, id: string) {
  const [r] = await db.select().from(ownerSignups).where(eq(ownerSignups.id, id));
  return r ?? null;
}

/** Withdraws a sign-up that hasn't been used. A real (Stripe) one can't be withdrawn here: the customer paid for it. */
export async function cancelOwnerSignup(db: Db, admin: { email: string }, id: string) {
  const r = await getOwnerSignup(db, id);
  if (!r || r.usedAt || r.cancelledAt) throw notFound("Invitation");
  if (r.source === "stripe") throw new AppError(409, "paid_signup", "This person paid for a subscription; cancel it in Stripe instead.");
  await db.update(ownerSignups).set({ cancelledAt: new Date() }).where(eq(ownerSignups.id, id));
  await db.insert(platformAudit).values({ id: uuidv7(), actor: admin.email, action: "owner_signup.cancelled", detail: { email: r.email } });
}

/** Has this (verified) email paid or been invited to set up a business it hasn't created yet? */
export async function hasOpenOwnerSignup(db: Db, email: string) {
  const [r] = await db.select({ id: ownerSignups.id }).from(ownerSignups).where(and(eq(ownerSignups.email, lower(email)), open)).limit(1);
  return !!r;
}

/** The subscription of a sign-up that hasn't made a business yet ended (or came back). Returns whether one matched. */
export async function setOwnerSignupEnded(db: Db, subscriptionId: string, ended: boolean) {
  const rows = await db.update(ownerSignups).set({ endedAt: ended ? sql`coalesce(${ownerSignups.endedAt}, now())` : null })
    .where(and(eq(ownerSignups.stripeSubscriptionId, subscriptionId), isNull(ownerSignups.usedAt))).returning({ id: ownerSignups.id });
  return rows.length > 0;
}

/**
 * The signed-in owner creates their business from their open sign-up (the oldest, if there are several). They
 * become its owner at once. A paid sign-up links the business to its Stripe subscription, so billing pauses and
 * resumes it like any paid business.
 */
export async function createBusinessFromSignup(
  db: Db, owner: { userId: string; email: string }, input: { name: string; slug: string; region: Region }, meta: Meta,
  /** The module keys a plan turns on (the module registry lives in @office/platform, so the caller supplies it). */
  planFeatures: (planKey: string) => string[] | null = () => null,
) {
  const tenantId = uuidv7();
  return withTenant(db, tenantId, async (tx) => {
    const [s] = await tx.select().from(ownerSignups).where(and(eq(ownerSignups.email, lower(owner.email)), open))
      .orderBy(asc(ownerSignups.createdAt)).limit(1).for("update");
    if (!s) throw new AppError(403, "no_signup", "There's no paid subscription waiting for this email address. Sign in with the address you paid with.");
    const [dupe] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, input.slug));
    if (dupe) throw conflict("That web address is already taken. Choose another.");
    // Work email chosen at sign-up is a paid extra on top of the plan: recorded on the business and allowed by its plan.
    const workmail = !!s.workmailMailboxes;
    const planOf = (r: typeof s) => {
      const keys = r.plan ? planFeatures(r.plan) : null;
      return keys && workmail && !keys.includes("workmail") ? [...keys, "workmail"] : keys;
    };
    const [t] = await tx.insert(tenants).values({
      id: tenantId, slug: input.slug, name: input.name, region: input.region,
      ...(s.stripeSubscriptionId ? { stripeCustomerId: s.stripeCustomerId, stripeSubscriptionId: s.stripeSubscriptionId, plan: "paid" } : {}),
      ...(planOf(s) ? { plan: s.plan!, planInterval: s.planInterval ?? "monthly", planTest: s.planTest, allowedModules: planOf(s), planChangedAt: new Date() } : {}),
      ...(workmail ? { addons: ["workmail"] } : {}),
    }).returning();
    const roleIds = await seedSystemRoles(tx, tenantId);
    const membershipId = uuidv7();
    await tx.insert(memberships).values({ id: membershipId, tenantId, userId: owner.userId });
    await tx.insert(memberRoles).values({ tenantId, membershipId, roleId: roleIds.owner! });
    await tx.update(ownerSignups).set({ usedAt: new Date(), tenantId }).where(eq(ownerSignups.id, s.id));
    const ctx: RequestContext = {
      tenantId, requestId: meta.requestId, ip: meta.ip, userAgent: meta.userAgent,
      actor: { type: "user", id: owner.userId, userId: owner.userId, membershipId, permissions: new Set(["*"]) },
    };
    await audit(tx, ctx, "tenant.created", { type: "tenant", id: tenantId }, {
      slug: input.slug, name: input.name, region: input.region, by: "owner", from: s.source, ...(s.stripeSubscriptionId ? { paid: true } : {}),
      ...(s.plan ? { plan: s.plan, testPayment: s.planTest } : {}),
      ...(workmail ? { workmail: { mailboxes: s.workmailMailboxes, domain: s.workmailDomain } } : {}),
    });
    await emitEvent(tx, ctx, "core.tenant.created", { id: tenantId, slug: input.slug });
    return { ...t!, workmail: workmail ? { mailboxes: s.workmailMailboxes!, domain: s.workmailDomain } : null };
  });
}
