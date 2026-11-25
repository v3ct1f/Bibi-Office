import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { audit, CURRENCY_CODES, forbidden, isCurrency, type RatesProvider, type RequestContext } from "@office/core";
import { tenants, users, type Db, type Tx } from "@office/db";

const AUTH = { auth: "authenticated" } as const;
const tenantHeader = z.object({ "x-tenant-id": z.uuid().optional() }).loose();
const Currency = z.string().refine((c) => isCurrency(c), "Unknown currency");
/** A language tag like "es" or "pt-BR". Which languages the app has is up to the web app; the server just keeps the choice. */
const Locale = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/);

/**
 * Language and currency choices.
 *  - GET /rates (public): exchange rates for showing prices in other currencies. Approximate; nothing is billed in them.
 *  - PATCH /me/preferences: the signed-in person's own language and currency.
 *  - PATCH /tenant/display-currency: the business's display currency (a business setting; never changes stored amounts).
 */
export async function registerPreferenceRoutes(
  app0: FastifyInstance,
  o: { db: Db; rates: RatesProvider; inTenant: <T>(req: FastifyRequest, perm: string | null, fn: (tx: Tx, ctx: RequestContext) => Promise<T>) => Promise<T> },
) {
  const app = app0.withTypeProvider<ZodTypeProvider>();

  app.get("/rates", { config: { auth: "public", rateLimit: { max: 120, timeWindow: "1 minute" } }, schema: { tags: ["currency"] } }, async (_req, reply) => {
    const s = await o.rates.snapshot();
    reply.header("cache-control", "public, max-age=300");
    return { ...s, currencies: CURRENCY_CODES };
  });

  app.patch("/me/preferences", {
    config: AUTH,
    schema: { tags: ["me"], body: z.object({ locale: Locale.nullable().optional(), currency: Currency.nullable().optional() }).strict() },
  }, async (req) => {
    const p = req.principal!;
    if (p.kind !== "user") throw forbidden("Only people have language and currency choices");
    const set: Partial<typeof users.$inferInsert> = {};
    if (req.body.locale !== undefined) set.uiLocale = req.body.locale;
    if (req.body.currency !== undefined) set.uiCurrency = req.body.currency;
    if (Object.keys(set).length) await o.db.update(users).set(set).where(eq(users.id, p.userId));
    const [u] = await o.db.select({ locale: users.uiLocale, currency: users.uiCurrency }).from(users).where(eq(users.id, p.userId));
    return u ?? { locale: null, currency: null };
  });

  app.patch("/tenant/display-currency", {
    config: AUTH, schema: { tags: ["tenants"], headers: tenantHeader, body: z.object({ currency: Currency.nullable() }).strict() },
  }, (req) => o.inTenant(req, "core:tenant.manage", async (tx, ctx) => {
    await tx.update(tenants).set({ displayCurrency: req.body.currency }).where(eq(tenants.id, ctx.tenantId));
    await audit(tx, ctx, "tenant.display_currency_changed", { type: "tenant", id: ctx.tenantId }, { currency: req.body.currency });
    return { displayCurrency: req.body.currency };
  }));
}
