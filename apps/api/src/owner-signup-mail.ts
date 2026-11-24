import type { FastifyBaseLogger } from "fastify";
import type { Db } from "@office/db";
import { ownerSignupEmail, type Mailer } from "./mail.ts";
import type { Identity } from "./identity.ts";

/**
 * Emails someone who may set up a business (paid, or invited by the program owner): a one-time link to create
 * their sign-in account (choose a password), then the page where they create their business.
 * Returns the page link (for the program owner to copy) and whether the email went out. Never throws.
 */
export async function sendOwnerSignupEmail(
  o: { db: Db; appUrl: string; mailer: Mailer | null; identity: Identity | null; contact: string; log: FastifyBaseLogger },
  signup: { email: string; source: "stripe" | "program_owner" },
): Promise<{ link: string; emailed: boolean; emailError: string | null }> {
  const link = `${o.appUrl}/new-business`;
  if (!o.mailer) {
    o.log.warn("owner sign-up email not sent: mail isn't set up; send the link from Program admin");
    return { link, emailed: false, emailError: null };
  }
  try {
    const pw = await o.identity?.passwordLink(signup.email, link);
    await o.mailer.send({
      to: signup.email,
      ...ownerSignupEmail({ paid: signup.source === "stripe", link, passwordLink: pw && !pw.hasPassword ? pw.link : null, contact: o.contact }),
    });
    return { link, emailed: true, emailError: null };
  } catch (err) {
    o.log.warn({ err }, "owner sign-up email failed; resend it from Program admin");
    return { link, emailed: false, emailError: "The email could not be sent. Copy the link and send it yourself." };
  }
}
