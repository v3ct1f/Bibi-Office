import nodemailer from "nodemailer";

/** Platform email (invitations). Configured by the operator, not by tenants. */
export interface Mailer { send(m: { to: string; subject: string; text: string }): Promise<void> }

/** Builds a mailer from MAIL_SMTP_URL (smtp:// or smtps://user:pass@host:port) and MAIL_FROM; null when not set up. */
export function smtpMailer(url: string | undefined, from: string | undefined): Mailer | null {
  if (!url || !from) return null;
  const transport = nodemailer.createTransport(url, { from });
  return {
    async send(m) {
      await transport.sendMail({ from, to: m.to, subject: m.subject, text: m.text, headers: { "Auto-Submitted": "auto-generated" } });
    },
  };
}

export function invitationEmail(o: { tenantName: string; inviterName: string | null; link: string; days: number }) {
  const who = o.inviterName ? `${o.inviterName} has invited you` : "You have been invited";
  return {
    subject: `Join ${o.tenantName}`,
    text: [
      `${who} to join ${o.tenantName}.`,
      "",
      `Accept the invitation: ${o.link}`,
      "",
      `Sign in with this email address to accept. The link works for ${o.days} days.`,
      "If you weren't expecting this, you can ignore this email.",
    ].join("\n"),
  };
}
