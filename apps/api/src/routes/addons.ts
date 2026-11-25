import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { AppError, WORK_EMAIL, type RequestContext } from "@office/core";
import { tenants, type Db, type Tx } from "@office/db";
import { disableModule, enableModule, enabledModuleKeys, type ModuleDeps } from "@office/platform";
import { getProvider } from "@office/module-workmail";
import { needsPayment, sqlAddAddon, sqlAllow, sqlRemove, workmailCharging } from "../addons.ts";
import type { Billing } from "../billing.ts";

const AUTH = { auth: "authenticated" } as const;
const tenantHeader = z.object({ "x-tenant-id": z.uuid().optional() }).loose();

/**
 * Paid extras on the business's subscription. For now one: Work email.
 * Turning it on adds its price to the Stripe subscription, records it, and switches the feature on; turning it off does the reverse.
 */
export async function registerAddonRoutes(
  app0: FastifyInstance,
  o: { db: Db; billing: Billing | null; testPayments: boolean; modules: ModuleDeps; inTenant: <T>(req: FastifyRequest, perm: string | null, fn: (tx: Tx, ctx: RequestContext) => Promise<T>) => Promise<T> },
) {
  const app = app0.withTypeProvider<ZodTypeProvider>();
  const load = async (tenantId: string) => {
    const [t] = await o.db.select({ addons: tenants.addons, sub: tenants.stripeSubscriptionId }).from(tenants).where(eq(tenants.id, tenantId));
    return t ?? { addons: [] as string[], sub: null };
  };
  const hasModule = !!o.modules.registry.get("workmail");

  app.get("/billing/addons", { config: AUTH, schema: { tags: ["billing"], headers: tenantHeader } }, (req) =>
    o.inTenant(req, "core:modules.read", async (tx, ctx) => {
      const t = await load(ctx.tenantId);
      const enabled = (await enabledModuleKeys(tx)).has("workmail");
      return {
        workmail: {
          /** Can this business turn it on? (The feature exists and the server has an email provider.) */
          available: hasModule && !!getProvider(),
          /** What each work mailbox costs per month (core/plans.ts WORK_EMAIL) and how this business pays it (stripe | demo | free). */
          mailbox: await workmailCharging(o.db, o.billing, o.testPayments, ctx.tenantId),
          /** Turning it on costs nothing by itself; each mailbox is billed. Kept for older pages: "€3 per mailbox per month" when charged, else null. */
          price: needsPayment(o.billing, { stripeSubscriptionId: t.sub }) ? `€${WORK_EMAIL.mailboxPerMonth} per mailbox per month` : null,
          active: t.addons.includes("workmail"), enabled,
        },
      };
    }));

  app.post("/billing/addons/workmail", { config: AUTH, schema: { tags: ["billing"], headers: tenantHeader } }, async (req) => {
    if (!hasModule || !getProvider()) throw new AppError(503, "workmail_unavailable", "Work email isn't set up on this server yet.");
    const tenantId = await o.inTenant(req, "core:modules.manage", async (_tx, ctx) => ctx.tenantId);
    const t = await load(tenantId);
    const charge = needsPayment(o.billing, { stripeSubscriptionId: t.sub });
    if (charge && !t.addons.includes("workmail")) {
      try { await o.billing!.addAddOn(t.sub!, "workmail"); }
      catch (e) {
        req.log.error({ err: e }, "stripe add-on failed");
        throw new AppError(502, "payment_unavailable", "The extra couldn't be added to your subscription. Check your card under Manage subscription, then try again.");
      }
    }
    await o.inTenant(req, "core:modules.manage", async (tx, ctx) => {
      await tx.update(tenants).set({ addons: sqlAddAddon("workmail"), allowedModules: sqlAllow("workmail") }).where(eq(tenants.id, ctx.tenantId));
      await enableModule(tx, ctx, o.modules, "workmail");
    });
    return { ok: true, charged: charge };
  });

  app.delete("/billing/addons/workmail", { config: AUTH, schema: { tags: ["billing"], headers: tenantHeader } }, async (req) => {
    const tenantId = await o.inTenant(req, "core:modules.manage", async (_tx, ctx) => ctx.tenantId);
    const t = await load(tenantId);
    if (needsPayment(o.billing, { stripeSubscriptionId: t.sub }) && t.addons.includes("workmail")) {
      try { await o.billing!.removeAddOn(t.sub!, "workmail"); }
      catch (e) {
        req.log.error({ err: e }, "stripe add-on removal failed");
        throw new AppError(502, "payment_unavailable", "The extra couldn't be taken off your subscription just now. Please try again in a moment.");
      }
    }
    await o.inTenant(req, "core:modules.manage", async (tx, ctx) => {
      await tx.update(tenants).set({ addons: sqlRemove("workmail") }).where(eq(tenants.id, ctx.tenantId));
      await disableModule(tx, ctx, o.modules, "workmail");
    });
    return { ok: true };
  });
}
