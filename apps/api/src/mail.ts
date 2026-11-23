import nodemailer from "nodemailer";

/** Platform email (invitations). Configured by the operator, not by tenants. */
export interface Mailer { send(m: { to: string; subject: string; text: string; replyTo?: string }): Promise<void> }

/** Builds a mailer from MAIL_SMTP_URL (smtp:// or smtps://user:pass@host:port) and MAIL_FROM; null when not set up. */
export function smtpMailer(url: string | undefined, from: string | undefined): Mailer | null {
  if (!url || !from) return null;
  // A URL never contains spaces; people often paste app passwords as Google shows them ("abcd efgh ...").
  const transport = nodemailer.createTransport(url.replace(/\s+/g, ""), { from });
  return {
    async send(m) {
      await transport.sendMail({ from, to: m.to, subject: m.subject, text: m.text, ...(m.replyTo ? { replyTo: m.replyTo } : {}), headers: { "Auto-Submitted": "auto-generated" } });
    },
  };
}

/** The "set your password" step, for people who don't have a password yet. */
const passwordStep = (passwordLink: string | null | undefined, then: string) => passwordLink
  ? [`First, set your password (the link works once, for 7 days): ${passwordLink}`, "", `Then ${then}`]
  : [then.charAt(0).toUpperCase() + then.slice(1)];

export function invitationEmail(o: { tenantName: string; inviterName: string | null; link: string; days: number; passwordLink?: string | null }) {
  const who = o.inviterName ? `${o.inviterName} has invited you` : "You have been invited";
  return {
    subject: `Join ${o.tenantName}`,
    text: [
      `${who} to join ${o.tenantName}.`,
      "",
      ...passwordStep(o.passwordLink, `accept the invitation: ${o.link}`),
      "",
      `Sign in with this email address to accept. The invitation works for ${o.days} days.`,
      "If you weren't expecting this, you can ignore this email.",
    ].join("\n"),
  };
}

export function ownerAddedEmail(o: { by: string; adminUrl: string; passwordLink?: string | null }) {
  return {
    subject: "You're now an owner of Office",
    text: [
      `${o.by} made you a program owner of Office.`,
      "",
      ...passwordStep(o.passwordLink, `sign in with this email address and open Program admin: ${o.adminUrl}`),
      "",
      "Program owners create and pause businesses and choose their features. They can't see inside a business.",
      "If you weren't expecting this, tell the person who added you.",
    ].join("\n"),
  };
}

export function ownershipTransferredEmail(o: { by: string; adminUrl: string; passwordLink?: string | null }) {
  return {
    subject: "You're now the owner of Office",
    text: [
      `${o.by} transferred ownership of Office to you. You're now its program owner.`,
      "",
      ...passwordStep(o.passwordLink, `sign in with this email address and open Program admin: ${o.adminUrl}`),
      "",
      "From Program admin you create and pause businesses, choose their features, and add co-owners.",
    ].join("\n"),
  };
}

export function passwordResetEmail(o: { link: string; hasPassword: boolean }) {
  return {
    subject: o.hasPassword ? "Reset your Office password" : "Set your Office password",
    text: [
      o.hasPassword ? "Someone asked to reset the password for this email address." : "Someone asked to set a password for this email address.",
      "",
      `${o.hasPassword ? "Choose a new password" : "Set your password"}: ${o.link}`,
      "",
      "The link works once, for 7 days. If this wasn't you, ignore this email; nothing changes.",
    ].join("\n"),
  };
}
