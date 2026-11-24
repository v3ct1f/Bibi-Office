import { eq, sql } from "drizzle-orm";
import { AppError, platformContext, type PlatformActor, type RequestContext } from "@office/core";
import { tenants, withTenant, type Db, type Tx } from "@office/db";
import { enableModule, type ModuleDeps } from "@office/platform";
import type { WorkmailPayments } from "@office/module-workmail";
import type { Billing } from "./billing.ts";

/** Paid extras: a feature (module) that costs extra each month on the business's subscription. */
export const ADDON_KEYS = ["workmail"] as const;
export type AddonKey = (typeof ADDON_KEYS)[number];
export const isAddon = (k: string): k is AddonKey => (ADDON_KEYS as readonly string[]).includes(k);

/**
 * Turning on a paid extra needs it on the subscription first. A business whose subscription isn't paid through Stripe
 * (the program owner set it up) pays nothing extra here, and neither does a server without Stripe.
 */
export const needsPayment = (billing: Billing | null, t: { stripeSubscriptionId: string | null }) => !!billing?.workmailLabel && !!t.stripeSubscriptionId;

/** Used by the "Add features" route: refuses to switch a paid extra on without going through its payment step. */
export function enableGuard(db: Db, billing: Billing | null) {
  return async (tx: Tx, ctx: RequestContext, key: string) => {
    if (!isAddon(key) || !billing?.workmailLabel) return;
    const [t] = await tx.select({ addons: tenants.addons, sub: tenants.stripeSubscriptionId }).from(tenants).where(eq(tenants.id, ctx.tenantId));
    if (t?.sub && !t.addons.includes(key)) {
      throw new AppError(402, "addon_required", `Work email is a paid extra (${billing.workmailLabel}). Turn it on from Add features, where you can see the price first.`);
    }
  };
}

/** Records the add-on on the business and turns the feature on. */
export async function activateAddon(db: Db, modules: ModuleDeps, actor: PlatformActor, tenantId: string, key: AddonKey, meta: { requestId: string; ip: string }) {
  await withTenant(db, tenantId, async (tx) => {
    await tx.update(tenants).set({ addons: sqlAppend(key) }).where(eq(tenants.id, tenantId));
    await enableModule(tx, platformContext(tenantId, actor, meta), modules, key);
  });
}

const sqlAppend = (key: string) => sql`case when ${key} = any(${tenants.addons}) then ${tenants.addons} else array_append(${tenants.addons}, ${key}) end`;
export const sqlRemove = (key: string) => sql`array_remove(${tenants.addons}, ${key})`;

/** Payments for domains, on top of Stripe. Without Stripe (local use) every domain is "paid" at once. */
export function workmailPayments(db: Db, billing: Billing | null, appUrl: string): WorkmailPayments {
  return {
    async chargeDomain(i) {
      if (!billing) return { status: "paid" };
      const [t] = await db.select({ customer: tenants.stripeCustomerId }).from(tenants).where(eq(tenants.id, i.tenantId));
      const back = `${appUrl}${i.returnPath}`;
      const p = await billing.createPayment({
        customerId: t?.customer ?? null, amountCents: i.amountCents, currency: i.currency, description: i.description,
        successUrl: back, cancelUrl: `${appUrl}${i.returnPath.split("?")[0]}`,
        metadata: { kind: "workmail_domain", tenantId: i.tenantId, orderId: i.orderId, domain: i.domain },
      });
      return { status: "redirect", url: p.url, ref: p.id };
    },
    isPaid: async (ref) => (billing ? billing.paymentPaid(ref) : true),
  };
}
