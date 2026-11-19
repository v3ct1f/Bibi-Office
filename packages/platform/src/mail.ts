import { randomBytes, timingSafeEqual } from "node:crypto";
import type postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { badRequest, type RequestContext } from "@office/core";
import { uuidv7, type Tx } from "@office/db";
import { mailInbound, mailOutbox, mailRoutes } from "@office/db";

// ───────────────────────── config ─────────────────────────
/** What modules need to queue mail and build links (API and worker). Sending itself happens in the worker. */
export interface MailEnv {
  fromEmail: string;            // envelope/header From address, e.g. no-reply@mail.example.com
  fromName: string;             // default display name
  inboundDomain?: string | undefined;   // receive at <key>@<inboundDomain>; unset = no inbound
  appUrl: string;               // public web app URL for links in emails
}
export function mailEnvFromEnv(env: NodeJS.ProcessEnv = process.env): MailEnv {
  const m = /^\s*(?:"?([^"<]*)"?\s*)?<([^<>\s]+@[^<>\s]+)>\s*$|^\s*([^<>\s]+@[^<>\s]+)\s*$/.exec(env.MAIL_FROM ?? "Office <no-reply@office.localhost>");
  if (!m) throw new Error("MAIL_FROM must look like 'Name <address@domain>'");
  return {
    fromName: (m[1] ?? "Office").trim() || "Office", fromEmail: (m[2] ?? m[3])!,
    inboundDomain: env.INBOUND_MAIL_DOMAIN || undefined,
    appUrl: (env.APP_URL ?? "http://localhost:5173").replace(/\/+$/, ""),
  };
}

// ───────────────────────── transports ─────────────────────────
export interface OutgoingMail {
  from: string; to: string[]; subject: string; text: string; html?: string | undefined; replyTo?: string | undefined;
  messageId: string; inReplyTo?: string | undefined; references?: string[] | undefined;
}
export interface MailTransport { send(m: OutgoingMail): Promise<void> }

/** SMTP (any provider). URL like smtps://user:pass@smtp.example.com:465 */
export class SmtpTransport implements MailTransport {
  private t: Promise<import("nodemailer").Transporter>;
  constructor(url: string) { this.t = import("nodemailer").then((n) => n.createTransport(url)); }
  async send(m: OutgoingMail) {
    await (await this.t).sendMail({
      from: m.from, to: m.to, subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}), ...(m.replyTo ? { replyTo: m.replyTo } : {}),
      messageId: `<${m.messageId}>`, ...(m.inReplyTo ? { inReplyTo: `<${m.inReplyTo}>` } : {}),
      ...(m.references?.length ? { references: m.references.map((r) => `<${r}>`) } : {}),
      headers: { "auto-submitted": "auto-generated" },
    });
  }
}
/** Dev default: log instead of sending. */
export class LogTransport implements MailTransport {
  constructor(private log: (o: object) => void = (o) => console.log(JSON.stringify({ mail: o }))) {}
  async send(m: OutgoingMail) { this.log({ to: m.to, subject: m.subject, messageId: m.messageId }); }
}
/** Tests: keeps messages in memory. */
export class MemoryTransport implements MailTransport {
  sent: OutgoingMail[] = [];
  async send(m: OutgoingMail) { this.sent.push(m); }
}
export function transportFromEnv(env: NodeJS.ProcessEnv = process.env): MailTransport {
  if ((env.MAIL_DRIVER ?? "log") === "smtp") {
    if (!env.SMTP_URL) throw new Error("SMTP_URL is required when MAIL_DRIVER=smtp");
    return new SmtpTransport(env.SMTP_URL);
  }
  return new LogTransport();
}

