import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { eq, ne, and } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { AppError, INVITATION_DAYS, createBusiness, setBusinessStatus, type RequestContext } from "@office/core";
import { tenants, type Db, type Tx } from "@office/db";
import { invitationEmail, type Mailer } from "../mail.ts";
import type { Identity } from "../identity.ts";
import { verifyStripeSignature, type Billing } from "../billing.ts";

const PUBLIC = { auth: "public" } as const;
/** Date of the Terms and Privacy Policy text a customer agrees to; bump it (here and in apps/web/src/legal/company.ts) when they change. */
export const TERMS_VERSION = "2026-11-23";
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
    db: Db; appUrl: string; mailer: Mailer | null; identity: Identity | null; billing: Billing | null;
    inTenant: <T>(req: FastifyRequest, perm: string | null, fn: (tx: Tx, ctx: RequestContext) => Promise<T>) => Promise<T>;
  },
) {
  const app = app0.withTypeProvider<ZodTypeProvider>();

  app.get("/signup/config", { config: PUBLIC, schema: { tags: ["signup"] } }, async () =>
    ({ open: !!o.billing, price: o.billing?.label ?? "" }));

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
        const link = `${o.appUrl}/invite/${made.tenant.id}/${made.invite.token}`;
        if (o.mailer) {
          try {
            const pw = await o.identity?.passwordLink(email, link);
            await o.mailer.send({
              to: email,
              ...invitationEmail({ tenantName: made.tenant.name, inviterName: null, link, days: INVITATION_DAYS, passwordLink: pw && !pw.hasPassword ? pw.link : null }),
            });
          } catch (err) {
            req.log.warn({ err }, "welcome email failed; resend the owner invitation from Program admin");
          }
        } else {
          req.log.warn({ tenantId: made.tenant.id }, "paid business created but mail isn't set up; send the owner invitation from Program admin");
        }
        return reply.send({ ok: true });
      }

      if (ev.type === "customer.subscription.updated" || ev.type === "customer.subscription.deleted") {
        const id = str(obj.id);
        const status = ev.type === "customer.subscription.deleted" ? "canceled" : str(obj.status);
        // Only act when the payment status itself changed, so a manual pause by the program owner isn't undone by an unrelated update.
        const changed = ev.type === "customer.subscription.deleted" || ev.data.previous_attributes?.status !== undefined;
        if (!id || !status || !changed) return reply.send({ ignored: true });
        const [t] = await o.db.select({ id: tenants.id, status: tenants.status }).from(tenants)
          .where(and(eq(tenants.stripeSubscriptionId, id), ne(tenants.status, "deleted")));
        if (!t) return reply.send({ ignored: true });
        // past_due keeps working while Stripe retries the card; the rest of the "not paying" states pause it.
        const want = status === "active" || status === "trialing" || status === "past_due" ? "active"
          : status === "canceled" || status === "unpaid" || status === "incomplete_expired" ? "suspended" : t.status;
        if (want !== t.status) await setBusinessStatus(o.db, STRIPE_ACTOR, t.id, want as "active" | "suspended", meta);
        return reply.send({ ok: true });
      }
      return reply.send({ ignored: true });
    });
  });
}
