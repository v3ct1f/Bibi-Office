import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { eq, ne, and } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import {
  AppError, PLANS, REGION_KEYS, createBusinessFromSignup, listOwnerEmails, peopleCount, planByKey, recordDemoSignup, recordPaidSignup,
  setBusinessStatus, setOwnerSignupEnded, tenantPlan, type Plan, type RequestContext,
} from "@office/core";
import { changePlan, planModuleKeys, type ModuleDeps } from "@office/platform";
import { tenants, type Db, type Tx } from "@office/db";
import { paymentFailedEmail, serviceResumedEmail, type Mailer } from "../mail.ts";
import { sendOwnerSignupEmail } from "../owner-signup-mail.ts";
import type { Identity } from "../identity.ts";
import { verifyStripeSignature, type Billing } from "../billing.ts";

const PUBLIC = { auth: "public" } as const;
/** Date of the Terms and Privacy Policy text a customer agrees to; bump it (here and in apps/web/src/legal/company.ts) when they change. */
export const TERMS_VERSION = "2026-11-24.1";
const STRIPE_ACTOR = { userId: null, email: "stripe" } as const;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

interface StripeEvent { id: string; type: string; data: { object: Record<string, unknown>; previous_attributes?: Record<string, unknown> } }
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/**
 * Paid sign-up. A visitor gives their email on a public page and pays a monthly subscription on Stripe's own page;
 * Stripe tells us (a signed webhook). We then email them a link to create their sign-in account. Once signed in
 * with that address they create their business themselves (name, web address, region) and are its owner.
 * A cancelled or unpaid subscription pauses the business; paying again reactivates it.
 */