// ───────────────────────── queue (in the caller's tenant tx) ─────────────────────────
const EMAIL = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]+$/;
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
export interface QueueMail {
  to: string | string[]; subject: string; text: string; html?: string | undefined; fromName?: string | undefined; replyTo?: string | undefined;
  inReplyTo?: string | undefined; references?: string[] | undefined;
}
/** Queue an email; it is sent only if the surrounding transaction commits. Returns the Message-ID (without <>). */
export async function queueMail(tx: Tx, ctx: RequestContext, env: MailEnv, module: string | null, m: QueueMail): Promise<{ messageId: string }> {
  const to = [...new Set((Array.isArray(m.to) ? m.to : [m.to]).map((x) => x.trim().toLowerCase()))];
  if (!to.length || to.length > 20 || to.some((x) => !EMAIL.test(x) || x.length > 320)) throw badRequest("Invalid recipient address");
  if (m.replyTo && !EMAIL.test(m.replyTo)) throw badRequest("Invalid reply-to address");
  const msgId = (x?: string) => (x ? x.replace(/^<|>$/g, "") : undefined);
  const messageId = `${uuidv7()}@${env.fromEmail.split("@")[1]}`;
  await tx.insert(mailOutbox).values({
    id: uuidv7(), tenantId: ctx.tenantId, module, toAddrs: to, subject: oneLine(m.subject).slice(0, 500) || "(no subject)",
    textBody: m.text.slice(0, 200000), htmlBody: m.html ?? null, fromName: m.fromName ? oneLine(m.fromName).replace(/["<>]/g, "").slice(0, 120) : null,
    replyTo: m.replyTo ?? null, messageId, inReplyTo: msgId(m.inReplyTo) ?? null, references: (m.references ?? []).map((r) => msgId(r)!).slice(-20),
  });
  return { messageId };
}

/** The module's inbound address (created on first use), or null when inbound mail isn't configured. */
export async function inboundAddress(tx: Tx, ctx: RequestContext, env: MailEnv, module: string): Promise<string | null> {
  if (!env.inboundDomain) return null;
  await tx.insert(mailRoutes).values({ key: randomBytes(12).toString("hex"), tenantId: ctx.tenantId, module }).onConflictDoNothing();
  const [r] = await tx.select({ key: mailRoutes.key }).from(mailRoutes).where(eq(mailRoutes.module, module));
  return `${r!.key}@${env.inboundDomain}`;
}

// ───────────────────────── worker: send due mail ─────────────────────────
const BACKOFF_MIN = [1, 5, 30, 120, 360];
export async function sendDueMail(db: postgres.Sql, transport: MailTransport, env: MailEnv, o: { batch?: number; leaseSec?: number } = {}): Promise<number> {
  const rows = await db<{ id: string; to_addrs: string[]; subject: string; text_body: string; html_body: string | null; from_name: string | null; reply_to: string | null;
    message_id: string; in_reply_to: string | null; references: string[]; attempts: number }[]>`
    with due as (select id from mail_outbox where status = 'queued' and next_attempt_at <= now() order by next_attempt_at limit ${o.batch ?? 50} for update skip locked)
    update mail_outbox m set next_attempt_at = now() + make_interval(secs => ${o.leaseSec ?? 120}) from due where m.id = due.id
    returning m.id, m.to_addrs, m.subject, m.text_body, m.html_body, m.from_name, m.reply_to, m.message_id, m.in_reply_to, m."references", m.attempts`;
  for (const r of rows) {
    const attempt = r.attempts + 1;
    try {
      await transport.send({
        from: `"${(r.from_name ?? env.fromName).replace(/"/g, "")}" <${env.fromEmail}>`, to: r.to_addrs, subject: r.subject, text: r.text_body,
        html: r.html_body ?? undefined, replyTo: r.reply_to ?? undefined, messageId: r.message_id, inReplyTo: r.in_reply_to ?? undefined, references: r.references,
      });
      await db`update mail_outbox set status = 'sent', attempts = ${attempt}, sent_at = now(), last_error = null where id = ${r.id}`;
    } catch (e) {
      const err = String((e as Error).message ?? e).slice(0, 500);
      const wait = BACKOFF_MIN[attempt - 1];
      if (wait === undefined) await db`update mail_outbox set status = 'failed', attempts = ${attempt}, last_error = ${err} where id = ${r.id}`;
      else await db`update mail_outbox set attempts = ${attempt}, last_error = ${err}, next_attempt_at = now() + make_interval(mins => ${wait}) where id = ${r.id}`;
    }
  }
  return rows.length;
}

// ───────────────────────── inbound ─────────────────────────
/** Normalized inbound message (our webhook format). Postmark's inbound JSON is accepted too. */
export const InboundMailSchema = z.object({
  to: z.array(z.string().max(320)).min(1).max(50),
  from: z.object({ email: z.string().max(320), name: z.string().max(200).optional() }),
  subject: z.string().max(1000).default(""),
  text: z.string().max(500_000).default(""),
  html: z.string().max(2_000_000).optional(),
  messageId: z.string().min(1).max(998),
  inReplyTo: z.string().max(998).optional(),
  references: z.array(z.string().max(998)).max(100).default([]),
});
export type InboundMailInput = z.infer<typeof InboundMailSchema>;

export function normalizeInbound(body: unknown): InboundMailInput {
  const b = body as Record<string, unknown>;
  if (b && typeof b === "object" && "FromFull" in b) {   // Postmark inbound webhook
    const headers = (b.Headers as { Name: string; Value: string }[] | undefined) ?? [];
    const h = (n: string) => headers.find((x) => x.Name.toLowerCase() === n)?.Value;
    const ids = (s?: string) => (s?.match(/<[^>]+>/g) ?? []).map((x) => x.slice(1, -1));
    return InboundMailSchema.parse({
      to: ((b.ToFull as { Email: string }[] | undefined) ?? []).map((x) => x.Email).concat(((b.CcFull as { Email: string }[] | undefined) ?? []).map((x) => x.Email)),
      from: { email: (b.FromFull as { Email: string }).Email, name: (b.FromFull as { Name?: string }).Name || undefined },
      subject: b.Subject ?? "", text: b.TextBody || "", html: b.HtmlBody || undefined,
      messageId: ids(h("message-id"))[0] ?? String(b.MessageID ?? ""), inReplyTo: ids(h("in-reply-to"))[0], references: ids(h("references")),
    });
  }
  const p = InboundMailSchema.parse(body);
  const clean = (x: string) => x.trim().replace(/^<|>$/g, "");
  return { ...p, messageId: clean(p.messageId), ...(p.inReplyTo ? { inReplyTo: clean(p.inReplyTo) } : {}), references: p.references.map(clean) };
}

export const secretMatches = (given: string | undefined, expected: string | undefined) => {
  if (!given || !expected) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Find (tenant, module) for the first recipient on our inbound domain. */
export async function resolveInboundRoute(tx: Tx, env: MailEnv, to: string[]) {
  if (!env.inboundDomain) return null;
  for (const addr of to) {
    const m = /<?([^<>\s@]+)@([^<>\s@]+)>?\s*$/.exec(addr.trim().toLowerCase());
    if (!m || m[2] !== env.inboundDomain.toLowerCase()) continue;
    const key = m[1]!.split("+")[0]!;
    if (!/^[a-z0-9]{12,40}$/.test(key)) continue;
    const r = await tx.execute(sql`select tenant_id as "tenantId", module from mail_route_lookup(${key})`) as unknown as { tenantId: string; module: string }[];
    if (r[0]) return r[0];
  }
  return null;
}

/** Record an inbound message once; false if we've seen this Message-ID for the tenant before. */
export async function recordInbound(tx: Tx, tenantId: string, module: string, m: InboundMailInput) {
  const r = await tx.insert(mailInbound).values({
    id: uuidv7(), tenantId, module, messageId: m.messageId.slice(0, 998), fromEmail: m.from.email.toLowerCase().slice(0, 320), subject: m.subject.slice(0, 1000),
  }).onConflictDoNothing().returning({ id: mailInbound.id });
  return r.length > 0;
}

/** Plain text for an HTML-only email (crude, safe: no markup survives). */
export const htmlToText = (html: string) => html
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
  .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
  .replace(/\n{3,}/g, "\n\n").trim();

