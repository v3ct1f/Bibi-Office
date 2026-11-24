import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { eq, ne, and } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import {
  AppError, INVITATION_DAYS, PLANS, createBusiness, listOwnerEmails, peopleCount, planByKey, setBusinessStatus, tenantPlan, type Plan, type RequestContext,
} from "@office/core";
import { changePlan, planModuleKeys, type ModuleDeps } from "@office/platform";
import { tenants, type Db, type Tx } from "@office/db";
import { invitationEmail, paymentFailedEmail, serviceResumedEmail, type Mailer } from "../mail.ts";
import type { Identity } from "../identity.ts";
import { verifyStripeSignature, type Billing } from "../billing.ts";

const PUBLIC = { auth: "public" } as const;
/** Date of the Terms and Privacy Policy text a customer agrees to; bump it (here and in apps/web/src/legal/company.ts) when they change. */
export const TERMS_VERSION = "2026-11-23.2";
const STRIPE_ACTOR = { userId: null, email: "stripe" } as const;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

/** "Bakery Ltd" -> "bakery-ltd" (a suggestion; the customer can edit it). */
export const slugify = (name: string) =>
  name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");

interface StripeEvent { id: string; type: string; data: { object: Record<string, unknown>; previous_attributes?: Record<string, unknown> } }
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/**
 * Paid sign-up. A visitor fills in the business name and their email on a public page, pays a monthly subscription
 * on Stripe's own page, and Stripe tells us (a signed webhook). Only then is the business created and its owner invited.
 * A cancelled or unpaid subscription pauses the business; paying again reactivates it. Data is never deleted.
 */
