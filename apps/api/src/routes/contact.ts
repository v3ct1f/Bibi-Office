import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { AppError } from "@office/core";
import type { Mailer } from "../mail.ts";

/**
 * Public contact form (the second way to reach the operator, besides the email address, that Spanish law asks
 * for). The message is emailed to CONTACT_EMAIL with the sender as reply-to. A hidden field catches simple bots.
 */
export async function registerContactRoutes(app0: FastifyInstance, o: { mailer: Mailer | null; contactEmail: string | undefined }) {
  const app = app0.withTypeProvider<ZodTypeProvider>();
  const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

  app.get("/contact/config", { config: { auth: "public" }, schema: { tags: ["contact"] } }, async () => ({ open: !!(o.mailer && o.contactEmail) }));

  app.post("/contact", {
    config: { auth: "public", rateLimit: { max: 5, timeWindow: "15 minutes" } },
    schema: {
      tags: ["contact"],
      body: z.object({
        name: z.string().trim().min(1).max(200),
        email: z.email().max(320),
        message: z.string().trim().min(5).max(5000),
        /** Hidden in the page; people leave it empty, bots fill it in. */
        website: z.string().max(500).optional(),
      }).strict(),
    },
  }, async (req, reply) => {
    if (req.body.website) return reply.status(202).send({ ok: true }); // pretend it worked
    if (!o.mailer || !o.contactEmail) throw new AppError(503, "contact_unavailable", "The contact form isn't available right now. Please email us instead.");
    try {
      await o.mailer.send({
        to: o.contactEmail, replyTo: req.body.email.trim().toLowerCase(),
        subject: `Contact form: ${oneLine(req.body.name).slice(0, 80)}`,
        text: [`From: ${oneLine(req.body.name)} <${req.body.email.trim().toLowerCase()}>`, "", req.body.message].join("\n"),
      });
    } catch (e) {
      req.log.error({ err: e }, "contact form email failed");
      throw new AppError(502, "contact_unavailable", "Your message couldn't be sent. Please email us instead.");
    }
    return reply.status(202).send({ ok: true });
  });
}
