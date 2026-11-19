/**
 * Real SMTP + IMAP servers in memory, for tests: what the app sends over SMTP is captured in `sent`,
 * and `deliver()` drops a raw email into the IMAP inbox the app reads from.
 */
// @ts-expect-error hoodiecrow-imap ships no types
import hoodiecrow from "hoodiecrow-imap";
import { SMTPServer } from "smtp-server";
import { simpleParser, type ParsedMail } from "mailparser";
import type { AddressInfo } from "node:net";

export interface Captured { to: string[]; mail: ParsedMail }

export async function startMailServers(o: { user?: string; pass?: string; imapPort?: number; smtpPort?: number } = {}) {
  const user = o.user ?? "help@shop.test", pass = o.pass ?? "mail-secret";
  const imap = hoodiecrow({
    plugins: ["ID", "UIDPLUS", "ENABLE", "SPECIAL-USE", "LITERALPLUS"],
    users: { [user]: { password: pass } },
    storage: { INBOX: { messages: [] }, "": { separator: "/", folders: {} } },
  });
  await new Promise<void>((r) => imap.listen(o.imapPort ?? 0, "127.0.0.1", r));
  const sent: Captured[] = [];
  const smtp = new SMTPServer({
    secure: false, disabledCommands: ["STARTTLS"], allowInsecureAuth: true, logger: false, banner: "test",
    onAuth(auth, _s, cb) { if (auth.username === user && auth.password === pass) cb(null, { user }); else cb(new Error("Invalid login")); },
    onData(stream, session, cb) {
      simpleParser(stream).then((mail) => { sent.push({ to: session.envelope.rcptTo.map((r) => r.address), mail }); cb(); }).catch(cb);
    },
  });
  await new Promise<void>((r) => smtp.listen(o.smtpPort ?? 0, "127.0.0.1", r));
  const imapPort = (imap.address() as AddressInfo).port;
  const smtpPort = (smtp.server.address() as AddressInfo).port;

  return {
    user, pass, imapPort, smtpPort, sent,
    /** The module settings that point at these servers. */
    settings: {
      address: user, fromName: "Shop Support", imapHost: "127.0.0.1", imapPort, imapSecurity: "none", imapUser: user, imapPassword: pass,
      smtpHost: "127.0.0.1", smtpPort, smtpSecurity: "none", smtpUser: user, smtpPassword: pass, folder: "INBOX",
    },
    deliver(raw: string) { imap.appendMessage("INBOX", [], new Date(), raw); },
    async waitForSent(n: number, ms = 5000) {
      const end = Date.now() + ms;
      while (sent.length < n && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
      return sent;
    },
    async stop() {
      await new Promise<void>((r) => imap.close(() => r()));
      await new Promise<void>((r) => smtp.close(() => r()));
    },
  };
}

let n = 0;
/** A plain customer email as a mail app would send it. */
export function email(o: { from: string; fromName?: string; to?: string; subject: string; body: string; inReplyTo?: string; references?: string[]; messageId?: string; headers?: Record<string, string>; attachment?: { name: string; type: string; content: string } }) {
  const id = o.messageId ?? `<cust-${Date.now()}-${++n}@customer.test>`;
  const boundary = `b${n}x`;
  const head = [
    `From: ${o.fromName ? `"${o.fromName}" ` : ""}<${o.from}>`, `To: ${o.to ?? "help@shop.test"}`, `Subject: ${o.subject}`,
    `Date: ${new Date().toUTCString()}`, `Message-ID: ${id}`, "MIME-Version: 1.0",
    ...(o.inReplyTo ? [`In-Reply-To: ${o.inReplyTo}`] : []), ...(o.references?.length ? [`References: ${o.references.join(" ")}`] : []),
    ...Object.entries(o.headers ?? {}).map(([k, v]) => `${k}: ${v}`),
  ];
  if (!o.attachment) return [...head, "Content-Type: text/plain; charset=utf-8", "", o.body, ""].join("\r\n");
  return [
    ...head, `Content-Type: multipart/mixed; boundary="${boundary}"`, "",
    `--${boundary}`, "Content-Type: text/plain; charset=utf-8", "", o.body, "",
    `--${boundary}`, `Content-Type: ${o.attachment.type}; name="${o.attachment.name}"`, `Content-Disposition: attachment; filename="${o.attachment.name}"`,
    "Content-Transfer-Encoding: base64", "", Buffer.from(o.attachment.content).toString("base64"), "",
    `--${boundary}--`, "",
  ].join("\r\n");
}
