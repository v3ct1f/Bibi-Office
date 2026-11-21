/**
 * Sending KPI digest emails through the company's own outgoing mail server (SMTP settings of this module).
 *
 * Hosts are typed in by tenants, so the host is resolved first and private, loopback and link-local
 * addresses are refused (no reaching into our own network). That check and unencrypted connections are only
 * relaxed outside production (local test mail servers).
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import nodemailer from "nodemailer";

export type Security = "tls" | "starttls" | "none";
export interface Smtp { host: string; port: number; security: Security; user: string; pass: string; from: string; fromName: string }
export interface Outgoing { to: string; subject: string; text: string; html: string; attachments?: { filename: string; content: Buffer }[] }

export class MailError extends Error {}

export const allowPrivateHosts = () =>
  process.env.KPI_ALLOW_PRIVATE_MAIL_HOSTS === "true" || (process.env.NODE_ENV !== "production" && process.env.KPI_ALLOW_PRIVATE_MAIL_HOSTS !== "false");

function privateV4(ip: string) {
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
export function isPrivateAddress(ip: string) {
  if (isIP(ip) === 4) return privateV4(ip);
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateV4(v.slice(7));
  return v === "::1" || v === "::" || /^(fc|fd|fe[89ab]|ff)/.test(v);
}

async function safeAddress(s: Smtp): Promise<string> {
  if (s.security === "none" && !allowPrivateHosts()) throw new MailError("Unencrypted connections aren't allowed. Choose SSL/TLS or STARTTLS.");
  let addrs: { address: string }[];
  try { addrs = isIP(s.host) ? [{ address: s.host }] : await lookup(s.host, { all: true }); }
  catch { throw new MailError(`Can't find the mail server ${s.host}. Check the host name.`); }
  if (!addrs.length) throw new MailError(`Can't find the mail server ${s.host}.`);
  if (!allowPrivateHosts() && addrs.some((a) => isPrivateAddress(a.address))) throw new MailError(`${s.host} points to a private network address, which isn't allowed.`);
  return addrs[0]!.address;
}

export function mailErrorText(err: unknown): string {
  const e = err as { message?: string; code?: string; responseText?: string; response?: string };
  if (e instanceof MailError) return e.message;
  if (e.code === "EAUTH" || /auth/i.test(e.responseText ?? e.response ?? "")) return "The mail server refused the user name or password";
  if (e.code === "ECONNREFUSED" || /ECONNREFUSED/.test(e.message ?? "")) return "The mail server refused the connection. Check the host and port.";
  if (/ETIMEDOUT|ETIMEOUT|timed? ?out/i.test(`${e.code} ${e.message}`)) return "The mail server didn't answer in time. Check the host and port.";
  if (/ENOTFOUND|EAI_AGAIN/.test(`${e.code} ${e.message}`)) return "Can't find the mail server. Check the host name.";
  if (/certificate|self.signed|CERT_/i.test(`${e.code} ${e.message}`)) return "The mail server's security certificate isn't valid";
  return (e.responseText ?? e.response ?? e.message ?? "Unknown mail error").slice(0, 300);
}

/** Sends one email; throws MailError with a readable reason. */
export async function send(s: Smtp, m: Outgoing): Promise<void> {
  const ip = await safeAddress(s);
  const t = nodemailer.createTransport({
    host: ip, port: s.port, secure: s.security === "tls", requireTLS: s.security === "starttls", ignoreTLS: s.security === "none",
    auth: s.user ? { user: s.user, pass: s.pass } : undefined, tls: { servername: isIP(s.host) ? undefined : s.host },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  });
  try {
    await t.sendMail({
      from: { name: s.fromName, address: s.from }, to: m.to, subject: m.subject, text: m.text, html: m.html,
      attachments: m.attachments, headers: { "Auto-Submitted": "auto-generated" },
    });
  } catch (err) { throw new MailError(mailErrorText(err)); }
  finally { t.close(); }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A short, plain email with an optional button. */
export function compose(o: { greeting: string; lines: string[]; button?: { label: string; url: string }; footer?: string }): { text: string; html: string } {
  const text = [o.greeting, "", ...o.lines, ...(o.button ? ["", `${o.button.label}: ${o.button.url}`] : []), ...(o.footer ? ["", o.footer] : [])].join("\n");
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#1f2328;max-width:560px">
<p>${esc(o.greeting)}</p>${o.lines.map((l) => `<p>${esc(l)}</p>`).join("")}
${o.button ? `<p style="margin:24px 0"><a href="${esc(o.button.url)}" style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block">${esc(o.button.label)}</a></p>
<p style="font-size:12px;color:#57606a">Or open this link: ${esc(o.button.url)}</p>` : ""}
${o.footer ? `<p style="font-size:12px;color:#57606a">${esc(o.footer)}</p>` : ""}</div>`;
  return { text, html };
}