export async function registerBillingRoutes(
  app0: FastifyInstance,
  o: {
    db: Db; appUrl: string; mailer: Mailer | null; identity: Identity | null; billing: Billing | null; contactEmail: string | undefined;
    /** Pretend payments: a plan can be "bought" without paying, to try the product. Off unless TEST_PAYMENTS=true. */
    testPayments: boolean; modules: ModuleDeps;
    inTenant: <T>(req: FastifyRequest, perm: string | null, fn: (tx: Tx, ctx: RequestContext) => Promise<T>) => Promise<T>;
  },
) {
  const app = app0.withTypeProvider<ZodTypeProvider>();

  /** Emails the new business's owner the link to open the account (and set a password). Never fails the sign-up. */
  async function welcomeOwner(req: FastifyRequest, made: Awaited<ReturnType<typeof createBusiness>>, email: string) {
    const link = `${o.appUrl}/invite/${made.tenant.id}/${made.invite.token}`;
    if (!o.mailer) {
      req.log.warn({ tenantId: made.tenant.id }, "business created but mail isn't set up; send the owner invitation from Program admin");
      return false;
    }
    try {
      const pw = await o.identity?.passwordLink(email, link);
      await o.mailer.send({
        to: email,
        ...invitationEmail({ tenantName: made.tenant.name, inviterName: null, link, days: INVITATION_DAYS, passwordLink: pw && !pw.hasPassword ? pw.link : null }),
      });
      return true;
    } catch (err) {
      req.log.warn({ err }, "welcome email failed; resend the owner invitation from Program admin");
      return false;
    }
  }

  /** A plan as shown to people: prices, limits, and each feature with its name and what it does. */
  const describe = (p: Plan) => ({
    key: p.key, name: p.name, tagline: p.tagline, monthly: p.monthly, yearly: p.yearly, people: p.people, extraPerson: p.extraPerson, capabilities: p.capabilities,
    features: p.features.map((k) => {
      const m = o.modules.registry.get(k)?.manifest;
      return { key: k, name: m?.name ?? k, description: m?.description ?? "" };
    }),
  });
  const planList = () => PLANS.map(describe);

  app.get("/signup/config", { config: PUBLIC, schema: { tags: ["signup"] } }, async () =>
    ({ open: !!o.billing || o.testPayments, price: o.billing?.label ?? "", testMode: o.testPayments }));

  /** The plans for the public landing page. */
  app.get("/plans", { config: PUBLIC, schema: { tags: ["signup"] } }, async () => ({ testMode: o.testPayments, plans: planList() }));

  /**
   * Test sign-up: "buy" a plan without paying. The business is created on that plan straight away and its owner gets the
   * email to open the account, exactly as after a real payment. Only when TEST_PAYMENTS is on.
   */
  app.post("/signup/test-checkout", {
    config: { auth: "public", rateLimit: { max: 10, timeWindow: "15 minutes" } },
    schema: {
      tags: ["signup"],
      body: z.object({
        plan: z.enum(["starter", "business", "complete"]),
        interval: z.enum(["monthly", "yearly"]).default("monthly"),
        businessName: z.string().trim().min(1).max(200),
        slug: z.string().trim().toLowerCase().regex(SLUG, "Use 3-40 letters, numbers or dashes").optional(),
        email: z.email().max(320),
        region: z.enum(["eu", "us"]).default("eu"),
        acceptTerms: z.literal(true, { error: "Please accept the Terms and the Privacy Policy" }),
        businessUse: z.literal(true, { error: "Please confirm this is for business or professional use" }),
      }).strict(),
    },
  }, async (req, reply) => {
    if (!o.testPayments) throw new AppError(503, "signup_closed", "Sign-up isn't open yet.");
    const plan = planByKey(req.body.plan)!;
    const slug = req.body.slug ?? slugify(req.body.businessName);
    if (!SLUG.test(slug)) throw new AppError(400, "bad_slug", "Choose a web address of 3-40 letters, numbers or dashes.");
    const email = req.body.email.trim().toLowerCase();
    const made = await createBusiness(o.db, STRIPE_ACTOR, {
      name: req.body.businessName, slug, ownerEmail: email, region: req.body.region,
      plan: { key: plan.key, interval: req.body.interval, test: true, features: planModuleKeys(o.modules.registry, plan) },
    }, { requestId: req.id, ip: req.ip });
    const emailed = await welcomeOwner(req, made, email);
    return reply.status(201).send({ ok: true, emailed, plan: plan.key });
  });

  /** This business's plan, how many of its people are used, and the plans it could switch to. Any member may look. */
  app.get("/billing/plan", { config: { auth: "authenticated" }, schema: { tags: ["billing"], headers: z.object({ "x-tenant-id": z.uuid().optional() }).loose() } }, async (req) =>
    o.inTenant(req, null, async (tx, ctx) => {
      const cur = await tenantPlan(tx, ctx.tenantId);
      return {
        testMode: o.testPayments,
        current: {
          key: cur.key, interval: cur.interval, test: cur.test, changedAt: cur.changedAt, stripe: !!cur.stripe,
          people: await peopleCount(tx, ctx.tenantId), plan: cur.plan ? describe(cur.plan) : null,
        },
        plans: planList(),
      };
    }));

  /** Upgrade or downgrade (test payment: takes effect at once, nothing is charged). Owners and admins. */
  app.post("/billing/plan", {
    config: { auth: "authenticated" },
    schema: {
      tags: ["billing"], headers: z.object({ "x-tenant-id": z.uuid().optional() }).loose(),
      body: z.object({ plan: z.enum(["starter", "business", "complete"]), interval: z.enum(["monthly", "yearly"]).default("monthly") }).strict(),
    },
  }, async (req) => {
    if (!o.testPayments) throw new AppError(503, "billing_unavailable", "Changing plans online isn't available yet. Please contact us.");
    return o.inTenant(req, "core:tenant.manage", (tx, ctx) => changePlan(tx, ctx, o.modules, req.body));
  });

  app.post("/signup/checkout", {
    config: { auth: "public", rateLimit: { max: 10, timeWindow: "15 minutes" } },
    schema: {
      tags: ["signup"],
      body: z.object({
        businessName: z.string().trim().min(1).max(200),
        slug: z.string().trim().toLowerCase().regex(SLUG, "Use 3-40 letters, numbers or dashes").optional(),
        email: z.email().max(320),
        region: z.enum(["eu", "us"]).default("eu"),
        /** Must be ticked: "I agree to the Terms and the Privacy Policy". */
        acceptTerms: z.literal(true, { error: "Please accept the Terms and the Privacy Policy" }),
        /** Must be ticked: "I am signing up for business or professional use" (the Terms are for businesses only). */
        businessUse: z.literal(true, { error: "Please confirm this is for business or professional use" }),
      }).strict(),
    },
  }, async (req) => {
    if (!o.billing) throw new AppError(503, "signup_closed", "Sign-up isn't open yet.");
    const slug = req.body.slug ?? slugify(req.body.businessName);
    if (!SLUG.test(slug)) throw new AppError(400, "bad_slug", "Choose a web address of 3-40 letters, numbers or dashes.");
    // Checked before paying, so nobody pays for an address that is already taken.
    const [taken] = await o.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug));
    if (taken) throw new AppError(409, "slug_taken", "That web address is already taken. Choose another.");
    try {
      const url = await o.billing.createCheckout({
        email: req.body.email.trim().toLowerCase(), businessName: req.body.businessName, slug, region: req.body.region,
        successUrl: `${o.appUrl}/start/thanks`, cancelUrl: `${o.appUrl}/start`, termsVersion: TERMS_VERSION,
      });
      return { url };
    } catch (e) {
      req.log.error({ err: e }, "stripe checkout failed");
      throw new AppError(502, "payment_unavailable", "Payment couldn't be started. Please try again in a moment.");
    }
  });

  /** The business owner's "Manage subscription" button: Stripe's page to change the card, see invoices or cancel. */
  app.post("/billing/portal", { config: { auth: "authenticated" }, schema: { tags: ["billing"], headers: z.object({ "x-tenant-id": z.uuid().optional() }).loose() } }, async (req) => {
    if (!o.billing) throw new AppError(503, "billing_unavailable", "Billing isn't set up on this server.");
    const tenantId = await o.inTenant(req, "core:tenant.manage", async (_tx, ctx) => ctx.tenantId);
    const [t] = await o.db.select({ customer: tenants.stripeCustomerId, slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId));
    if (!t?.customer) throw new AppError(404, "no_subscription", "This business has no paid subscription to manage.");
    try {
      return { url: await o.billing.portalUrl(t.customer, `${o.appUrl}/t/${t.slug}/settings`) };
    } catch (e) {
      req.log.error({ err: e }, "stripe portal failed");
      throw new AppError(502, "payment_unavailable", "The billing page couldn't be opened. Please try again in a moment.");
    }
  });

  const contactLine = o.contactEmail ?? "the address on our website";

  /** Stripe's newer API versions moved the subscription id of an invoice under `parent`. */
  const invoiceSubscription = (inv: Record<string, unknown>) =>
    str(inv.subscription) ?? str(((inv.parent as { subscription_details?: { subscription?: unknown } } | undefined)?.subscription_details)?.subscription);

  const tenantBySubscription = async (subscriptionId: string | null) => {
    if (!subscriptionId) return null;
    const [t] = await o.db.select({
      id: tenants.id, name: tenants.name, slug: tenants.slug, status: tenants.status,
      billingPausedAt: tenants.billingPausedAt, subscriptionEndedAt: tenants.subscriptionEndedAt,
    }).from(tenants).where(and(eq(tenants.stripeSubscriptionId, subscriptionId), ne(tenants.status, "deleted")));
    return t ?? null;
  };

  /** Emails the business's owners (or the customer's billing email if nobody has accepted the invitation yet). Never fails the webhook. */
  async function notifyOwners(
    req: FastifyRequest, t: { id: string; name: string }, fallback: string | null,
    build: (tenantName: string) => { subject: string; text: string },
  ) {
    if (!o.mailer) { req.log.warn({ tenantId: t.id }, "billing email not sent: mail isn't set up"); return; }
    try {
      let to = await listOwnerEmails(o.db, t.id);
      if (!to.length && fallback) to = [fallback.trim().toLowerCase()];
      for (const addr of to) await o.mailer.send({ to: addr, ...build(t.name) });
    } catch (err) {
      req.log.warn({ err, tenantId: t.id }, "billing email failed");
    }
  }

  /** Switches a business that was paused for billing back on (never one the program owner paused by hand) and says so. */
  async function resume(req: FastifyRequest, t: NonNullable<Awaited<ReturnType<typeof tenantBySubscription>>>, fallback: string | null) {
    if (t.status !== "suspended" || (!t.billingPausedAt && !t.subscriptionEndedAt)) return { ignored: true };
    await setBusinessStatus(o.db, STRIPE_ACTOR, t.id, "active", { requestId: req.id, ip: req.ip });
    await notifyOwners(req, t, fallback, (name) => serviceResumedEmail({ tenantName: name, openUrl: `${o.appUrl}/t/${t.slug}`, contact: contactLine }));
    return { ok: true, resumed: true };
  }

  // The webhook needs the exact bytes Stripe signed, so this plugin keeps the body raw.
  await app.register(async (hook) => {
    hook.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: 262_144 }, (_req, body, done) => done(null, body));

    hook.post("/stripe/webhook", { config: PUBLIC }, async (req, reply) => {
      const raw = req.body as Buffer;
      if (!o.billing || !Buffer.isBuffer(raw) || !verifyStripeSignature(raw, req.headers["stripe-signature"] as string | undefined, o.billing.webhookSecret)) {
        throw new AppError(400, "bad_signature", "Signature check failed");
      }
      let ev: StripeEvent;
      try { ev = JSON.parse(raw.toString("utf8")) as StripeEvent; } catch { throw new AppError(400, "bad_json", "Not JSON"); }
      const obj = ev.data?.object ?? {};
      const meta = { requestId: req.id, ip: req.ip };

      if (ev.type === "checkout.session.completed") {
        const m = (obj.metadata ?? {}) as Record<string, string>;
        const subscriptionId = str(obj.subscription);
        const rawEmail = str(obj.customer_email) ?? str((obj.customer_details as { email?: unknown } | undefined)?.email);
        const email = rawEmail?.trim().toLowerCase() ?? null;
        if (obj.mode !== "subscription" || obj.payment_status === "unpaid" || !subscriptionId || !email || !m.businessName || !m.slug) {
          return reply.send({ ignored: true });
        }
        const [again] = await o.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.stripeSubscriptionId, subscriptionId));
        if (again) return reply.send({ ok: true, repeat: true });
        const input = {
          name: m.businessName, ownerEmail: email, region: m.region === "us" ? "us" as const : "eu" as const,
          stripe: { customerId: str(obj.customer), subscriptionId },
        };
        let made;
        try {
          made = await createBusiness(o.db, STRIPE_ACTOR, { ...input, slug: m.slug }, meta);
        } catch (e) {
          if (!(e instanceof AppError) || e.status !== 409) throw e;
          // Someone took the address while this person was paying: they've paid, so give them a close variant.
          const alt = `${m.slug.slice(0, 33)}-${randomBytes(3).toString("hex")}`;
          made = await createBusiness(o.db, STRIPE_ACTOR, { ...input, slug: alt }, meta);
        }
        await welcomeOwner(req, made, email);
        return reply.send({ ok: true });
      }

      // A payment failed: pause the business straight away and tell its owners how to pay.
      if (ev.type === "invoice.payment_failed") {
        const t = await tenantBySubscription(invoiceSubscription(obj));
        if (!t) return reply.send({ ignored: true });
        if (t.status !== "active") return reply.send({ ok: true, alreadyPaused: true });   // paused already (retries) or paused by hand
        await setBusinessStatus(o.db, STRIPE_ACTOR, t.id, "suspended", meta, { billingPaused: true });
        await notifyOwners(req, t, str(obj.customer_email), (name) => paymentFailedEmail({ tenantName: name, payUrl: str(obj.hosted_invoice_url), contact: contactLine }));
        return reply.send({ ok: true, paused: true });
      }

      // A payment went through: switch a business that was paused for billing back on, and say so.
      if (ev.type === "invoice.paid") {
        const t = await tenantBySubscription(invoiceSubscription(obj));
        if (!t) return reply.send({ ignored: true });
        return reply.send(await resume(req, t, str(obj.customer_email)));
      }

      if (ev.type === "customer.subscription.updated" || ev.type === "customer.subscription.deleted") {
        const id = str(obj.id);
        const status = ev.type === "customer.subscription.deleted" ? "canceled" : str(obj.status);
        // Only act when the payment status itself changed, so an unrelated update changes nothing.
        const changed = ev.type === "customer.subscription.deleted" || ev.data.previous_attributes?.status !== undefined;
        if (!id || !status || !changed) return reply.send({ ignored: true });
        const t = await tenantBySubscription(id);
        if (!t) return reply.send({ ignored: true });
        if (status === "active" || status === "trialing") return reply.send(await resume(req, t, null));
        // past_due: the failed-payment event above does the pausing (it carries the link to pay). The subscription
        // ending (cancelled, or unpaid after Stripe gave up) pauses it too and starts the 90-day countdown to erasure.
        if ((status === "canceled" || status === "unpaid" || status === "incomplete_expired") && t.status !== "deleted") {
          await setBusinessStatus(o.db, STRIPE_ACTOR, t.id, "suspended", meta, { subscriptionEnded: true });
          return reply.send({ ok: true, ended: true });
        }
        return reply.send({ ignored: true });
      }
      return reply.send({ ignored: true });
    });
  });
}
