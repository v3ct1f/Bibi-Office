import { and, eq, inArray, sql } from "drizzle-orm";
import { platformAdmins, platformAudit, users, uuidv7, type Db } from "@office/db";
import { badRequest, conflict, forbidden, notFound } from "./errors.ts";
import type { PlatformAdmin } from "./businesses.ts";

/**
 * Program owners: the people who run this Office installation (create, pause and configure businesses).
 * Stored in platform_admins; filled once from PLATFORM_ADMIN_EMAILS, then managed in Program admin.
 * Only someone signed in with a verified email that is on the list counts as a program owner.
 */
const norm = (e: string) => e.trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function log(db: Db, actor: string, action: string, detail: Record<string, unknown>) {
  await db.insert(platformAudit).values({ id: uuidv7(), actor, action, detail });
}

/** First start: if nobody is a program owner yet, the configured emails become the owners. */
export async function seedPlatformAdmins(db: Db, emails: string[]) {
  const list = [...new Set(emails.map(norm).filter(Boolean))];
  if (!list.length) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`lock table platform_admins in share row exclusive mode`);
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(platformAdmins)) as [{ n: number }];
    if (n > 0) return;
    await tx.insert(platformAdmins).values(list.map((email) => ({ id: uuidv7(), email, addedBy: "config" })));
    await tx.insert(platformAudit).values({ id: uuidv7(), actor: "config", action: "owners.seeded", detail: { emails: list } });
  });
}

export async function isPlatformAdmin(db: Db, email: string) {
  const [r] = await db.select({ id: platformAdmins.id }).from(platformAdmins).where(eq(platformAdmins.email, norm(email)));
  return !!r;
}

/** Owners with whether they've signed in yet (an account exists for the email) and their name. */
export async function listPlatformAdmins(db: Db) {
  const rows = await db.select().from(platformAdmins).orderBy(platformAdmins.createdAt);
  const accounts = rows.length
    ? await db.select({ email: sql<string>`lower(${users.email})`, name: users.name }).from(users)
      .where(and(inArray(sql`lower(${users.email})`, rows.map((r) => r.email)), eq(users.status, "active")))
    : [];
  return rows.map((r) => {
    const a = accounts.find((x) => x.email === r.email);
    return { id: r.id, email: r.email, name: a?.name ?? null, signedIn: !!a, addedBy: r.addedBy, createdAt: r.createdAt };
  });
}

/** An owner who has an account they can sign in with. The program must always keep at least one. */
const activeOwners = async (db: Db) => (await listPlatformAdmins(db)).filter((o) => o.signedIn);

export async function addPlatformAdmin(db: Db, admin: PlatformAdmin, email: string) {
  const e = norm(email);
  if (!EMAIL_RE.test(e)) throw badRequest("Enter a valid email address");
  const [dupe] = await db.select({ id: platformAdmins.id }).from(platformAdmins).where(eq(platformAdmins.email, e));
  if (dupe) throw conflict("This person is already a program owner");
  const id = uuidv7();
  await db.insert(platformAdmins).values({ id, email: e, addedBy: admin.email });
  await log(db, admin.email, "owner.added", { email: e });
  return (await listPlatformAdmins(db)).find((o) => o.id === id)!;
}

export async function removePlatformAdmin(db: Db, admin: PlatformAdmin, id: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`lock table platform_admins in share row exclusive mode`);
    const [row] = await tx.select().from(platformAdmins).where(eq(platformAdmins.id, id));
    if (!row) throw notFound("Program owner");
    const remaining = (await activeOwners(tx as unknown as Db)).filter((o) => o.id !== id);
    if (!remaining.length) throw conflict("The program needs at least one owner who can sign in. Add another owner first.");
    await tx.delete(platformAdmins).where(eq(platformAdmins.id, id));
    await tx.insert(platformAudit).values({ id: uuidv7(), actor: admin.email, action: "owner.removed", detail: { email: row.email } });
    return { removed: row.email, self: row.email === admin.email };
  });
}

/**
 * Hand the program over: the new owner must already have an account (signed in at least once), so a typo
 * can't lock everyone out. They become an owner (if not already) and the person transferring steps down.
 */
export async function transferPlatformOwnership(db: Db, admin: PlatformAdmin, email: string) {
  const e = norm(email);
  if (e === admin.email) throw badRequest("You already own the program");
  return db.transaction(async (tx) => {
    await tx.execute(sql`lock table platform_admins in share row exclusive mode`);
    const [me] = await tx.select().from(platformAdmins).where(eq(platformAdmins.email, admin.email));
    if (!me) throw forbidden("Only the program owner can do this");
    const [account] = await tx.select({ id: users.id }).from(users)
      .where(and(sql`lower(${users.email}) = ${e}`, eq(users.status, "active")));
    if (!account) throw conflict(`${e} hasn't signed in to Office yet. Ask them to sign in once, then try again.`);
    const [existing] = await tx.select({ id: platformAdmins.id }).from(platformAdmins).where(eq(platformAdmins.email, e));
    if (!existing) await tx.insert(platformAdmins).values({ id: uuidv7(), email: e, addedBy: admin.email });
    await tx.delete(platformAdmins).where(eq(platformAdmins.id, me.id));
    await tx.insert(platformAudit).values({ id: uuidv7(), actor: admin.email, action: "ownership.transferred", detail: { to: e } });
    return { to: e };
  });
}