export async function registerBillingRoutes(
  app0: FastifyInstance,
  o: {
    db: Db; appUrl: string; mailer: Mailer | null; identity: Identity | null; billing: Billing | null; contactEmail: string | undefined;
    /** Demo payments: a plan can be "bought" on a pretend checkout page. Never on with real Stripe keys or in production (app.ts). */
    testPayments: boolean; modules: ModuleDeps;
    inTenant: <T>(req: FastifyRequest, perm: string | null, fn: (tx: Tx, ctx: RequestContext) => Promise<T>) => Promise<T>;
  },
) {
  const app = app0.withTypeProvider<ZodTypeProvider>();
  const contactLine = o.contactEmail ?? "the address on our website";

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
   * Demo payments (local development and try-outs, never in production or with real Stripe keys: see app.ts).
   * "Continue to payment" opens our own pretend checkout page instead of Stripe's. Paying there does what a real
   * Stripe payment does: the sign-up is recorded (with the chosen plan) and the "create your account" email goes out.
   * Pending demo checkouts live in memory for an hour; nothing is charged and no card is asked for.
   */
  const demoCheckouts = new Map<string, { email: string; plan: Plan; interval: "monthly" | "yearly"; createdAt: number }>();
  const DEMO_TTL = 60 * 60_000;
  const demoCheckout = (id: string) => {
    const d = demoCheckouts.get(id);
    if (!o.testPayments || !d || Date.now() - d.createdAt > DEMO_TTL) {
      throw new AppError(404, "demo_checkout_gone", "This demo payment has expired or was already used. Start again from the plans page.");
    }
    return d;
  };

  app.get("/signup/demo/:id", { config: PUBLIC, schema: { tags: ["signup"], params: z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) }) } }, async (req) => {
    const d = demoCheckout(req.params.id);
    return { email: d.email, interval: d.interval, plan: describe(d.plan) };
  });

  app.post("/signup/demo/:id/pay", {
    config: { auth: "public", rateLimit: { max: 10, timeWindow: "15 minutes" } },
    schema: { tags: ["signup"], params: z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) }) },
  }, async (req) => {
    const d = demoCheckout(req.params.id);
    demoCheckouts.delete(req.params.id);   // one payment per checkout, like Stripe
    const signup = await recordDemoSignup(o.db, { email: d.email, plan: d.plan.key, interval: d.interval, termsVersion: TERMS_VERSION });
    const sent = await sendOwnerSignupEmail({ db: o.db, appUrl: o.appUrl, mailer: o.mailer, identity: o.identity, contact: contactLine, log: req.log }, signup);
    if (!sent.emailed) req.log.info({ email: d.email, link: sent.link }, "demo payment: create-your-account email not sent (mail isn't set up); open this link and sign in with that email");
    return { ok: true, emailed: sent.emailed, plan: d.plan.key };
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
        email: z.email().max(320),
        /** The plan chosen on /plans (used by demo payments; the real Stripe checkout still has its single price). */
        plan: z.enum(["starter", "business", "complete"]).optional(),
        interval: z.enum(["monthly", "yearly"]).default("monthly"),
        /** Must be ticked: "I agree to the Terms and the Privacy Policy". */
        acceptTerms: z.literal(true, { error: "Please accept the Terms and the Privacy Policy" }),
        /** Must be ticked: "I am signing up for business or professional use" (the Terms are for businesses only). */
        businessUse: z.literal(true, { error: "Please confirm this is for business or professional use" }),
      }).strict(),
    },
  }, async (req) => {
    const email = req.body.email.trim().toLowerCase();
    if (!o.billing && o.testPayments) {
      const plan = planByKey(req.body.plan);
      if (!plan) throw new AppError(400, "choose_plan", "Choose a plan first.");
      for (const [k, v] of demoCheckouts) if (Date.now() - v.createdAt > DEMO_TTL) demoCheckouts.delete(k);
      if (demoCheckouts.size > 1000) throw new AppError(503, "busy", "Too many demo payments open. Try again in a moment.");
      const id = randomBytes(18).toString("base64url");
      demoCheckouts.set(id, { email, plan, interval: req.body.interval, createdAt: Date.now() });
      return { url: `${o.appUrl}/start/demo-pay/${id}`, demo: true };
    }
    if (!o.billing) throw new AppError(503, "signup_closed", "Sign-up isn't open yet.");
    try {
      const url = await o.billing.createCheckout({
        email,
        successUrl: `${o.appUrl}/start/thanks`, cancelUrl: `${o.appUrl}/start`, termsVersion: TERMS_VERSION,
      });
      return { url };
    } catch (e) {
      req.log.error({ err: e }, "stripe checkout failed");
      throw new AppError(502, "payment_unavailable", "Payment couldn't be started. Please try again in a moment.");
    }
  });

  /**
   * The signed-in owner creates the business they paid for (or were invited to set up): name, web address and
   * region. They become its owner straight away. Needs a verified email that has an open sign-up.
   */
  app.post("/signup/business", {
    config: { auth: "authenticated", rateLimit: { max: 20, timeWindow: "15 minutes" } },
    schema: {
      tags: ["signup"],
      body: z.object({
        name: z.string().trim().min(1).max(200),
        slug: z.string().trim().toLowerCase().regex(SLUG, "Use 3-40 lowercase letters, numbers or dashes"),
        region: z.enum(REGION_KEYS),
      }).strict(),
    },
  }, async (req, reply) => {
    const p = req.principal!;
    if (p.kind !== "user" || !p.emailVerified) throw new AppError(403, "no_signup", "Sign in with the email address you paid with.");
    const t = await createBusinessFromSignup(o.db, { userId: p.userId, email: p.email }, req.body, { requestId: req.id, ip: req.ip, userAgent: req.headers["user-agent"] },
      (key) => { const plan = planByKey(key); return plan ? planModuleKeys(o.modules.registry, plan) : null; });
    return reply.status(201).send({ id: t.id, slug: t.slug, name: t.name, region: t.region, plan: t.plan });
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
        if (obj.mode !== "subscription" || obj.payment_status === "unpaid" || !subscriptionId || !email) {
          return reply.send({ ignored: true });
        }
        // Paid: remember it and email the "create your account" link. The owner creates the business after signing in.
        const signup = await recordPaidSignup(o.db, { email, customerId: str(obj.customer), subscriptionId, termsVersion: str(m.termsVersion) });
        if (!signup) return reply.send({ ok: true, repeat: true });   // Stripe sent the same checkout again
        await sendOwnerSignupEmail({ db: o.db, appUrl: o.appUrl, mailer: o.mailer, identity: o.identity, contact: contactLine, log: req.log }, signup);
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
        if (!t) {
          // Paid but the business isn't created yet: an ended subscription can't be used to create one.
          const ended = status === "canceled" || status === "unpaid" || status === "incomplete_expired";
          const back = status === "active" || status === "trialing";
          if ((ended || back) && await setOwnerSignupEnded(o.db, id, ended)) return reply.send({ ok: true, signupEnded: ended });
          return reply.send({ ignored: true });
        }
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
