/**
 * Talking to the company's own mailbox: IMAP to fetch new mail, SMTP to send replies.
 *
 * Mail hosts are typed in by tenants, so every connection first resolves the host and refuses private,
 * loopback and link-local addresses (no reaching into our own network). That check, and unencrypted
 * connections, are only relaxed outside production (local test mail servers).
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";

export type Security = "tls" | "starttls" | "none";
export interface Endpoint { host: string; port: number; security: Security; user: string; pass: string }
export interface Mailbox { address: string; fromName: string; folder: string; smtp: Endpoint; imap: Endpoint }

export const allowPrivateHosts = () =>
  process.env.SUPPORT_ALLOW_PRIVATE_MAIL_HOSTS === "true" || (process.env.NODE_ENV !== "production" && process.env.SUPPORT_ALLOW_PRIVATE_MAIL_HOSTS !== "false");

export class MailError extends Error {}

function privateV4(ip: string) {
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
export function isPrivateAddress(ip: string) {
  if (isIP(ip) === 4) return privateV4(ip);
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateV4(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
}

/** Resolves the host once and returns the address to connect to (TLS still checks the certificate against the host name). */
async function safeAddress(e: Endpoint): Promise<string> {
  if (e.security === "none" && !allowPrivateHosts()) throw new MailError("Unencrypted connections aren't allowed. Choose SSL/TLS or STARTTLS.");
  let addrs: { address: string }[];
  try { addrs = isIP(e.host) ? [{ address: e.host }] : await lookup(e.host, { all: true }); }
  catch { throw new MailError(`Can't find the mail server ${e.host}. Check the host name.`); }
  if (!addrs.length) throw new MailError(`Can't find the mail server ${e.host}.`);
  if (!allowPrivateHosts() && addrs.some((a) => isPrivateAddress(a.address))) throw new MailError(`${e.host} points to a private network address, which isn't allowed.`);
  return addrs[0]!.address;
}

const reason = (err: unknown) => {
  const e = err as { message?: string; code?: string; responseText?: string; response?: string; authenticationFailed?: boolean };
  if (e instanceof MailError) return e.message;
  if (e.authenticationFailed || e.code === "EAUTH" || /auth/i.test(e.responseText ?? e.response ?? "")) return "The server refused the user name or password";
  if (e.code === "ECONNREFUSED" || /ECONNREFUSED/.test(e.message ?? "")) return "The server refused the connection. Check the host and port.";
  if (e.code === "ETIMEDOUT" || e.code === "ETIMEOUT" || /timed? ?out|ETIMEDOUT/i.test(e.message ?? "")) return "The server didn't answer in time. Check the host and port.";
  if (/ENOTFOUND|EAI_AGAIN/.test(`${e.code} ${e.message}`)) return "Can't find the mail server. Check the host name.";
  if (/certificate|self.signed|CERT_/i.test(`${e.code} ${e.message}`)) return "The server's security certificate isn't valid";
  return (e.responseText ?? e.response ?? e.message ?? "Unknown mail error").slice(0, 300);
};
export const mailErrorText = reason;

// ───────── SMTP ─────────
export interface Outgoing {
  to: string[]; cc?: string[]; subject: string; text: string; html: string;
  messageId: string; inReplyTo?: string | null; references?: string[];
}

async function transport(mb: Mailbox) {
  const ip = await safeAddress(mb.smtp);
  return nodemailer.createTransport({
    host: ip, port: mb.smtp.port, secure: mb.smtp.security === "tls", requireTLS: mb.smtp.security === "starttls", ignoreTLS: mb.smtp.security === "none",
    auth: { user: mb.smtp.user, pass: mb.smtp.pass }, tls: { servername: isIP(mb.smtp.host) ? undefined : mb.smtp.host },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  });
}

/** Sends one email; throws MailError with a readable reason. */
export async function send(mb: Mailbox, m: Outgoing): Promise<void> {
  const t = await transport(mb);
  try {
    await t.sendMail({
      from: { name: mb.fromName, address: mb.address }, to: m.to, cc: m.cc?.length ? m.cc : undefined, subject: m.subject,
      text: m.text, html: m.html, messageId: m.messageId, inReplyTo: m.inReplyTo ?? undefined,
      references: m.references?.length ? m.references : undefined, headers: { "Auto-Submitted": "no" },
    });
  } catch (err) { throw new MailError(reason(err)); }
  finally { t.close(); }
}

// ───────── IMAP ─────────
function client(mb: Mailbox, ip: string) {
  return new ImapFlow({
    host: ip, port: mb.imap.port, secure: mb.imap.security === "tls", servername: isIP(mb.imap.host) ? undefined : mb.imap.host,
    auth: { user: mb.imap.user, pass: mb.imap.pass }, logger: false, disableAutoIdle: true,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000,
  } as ConstructorParameters<typeof ImapFlow>[0]);
}

export interface Fetched { uidValidity: number; lastUid: number; messages: { uid: number; raw: Buffer }[] }

/**
 * New messages since `lastUid`. On the first run (or when the folder was recreated) it starts with mail
 * from the last `firstRunDays` days instead of importing the whole history. At most `limit` per run.
 */
export async function fetchNew(mb: Mailbox, from: { uidValidity: number | null; lastUid: number }, opts = { limit: 50, firstRunDays: 3 }): Promise<Fetched> {
  const ip = await safeAddress(mb.imap);
  const c = client(mb, ip);
  try {
    await c.connect();
    const box = await c.mailboxOpen(mb.folder);
    const validity = Number(box.uidValidity);
    let uids: number[];
    if (from.uidValidity !== validity) {
      const since = new Date(Date.now() - opts.firstRunDays * 86_400_000);
      const found = await c.search({ since }, { uid: true });
      uids = found || [];
    } else {
      const found = box.exists ? await c.search({ uid: `${from.lastUid + 1}:*` }, { uid: true }) : [];
      uids = (found || []).filter((u) => u > from.lastUid);
    }
    uids.sort((a, b) => a - b);
    const batch = uids.slice(0, opts.limit);
    const messages: Fetched["messages"] = [];
    if (batch.length) {
      for await (const m of c.fetch(batch.join(","), { uid: true, source: true }, { uid: true })) {
        if (m.source) messages.push({ uid: m.uid, raw: m.source });
      }
      await c.messageFlagsAdd(batch.join(","), ["\\Seen"], { uid: true }).catch(() => false);
    }
    messages.sort((a, b) => a.uid - b.uid);
    // Nothing new on a fresh start: remember where the folder is now.
    const lastUid = batch.length ? batch[batch.length - 1]! : from.uidValidity === validity ? from.lastUid : Math.max(0, Number(box.uidNext) - 1);
    return { uidValidity: validity, lastUid, messages };
  } catch (err) { throw new MailError(reason(err)); }
  finally { await c.logout().catch(() => c.close()); }
}

/** Checks both connections and says what's wrong with each, without sending or reading mail. */
export async function check(mb: Mailbox): Promise<{ smtp: string | null; imap: string | null }> {
  const smtp = await (async () => {
    try { const t = await transport(mb); try { await t.verify(); } finally { t.close(); } return null; } catch (err) { return reason(err); }
  })();
  const imap = await (async () => {
    try {
      const c = client(mb, await safeAddress(mb.imap));
      try { await c.connect(); await c.mailboxOpen(mb.folder); } finally { await c.logout().catch(() => c.close()); }
      return null;
    } catch (err) {
      const r = reason(err);
      return /mailbox|folder|nonexistent|doesn't exist|does not exist/i.test(r) ? `Can't open the folder “${mb.folder}”` : r;
    }
  })();
  return { smtp, imap };
}
