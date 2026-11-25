import { randomInt } from "node:crypto";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "@office/db";
import { moduleErrors as E, ModuleError, type ModuleContext } from "@office/sdk";
import { domains, mailboxes, type SuspendReason } from "./schema.ts";
import { getPayments, getProvider, ProviderError, type DnsRecord, type WorkmailProvider } from "./provider.ts";
import { isDomainName } from "./fake-provider.ts";

export const WRITE = "workmail:mailbox.write";
export const DOMAIN_MANAGE = "workmail:domain.manage";
/** ICANN: a newly registered domain can't be moved to another company for 60 days. */
export const TRANSFER_LOCK_DAYS = 60;
const PAID_NOW = "paid-on-order";

// ── Settings ─────────────────────────────────────────────────────────────────
export interface Settings { maxMailboxes: number }
export const settingsOf = (ctx: ModuleContext): Settings => ({ maxMailboxes: 10, ...ctx.settings.get<Partial<Settings>>() });

// ── Input schemas ────────────────────────────────────────────────────────────
const domainName = z.string().trim().toLowerCase().max(253).refine(isDomainName, "Enter a domain like mycompany.com");
export const Registrant = z.object({
  name: z.string().trim().min(2, "Enter the business's legal name").max(200),
  email: z.string().trim().toLowerCase().email().max(320),
  address: z.string().trim().min(2, "Enter the street address").max(300),
  city: z.string().trim().min(1, "Enter the city").max(120),
  postalCode: z.string().trim().min(1, "Enter the postal code").max(30),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a 2-letter country code, e.g. ES"),
  phone: z.string().trim().max(40).optional(),
}).strict();
export const SearchQuery = z.object({ q: z.string().trim().min(2).max(100) });
export const OrderInput = z.object({
  domain: domainName,
  registrant: Registrant,
  /** Path inside the app to come back to after paying, e.g. "/t/shop/m/workmail/email". */
  returnPath: z.string().regex(/^\/(?!\/)[\w\-./?=&%]{0,300}$/).default("/"),
}).strict();
export const ConnectInput = z.object({ domain: domainName }).strict();
const localPart = z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/, "Use letters, numbers, dots, dashes or underscores, e.g. anna");
export const MailboxInput = z.object({
  domainId: z.uuid(),
  localPart,
  name: z.string().trim().min(1).max(200),
  /** The colleague this mailbox is for (a member's user id). */
  userId: z.uuid().nullish(),
}).strict();
export const MailboxListQuery = z.object({ domainId: z.uuid().optional() });
/** Removing a domain: the domain's name, typed by the person, to confirm. */
export const RemoveDomainInput = z.object({ confirm: z.string().trim().toLowerCase().max(253) }).strict();
/** Managing domains isn't enough to remove one: it changes what the business pays, so it also needs "manage features". */
const BILLING_MANAGE = "core:modules.manage";

// ── Helpers ──────────────────────────────────────────────────────────────────
type Domain = typeof domains.$inferSelect;
type Mailbox = typeof mailboxes.$inferSelect;
const actorRef = (ctx: ModuleContext) => `${ctx.actor.type}:${ctx.actor.id}`;

function needProvider(): WorkmailProvider {
  const p = getProvider();
  if (!p) throw new ModuleError(424, "workmail_unavailable", "Work email isn't set up on this server yet.");
  return p;
}
/** Runs a provider call; a provider failure becomes a clear 502 instead of a crash. */
async function viaProvider<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof ProviderError) throw new ModuleError(e.code === "mailbox_exists" || e.code === "domain_unavailable" ? 409 : 424, e.code, e.message);
    throw new ModuleError(424, "provider_error", "The email provider couldn't do that just now. Please try again in a moment.");
  }
}

const domainDto = (d: Domain, records: DnsRecord[] | null = null) => ({
  id: d.id, name: d.name, source: d.source, status: d.status, priceCents: d.priceCents, currency: d.currency,
  registrant: d.registrant ? { name: d.registrant.name, email: d.registrant.email } : null,
  registeredAt: d.registeredAt, expiresOn: d.expiresOn, lastError: d.lastError, dnsCheckedAt: d.dnsCheckedAt, createdAt: d.createdAt,
  /** Registered for the business, so it can move it with a transfer code (also after removing it, until it expires). */
  transferable: d.source === "bought" && (d.status === "active" || (d.status === "removed" && !!d.providerRef)),
  removedAt: d.removedAt,
  records,
});

