import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { AppError, forbidden, getTenant, type RequestContext } from "@office/core";
import { users, type Db, type Tx } from "@office/db";
import type { Mailer } from "../mail.ts";

/**
 * "Contact support": only the business owner and people the owner has given an admin role (anyone who may manage
 * members) can write to the operator. Everyone else asks their own business owner, so the operator isn't flooded
 * by every worker of every business. The message is emailed to CONTACT_EMAIL with the sender as reply-to, and says
 * which business it is from.
 */
export const SUPPORT_PERMISSION = "core:members.manage";

export async function registerContactRoutes(
  app0: FastifyInstance,
  o: {
    db: Db; mailer: Mailer | null; contactEmail: string | undefined;
    inTenant: <T>(req: FastifyRequest, perm: string | null, fn: (tx: Tx, ctx: RequestContext) => Promise<T>) => Promise<T>;
  },
) {
  const app = app0.withTypeProvider<ZodTypeProvider>();
  const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
  const tenantHeader = z.object({ "x-tenant-id": z.uuid().optional() }).loose();

  app.get("/contact/config", { config: { auth: "public" }, schema: { tags: ["contact"] } }, async () => ({ open: !!(o.mailer && o.contactEmail) }));

  app.post("/contact", {
    config: { auth: "authenticated", rateLimit: { max: 5, timeWindow: "15 minutes" } },
    schema: {
      tags: ["contact"], headers: tenantHeader,
      body: z.object({ subject: z.string().trim().max(150).optional(), message: z.string().trim().min(5).max(5000) }).strict(),
    },
  }, async (req, reply) => {
    const p = req.principal;
    if (p?.kind !== "user") throw forbidden("Only people can contact support");
    let ctx: RequestContext;
    try {
      ctx = await o.inTenant(req, SUPPORT_PERMISSION, async (_tx, c) => c);
    } catch (e) {
      if (e instanceof AppError && e.status === 403) throw forbidden("Only the business owner and admins can contact support. Please ask your business owner.");
      throw e;
    }
    if (!o.mailer || !o.contactEmail) throw new AppError(503, "contact_unavailable", "Contact support isn't available right now. Please email us instead.");
    const [me] = await o.db.select({ name: users.name }).from(users).where(eq(users.id, ctx.actor.userId!));
    const biz = await getTenant(o.db, ctx.tenantId);
    const name = oneLine(me?.name || p.email);
    try {
      await o.mailer.send({
        to: o.contactEmail, replyTo: p.email.toLowerCase(),
        subject: `Support: ${oneLine(req.body.subject || "").slice(0, 100) || "question"} (${oneLine(biz?.name ?? "").slice(0, 60)})`,
        text: [
          `From: ${name} <${p.email.toLowerCase()}>`,
          `Business: ${biz?.name ?? "?"} (${biz?.slug ?? "?"}, ${ctx.tenantId})`,
          "", req.body.message,
        ].join("\n"),
      });
    } catch (e) {
      req.log.error({ err: e }, "support email failed");
      throw new AppError(502, "contact_unavailable", "Your message couldn't be sent. Please email us instead.");
    }
    return reply.status(202).send({ ok: true });
  });
}