async function loadDomain(ctx: ModuleContext, id: string, lock = false, includeRemoved = false): Promise<Domain> {
  const q = ctx.db.select().from(domains).where(includeRemoved ? eq(domains.id, id) : and(eq(domains.id, id), ne(domains.status, "removed")));
  const [r] = lock ? await q.for("update") : await q;
  if (!r) throw E.notFound("Domain");
  return r;
}
async function loadMailbox(ctx: ModuleContext, id: string): Promise<Mailbox> {
  const [r] = await ctx.db.select().from(mailboxes).where(and(eq(mailboxes.id, id), ne(mailboxes.status, "deleted"))).for("update");
  if (!r) throw E.notFound("Mailbox");
  return r;
}

const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** A starting password that's easy to read out: three groups of four, no look-alike characters. */
export function makePassword(): string {
  const s = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

// ── Config and search ────────────────────────────────────────────────────────
export async function config(ctx: ModuleContext) {
  const p = getProvider();
  const activeDomains = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(domains).where(and(eq(domains.status, "active")));
  return {
    available: !!p, maxMailboxes: settingsOf(ctx).maxMailboxes, paymentRequired: !!getPayments(),
    hasDomain: (activeDomains[0]?.n ?? 0) > 0,
    /** Mailboxes that count (and are paid for): every one that isn't deleted, switched off or not. */
    mailboxesUsed: await mailboxCount(ctx),
    /** What one more mailbox costs per month and how this business pays it (shown before creating one). */
    mailboxPrice: (await getPayments()?.mailboxPrice?.(ctx.tenantId)) ?? null,
  };
}

/**
 * Mailboxes that count towards the limit and the bill: all that aren't deleted (a switched-off mailbox still exists),
 * except those switched off because their domain was removed (kept with their mail, not billed).
 */
const billable = () => and(ne(mailboxes.status, "deleted"), sql`coalesce(${mailboxes.suspendReason}, '') <> 'domain_removed'`);
async function mailboxCount(ctx: ModuleContext) {
  const [{ n } = { n: 0 }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(mailboxes).where(billable());
  return n;
}
/** Tells billing the new number of mailboxes. */
async function billMailboxes(ctx: ModuleContext) {
  await getPayments()?.mailboxesChanged?.({ tenantId: ctx.tenantId, count: await mailboxCount(ctx) });
}

export async function searchDomains(ctx: ModuleContext, q: string) {
  ctx.authz.require(DOMAIN_MANAGE);
  const p = needProvider();
  return viaProvider(() => p.searchDomains(q));
}

// ── Domains ──────────────────────────────────────────────────────────────────
export async function listDomains(ctx: ModuleContext) {
  // Removed domains are hidden, except a bought one that is still registered to the business (it can still be moved away).
  const today = new Date().toISOString().slice(0, 10);
  const rows = (await ctx.db.select().from(domains).orderBy(asc(domains.createdAt), asc(domains.id)))
    .filter((d) => d.status !== "removed" || (d.source === "bought" && !!d.providerRef && !!d.expiresOn && d.expiresOn >= today));
  const counts = await ctx.db.select({ domainId: mailboxes.domainId, n: sql<number>`count(*)::int` }).from(mailboxes).where(billable()).groupBy(mailboxes.domainId);
  const perDomain = new Map(counts.map((c) => [c.domainId, c.n]));
  const p = getProvider();
  const out = [];
  for (const d of rows) {
    const records = d.status === "dns_pending" && p ? await p.requiredRecords(d.name).catch(() => null) : null;
    out.push({ ...domainDto(d, records), mailboxes: perDomain.get(d.id) ?? 0 });
  }
  return out;
}

/** An existing, live row for this name in this business, if any. Rows for other businesses are invisible (RLS). */
async function existingDomain(ctx: ModuleContext, name: string) {
  const [r] = await ctx.db.select().from(domains).where(and(eq(domains.name, name), ne(domains.status, "removed")));
  return r ?? null;
}

async function insertDomain(ctx: ModuleContext, row: typeof domains.$inferInsert) {
  try {
    // A savepoint, so a clash with another business's domain doesn't spoil the whole request.
    return await ctx.db.transaction(async (tx) => (await tx.insert(domains).values(row).returning())[0]!);
  } catch (e) {
    if ((e as { code?: string; cause?: { code?: string } }).code === "23505" || (e as { cause?: { code?: string } }).cause?.code === "23505") {
      throw E.conflict(`${row.name} is already taken. Choose another name.`);
    }
    throw e;
  }
}

export async function orderDomain(ctx: ModuleContext, input: z.infer<typeof OrderInput>) {
  ctx.authz.require(DOMAIN_MANAGE);
  const p = needProvider();
  const prior = await existingDomain(ctx, input.domain);
  if (prior && prior.status !== "awaiting_payment") throw E.conflict(`${input.domain} is already in your list.`);
  // The price comes from the provider now, never from the browser.
  const offer = (await viaProvider(() => p.searchDomains(input.domain))).find((o) => o.domain === input.domain);
  if (!offer?.available || offer.priceCents === null) throw E.conflict(`${input.domain} isn't available. Try another name.`);
  if (prior) await ctx.db.update(domains).set({ status: "removed", updatedAt: new Date() }).where(eq(domains.id, prior.id));

  const row = await insertDomain(ctx, {
    id: uuidv7(), tenantId: ctx.tenantId, name: input.domain, source: "bought", status: "awaiting_payment",
    priceCents: offer.priceCents, currency: offer.currency, registrant: input.registrant, createdBy: actorRef(ctx),
  });
  const payments = getPayments();
  const charge = payments
    ? await payments.chargeDomain({
      tenantId: ctx.tenantId, orderId: row.id, domain: row.name, amountCents: offer.priceCents, currency: offer.currency,
      description: `Domain ${row.name}, 1 year`, returnPath: `${input.returnPath}${input.returnPath.includes("?") ? "&" : "?"}order=${row.id}`,
    }).catch((e) => { throw new ModuleError(424, "payment_unavailable", e instanceof Error && e.message ? "Payment couldn't be started. Please try again in a moment." : "Payment failed"); })
    : { status: "paid" as const };
  if (charge.status === "redirect") {
    await ctx.db.update(domains).set({ paymentRef: charge.ref, updatedAt: new Date() }).where(eq(domains.id, row.id));
    return { domain: domainDto({ ...row, paymentRef: charge.ref }), redirectUrl: charge.url };
  }
  // Paid on the spot (no payment page needed). Remembered, so "try again" after a provider hiccup doesn't ask for payment.
  await ctx.db.update(domains).set({ paymentRef: PAID_NOW, updatedAt: new Date() }).where(eq(domains.id, row.id));
  return { domain: await completeOrder(ctx, p, { ...row, paymentRef: PAID_NOW }), redirectUrl: null };
}

/** Registers a paid-for domain in the business's name and switches its mail records on. Safe to repeat. */
async function completeOrder(ctx: ModuleContext, p: WorkmailProvider, row: Domain) {
  if (row.status === "active") return domainDto(row);
  try {
    const reg = await p.registerDomain({ domain: row.name, registrant: row.registrant! });
    const [d] = await ctx.db.update(domains).set({
      status: "active", providerRef: reg.ref, expiresOn: reg.expiresOn, registeredAt: new Date(), lastError: null, updatedAt: new Date(),
    }).where(eq(domains.id, row.id)).returning();
    await ctx.audit.log("domain.bought", { type: "domain", id: row.id }, { domain: row.name, priceCents: row.priceCents, currency: row.currency });
    await ctx.events.emit("workmail.domain.registered", { id: row.id, domain: row.name, source: "bought", expiresOn: reg.expiresOn });
    return domainDto(d!);
  } catch (e) {
    const message = e instanceof ProviderError ? e.message : "The registration didn't go through.";
    await ctx.db.update(domains).set({ lastError: message, updatedAt: new Date() }).where(eq(domains.id, row.id));
    throw new ModuleError(e instanceof ProviderError && e.code === "domain_unavailable" ? 409 : 424, "registration_failed",
      `${message} Nothing is lost: try "Check payment" again in a moment, or contact support if you were charged.`, { keepChanges: true });
  }
}

/** After paying on the payment page: checks the payment and finishes the order. */
export async function confirmOrder(ctx: ModuleContext, id: string) {
  ctx.authz.require(DOMAIN_MANAGE);
  const p = needProvider();
  const row = await loadDomain(ctx, id, true);
  if (row.source !== "bought") throw E.badRequest("This domain wasn't bought through Office");
  if (row.status === "active") return domainDto(row);
  const payments = getPayments();
  const paid = !payments || row.paymentRef === PAID_NOW || (!!row.paymentRef && (await payments.isPaid(row.paymentRef).catch(() => false)));
  if (!paid) throw new ModuleError(402, "not_paid", "The payment hasn't gone through yet. If you just paid, wait a few seconds and try again.");
  return completeOrder(ctx, p, row);
}

export async function connectDomain(ctx: ModuleContext, input: z.infer<typeof ConnectInput>) {
  ctx.authz.require(DOMAIN_MANAGE);
  const p = needProvider();
  if (await existingDomain(ctx, input.domain)) throw E.conflict(`${input.domain} is already in your list.`);
  const row = await insertDomain(ctx, { id: uuidv7(), tenantId: ctx.tenantId, name: input.domain, source: "connected", status: "dns_pending", createdBy: actorRef(ctx) });
  await ctx.audit.log("domain.connect_started", { type: "domain", id: row.id }, { domain: row.name });
  return domainDto(row, await viaProvider(() => p.requiredRecords(row.name)));
}

/** "Check now": are the records in place at the business's own registrar? */
export async function checkDomain(ctx: ModuleContext, id: string) {
  ctx.authz.require(DOMAIN_MANAGE);
  const p = needProvider();
  const row = await loadDomain(ctx, id, true);
  if (row.source !== "connected") throw E.badRequest("Only a connected domain needs its records checked");
  const res = await viaProvider(() => p.checkDns(row.name));
  const now = new Date();
  if (res.ok && row.status === "dns_pending") {
    const [d] = await ctx.db.update(domains).set({ status: "active", dnsCheckedAt: now, updatedAt: now }).where(eq(domains.id, id)).returning();
    await ctx.audit.log("domain.connected", { type: "domain", id }, { domain: row.name });
    await ctx.events.emit("workmail.domain.registered", { id, domain: row.name, source: "connected", expiresOn: null });
    return { ok: true, missing: [], domain: domainDto(d!) };
  }
  const [d] = await ctx.db.update(domains).set({ dnsCheckedAt: now, updatedAt: now }).where(eq(domains.id, id)).returning();
  return { ok: res.ok, missing: res.missing, domain: domainDto(d!, row.status === "dns_pending" ? await p.requiredRecords(row.name) : null) };
}

/** The code to take a domain we registered for the business to another company. */
export async function transferOut(ctx: ModuleContext, id: string) {
  ctx.authz.require(DOMAIN_MANAGE);
  const p = needProvider();
  const row = await loadDomain(ctx, id, false, true);
  if (row.source !== "bought") throw E.badRequest(`${row.name} is registered with your own registrar, so get its transfer code there.`);
  if (!row.providerRef || (row.status !== "active" && row.status !== "removed")) throw E.badRequest("This domain isn't registered yet.");
  const eligible = new Date((row.registeredAt ?? row.createdAt).getTime() + TRANSFER_LOCK_DAYS * 86_400_000);
  if (eligible.getTime() > Date.now()) {
    throw E.conflict(`A new domain can be moved to another company after ${TRANSFER_LOCK_DAYS} days, from ${eligible.toISOString().slice(0, 10)}. Until then, it stays here and keeps working.`);
  }
  const { code } = await viaProvider(() => p.transferOutCode(row.providerRef!));
  await ctx.audit.log("domain.transfer_code_shown", { type: "domain", id }, { domain: row.name });
  return { domain: row.name, code };
}

/**
 * Removes a domain from Work email. Its mailboxes are switched off (mail stops arriving; the mail already in them is kept,
 * nothing is deleted) and are no longer billed. A domain bought through us stays registered in the business's name until it
 * expires and is not renewed (the year paid isn't refunded); it can still be moved to another registrar after the 60-day lock.
 * A connected domain (one the business already owned) is simply disconnected. Needs the domain's name typed to confirm.
 */
export async function removeDomain(ctx: ModuleContext, id: string, input: z.infer<typeof RemoveDomainInput>) {
  ctx.authz.require(DOMAIN_MANAGE);
  ctx.authz.require(BILLING_MANAGE);
  const row = await loadDomain(ctx, id, true);
  if (input.confirm !== row.name) throw E.badRequest(`Type ${row.name} to confirm.`);
  const p = getProvider();
  const boxes = await ctx.db.select().from(mailboxes).where(and(eq(mailboxes.domainId, id), ne(mailboxes.status, "deleted")));
  for (const b of boxes) {
    // Mail stops arriving; what's in the mailbox stays. If the provider fails, it's still marked off here and logged.
    if (b.status === "active" && p && b.providerRef) await p.setMailboxActive(b.providerRef, false).catch((err) => ctx.log.warn?.({ err, mailboxId: b.id }, "couldn't switch mailbox off at the provider"));
    await ctx.db.update(mailboxes).set({ status: "suspended", suspendReason: "domain_removed", updatedAt: new Date() }).where(eq(mailboxes.id, b.id));
    await ctx.events.emit("workmail.mailbox.suspended", { id: b.id, reason: "domain_removed", userId: b.userId });
  }
  const now = new Date();
  await ctx.db.update(domains).set({ status: "removed", removedAt: now, updatedAt: now }).where(eq(domains.id, id));
  // Fewer mailboxes to pay for. Removing goes ahead even if billing can't be lowered right now (logged to fix by hand).
  await billMailboxes(ctx).catch((err) => ctx.log.warn?.({ err, domainId: id }, "couldn't lower the mailbox count on the subscription"));
  const kept = row.source === "bought" && row.status === "active" && !!row.providerRef;
  const eligible = new Date((row.registeredAt ?? row.createdAt).getTime() + TRANSFER_LOCK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const result = {
    domain: row.name, source: row.source, mailboxesSwitchedOff: boxes.length,
    /** Bought and registered: stays the business's until it expires, not renewed; can be moved away from `transferFrom`. */
    keptUntil: kept ? row.expiresOn : null, transferFrom: kept ? eligible : null,
  };
  await ctx.audit.log("domain.removed", { type: "domain", id }, { ...result, renews: false });
  await ctx.events.emit("workmail.domain.removed", { id, domain: row.name, source: row.source, mailboxesSwitchedOff: boxes.length });
  return result;
}

// ── Mailboxes ────────────────────────────────────────────────────────────────
async function mailboxDtos(ctx: ModuleContext, rows: Mailbox[]) {
  const ds = await ctx.db.select({ id: domains.id, name: domains.name }).from(domains).where(inArray(domains.id, [...new Set(rows.map((r) => r.domainId))]));
  const names = new Map(ds.map((d) => [d.id, d.name]));
  const p = getProvider();
  return rows.map((r) => {
    const domain = names.get(r.domainId) ?? "";
    const address = `${r.localPart}@${domain}`;
    return {
      id: r.id, address, localPart: r.localPart, domainId: r.domainId, domain, name: r.displayName, userId: r.userId, status: r.status,
      suspendReason: r.suspendReason, webmailUrl: p ? p.webmailUrl(address) : null, createdAt: r.createdAt,
    };
  });
}

export async function listMailboxes(ctx: ModuleContext, q: z.infer<typeof MailboxListQuery>) {
  const where = [ne(mailboxes.status, "deleted")];
  if (q.domainId) where.push(eq(mailboxes.domainId, q.domainId));
  // People who can't manage mailboxes see only their own.
  if (!ctx.authz.can(WRITE)) where.push(eq(mailboxes.userId, ctx.actor.userId ?? "00000000-0000-0000-0000-000000000000"));
  const rows = await ctx.db.select().from(mailboxes).where(and(...where)).orderBy(asc(mailboxes.createdAt), asc(mailboxes.id));
  return rows.length ? mailboxDtos(ctx, rows) : [];
}

export async function createMailbox(ctx: ModuleContext, input: z.infer<typeof MailboxInput>) {
  ctx.authz.require(WRITE);
  const p = needProvider();
  const dom = await loadDomain(ctx, input.domainId);
  if (dom.status !== "active") throw E.conflict(`${dom.name} isn't ready yet. ${dom.source === "connected" ? "Finish adding its records first." : "Finish paying first."}`);
  if (input.userId && !(await ctx.people.get(input.userId))) throw E.badRequest("The mailbox owner must be an active member of this business");
  const n = await mailboxCount(ctx);
  const max = settingsOf(ctx).maxMailboxes;
  if (n >= max) throw E.conflict(`This business can have up to ${max} work mailboxes. Delete one you don't use, or ask us for more.`);
  const [dup] = await ctx.db.select({ id: mailboxes.id }).from(mailboxes)
    .where(and(eq(mailboxes.domainId, dom.id), eq(mailboxes.localPart, input.localPart), ne(mailboxes.status, "deleted")));
  if (dup) throw E.conflict(`${input.localPart}@${dom.name} already exists.`);

  const password = makePassword();
  const made = await viaProvider(() => p.createMailbox({ domain: dom.name, localPart: input.localPart, name: input.name, password }));
  let row: Mailbox;
  try {
    [row] = await ctx.db.insert(mailboxes).values({
      id: uuidv7(), tenantId: ctx.tenantId, domainId: dom.id, localPart: input.localPart, displayName: input.name,
      userId: input.userId ?? null, providerRef: made.ref, createdBy: actorRef(ctx),
    }).returning() as [Mailbox];
  } catch (e) {
    await p.deleteMailbox(made.ref).catch(() => undefined);   // don't leave a mailbox nobody knows about
    throw e;
  }
  // Each mailbox is paid per month: the subscription follows the count. If billing fails, the mailbox is taken back.
  try {
    await billMailboxes(ctx);
  } catch (e) {
    await p.deleteMailbox(made.ref).catch(() => undefined);
    await ctx.db.update(mailboxes).set({ status: "deleted", updatedAt: new Date() }).where(eq(mailboxes.id, row.id));
    ctx.log.warn?.({ err: e }, "mailbox not billed; taken back");
    throw E.conflict("The mailbox couldn't be added to your subscription, so it wasn't created. Check your card under Manage subscription, then try again.");
  }
  const [dto] = await mailboxDtos(ctx, [row]);
  await ctx.audit.log("mailbox.created", { type: "mailbox", id: row.id }, { address: dto!.address, userId: input.userId ?? null });
  await ctx.events.emit("workmail.mailbox.created", { id: row.id, address: dto!.address, domain: dom.name, userId: input.userId ?? null });
  // The password is shown once, to the person who created it; Office never stores it.
  return { ...dto!, password };
}

async function setActive(ctx: ModuleContext, row: Mailbox, active: boolean, reason: SuspendReason | null) {
  const p = needProvider();
  if (row.providerRef) await viaProvider(() => p.setMailboxActive(row.providerRef!, active));
  await ctx.db.update(mailboxes).set({ status: active ? "active" : "suspended", suspendReason: active ? null : reason, updatedAt: new Date() }).where(eq(mailboxes.id, row.id));
}

export async function suspendMailbox(ctx: ModuleContext, id: string) {
  ctx.authz.require(WRITE);
  const row = await loadMailbox(ctx, id);
  if (row.status === "active") {
    await setActive(ctx, row, false, "by_hand");
    await ctx.audit.log("mailbox.suspended", { type: "mailbox", id }, { reason: "by_hand" });
    await ctx.events.emit("workmail.mailbox.suspended", { id, reason: "by_hand", userId: row.userId });
  }
  return (await mailboxDtos(ctx, [(await loadMailbox(ctx, id))]))[0]!;
}

export async function resumeMailbox(ctx: ModuleContext, id: string) {
  ctx.authz.require(WRITE);
  const row = await loadMailbox(ctx, id);
  if (row.suspendReason === "domain_removed") throw E.conflict("Its domain was removed, so this mailbox can't be switched back on. Its mail is kept; delete it if you no longer need it.");
  if (row.status === "suspended") {
    await setActive(ctx, row, true, null);
    await ctx.audit.log("mailbox.resumed", { type: "mailbox", id });
  }
  return (await mailboxDtos(ctx, [(await loadMailbox(ctx, id))]))[0]!;
}

export async function deleteMailbox(ctx: ModuleContext, id: string) {
  ctx.authz.require(WRITE);
  const p = needProvider();
  const row = await loadMailbox(ctx, id);
  if (row.providerRef) await viaProvider(() => p.deleteMailbox(row.providerRef!));
  await ctx.db.update(mailboxes).set({ status: "deleted", updatedAt: new Date() }).where(eq(mailboxes.id, id));
  // One less mailbox to pay for. The mailbox is gone either way, so a billing hiccup is only logged.
  await billMailboxes(ctx).catch((err) => ctx.log.warn?.({ err, mailboxId: id }, "couldn't lower the mailbox count on the subscription"));
  await ctx.audit.log("mailbox.deleted", { type: "mailbox", id });
  await ctx.events.emit("workmail.mailbox.deleted", { id, userId: row.userId });
}

export async function resetPassword(ctx: ModuleContext, id: string) {
  ctx.authz.require(WRITE);
  const p = needProvider();
  const row = await loadMailbox(ctx, id);
  if (row.status !== "active") throw E.conflict("Switch the mailbox back on first.");
  const password = makePassword();
  await viaProvider(() => p.setMailboxPassword(row.providerRef!, password));
  await ctx.audit.log("mailbox.password_reset", { type: "mailbox", id });
  return { password };
}

// ── Reacting to other features ───────────────────────────────────────────────
/** A colleague was removed: switch their mailboxes off (mail stops; nothing is deleted). */
export async function suspendForUser(ctx: ModuleContext, userId: string) {
  const p = getProvider();
  const rows = await ctx.db.select().from(mailboxes).where(and(eq(mailboxes.userId, userId), eq(mailboxes.status, "active")));
  for (const row of rows) {
    // The member is gone either way: if the provider fails, the mailbox is still marked off here and logged for follow-up.
    if (p && row.providerRef) await p.setMailboxActive(row.providerRef, false).catch((err) => ctx.log.warn?.({ err, mailboxId: row.id }, "couldn't switch mailbox off at the provider"));
    await ctx.db.update(mailboxes).set({ status: "suspended", suspendReason: "colleague_removed", updatedAt: new Date() }).where(eq(mailboxes.id, row.id));
    await ctx.audit.log("mailbox.suspended", { type: "mailbox", id: row.id }, { reason: "colleague_removed" });
    await ctx.events.emit("workmail.mailbox.suspended", { id: row.id, reason: "colleague_removed", userId });
  }
  return rows.length;
}

/** The feature was turned off / on again: mail pauses and resumes with it. Data is kept. */
export async function setFeature(ctx: ModuleContext, on: boolean) {
  const p = getProvider();
  const rows = on
    ? await ctx.db.select().from(mailboxes).where(and(eq(mailboxes.status, "suspended"), eq(mailboxes.suspendReason, "feature_off")))
    : await ctx.db.select().from(mailboxes).where(eq(mailboxes.status, "active"));
  for (const row of rows) {
    if (p && row.providerRef) await p.setMailboxActive(row.providerRef, on).catch((err) => ctx.log.warn?.({ err, mailboxId: row.id }, "couldn't change mailbox at the provider"));
    await ctx.db.update(mailboxes).set({ status: on ? "active" : "suspended", suspendReason: on ? null : "feature_off", updatedAt: new Date() }).where(eq(mailboxes.id, row.id));
  }
  // Back on: the subscription's Work email line goes back to the number of mailboxes kept.
  if (on) await billMailboxes(ctx).catch((err) => ctx.log.warn?.({ err }, "couldn't set the mailbox count on the subscription"));
}
