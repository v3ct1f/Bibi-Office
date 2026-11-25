/**
 * The real mail server: IMAP to read and to write changes back, SMTP to send. Works with any standard mail host
 * (Stalwart, Dovecot/Postfix, and hosts that offer a "master user" / admin sign-in).
 *
 * No mailbox password is stored by Office. Office signs in to a person's mailbox with access the mail server gives
 * Office itself: a master user (Dovecot `alice@acme.com*office`, Stalwart `alice@acme.com%office`) whose name and
 * password live only in the server's environment (MAIL_MASTER_USER / MAIL_MASTER_PASSWORD), never in the database.
 *
 * Message ids handed to the service ("uid") look like `<uidValidity>:<uid>:<folder path>`, so a moved message can be found again.
 */
import { ImapFlow, type ListResponse } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import {
  MailProviderError, type IncomingMail, type MailProvider, type OutgoingMail, type Party, type ProviderAccount, type RemoteChange,
  type RemoteChangeResult, type RemoteFlags, type RemoteFolder,
} from "./provider.ts";

export type Security = "tls" | "starttls" | "none";
export interface Server { host: string; port: number; security: Security }
export interface Login { user: string; pass: string }

export interface ImapProviderConfig {
  imap: Server;
  smtp: Server;
  /** How Office signs in to a person's mailbox for reading (see `masterLogin`). */
  login(address: string): Login;
  /** How Office signs in to send; defaults to `login`. A relay account allowed to send for the business's domains also works. */
  smtpLogin?(address: string): Login;
  /** On the first fetch, mail of the last this-many days is brought in (not the whole history). Default 90. */
  firstRunDays?: number;
  /** Most messages brought in per folder per fetch; the rest comes next time. Default 100. */
  perFetch?: number;
}

/** Master-user sign-in: `format` uses {address} and {master}, e.g. "{address}*{master}" (Dovecot) or "{address}%{master}" (Stalwart). */
export function masterLogin(format: string, masterUser: string, masterPassword: string): (address: string) => Login {
  if (!format.includes("{address}")) throw new Error("MAIL_LOGIN_FORMAT must contain {address}");
  return (address) => ({ user: format.replaceAll("{address}", address).replaceAll("{master}", masterUser), pass: masterPassword });
}

// ── ids and cursors ──────────────────────────────────────────────────────────
const refOf = (validity: bigint | number | string, uid: number, path: string) => `${String(validity)}:${uid}:${path}`;
function parseRef(ref: string): { validity: string; uid: number; path: string } | null {
  const m = /^(\d+):(\d+):(.+)$/s.exec(ref);
  return m ? { validity: m[1]!, uid: Number(m[2]), path: m[3]! } : null;
}
type Cursor = Partial<Record<"inbox" | "spam", { v: string; u: number }>>;
const readCursor = (c: string | null): Cursor => { try { const x = c ? JSON.parse(c) : {}; return x && typeof x === "object" ? x as Cursor : {}; } catch { return {}; } };

// ── errors in plain words ────────────────────────────────────────────────────
function reason(err: unknown): string {
  const e = err as { message?: string; code?: string; responseText?: string; response?: string; authenticationFailed?: boolean };
  if (e instanceof MailProviderError) return e.message;
  if (e.authenticationFailed || e.code === "EAUTH") return "The mail server refused Office's sign-in. Check MAIL_MASTER_USER and MAIL_MASTER_PASSWORD on the server.";
  if (e.code === "ECONNREFUSED" || /ECONNREFUSED/.test(e.message ?? "")) return "The mail server refused the connection.";
  if (/timed? ?out|ETIMEDOUT/i.test(`${e.code} ${e.message}`)) return "The mail server didn't answer in time.";
  if (/ENOTFOUND|EAI_AGAIN/.test(`${e.code} ${e.message}`)) return "Can't find the mail server.";
  if (/certificate|self.signed|CERT_/i.test(`${e.code} ${e.message}`)) return "The mail server's security certificate isn't valid.";
  if (e.code === "EENVELOPE" || /recipient|mailbox unavailable|550|553/i.test(e.response ?? "")) return `The mail server refused the message: ${(e.response ?? e.message ?? "").slice(0, 200)}`;
  return "The mail server couldn't do that just now. Please try again in a moment.";
}
const fail = (err: unknown): never => { throw new MailProviderError(reason(err)); };

// ── parsing ──────────────────────────────────────────────────────────────────
const parties = (a: AddressObject | AddressObject[] | undefined): Party[] =>
  (Array.isArray(a) ? a : a ? [a] : []).flatMap((x) => x.value).filter((v) => v.address).map((v) => ({ name: (v.name ?? "").trim(), email: v.address!.toLowerCase() }));
const ids = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? v.split(/\s+/) : []).map((s) => s.trim()).filter((s) => /^<[^<>\s]+>$/.test(s));

/** Turns a raw email into what Office keeps. Exported for tests. */
export async function parseRaw(uid: string, raw: Buffer | string, flags: Set<string>, spam: boolean): Promise<IncomingMail> {
  const m = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true });
  const from = parties(m.from)[0] ?? { name: "", email: "" };
  return {
    uid, messageId: ids(m.messageId)[0] ?? null, inReplyTo: ids(m.inReplyTo)[0] ?? null, references: ids(m.references),
    from, to: parties(m.to), cc: parties(m.cc), subject: m.subject ?? "", text: m.text ?? "", html: typeof m.html === "string" ? m.html : null,
    date: (m.date ?? new Date()).toISOString(),
    files: m.attachments.filter((a) => a.contentDisposition !== "inline" || a.filename).map((a) => ({
      name: a.filename || "attachment", contentType: a.contentType || "application/octet-stream", data: a.content,
    })),
    spam, read: flags.has("\\Seen"), starred: flags.has("\\Flagged"),
  };
}

// ── the provider ─────────────────────────────────────────────────────────────
const FALLBACK: Record<Exclude<RemoteFolder, "inbox">, { use: string; names: string[] }> = {
  sent: { use: "\\Sent", names: ["Sent", "Sent Items", "Sent Messages"] },
  spam: { use: "\\Junk", names: ["Junk", "Spam", "Junk E-mail"] },
  trash: { use: "\\Trash", names: ["Trash", "Deleted Items", "Deleted Messages"] },
  archive: { use: "\\Archive", names: ["Archive", "Archives"] },
};

export function imapMailProvider(cfg: ImapProviderConfig): MailProvider {
  const firstRunDays = cfg.firstRunDays ?? 90, perFetch = cfg.perFetch ?? 100;

  function client(address: string) {
    const l = cfg.login(address);
    return new ImapFlow({
      host: cfg.imap.host, port: cfg.imap.port, secure: cfg.imap.security === "tls", doSTARTTLS: cfg.imap.security === "starttls" ? true : cfg.imap.security === "none" ? false : undefined,
      auth: { user: l.user, pass: l.pass }, logger: false, disableAutoIdle: true,
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000,
    } as ConstructorParameters<typeof ImapFlow>[0]);
  }
  async function withClient<T>(address: string, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
    const c = client(address);
    try { await c.connect(); return await fn(c); }
    catch (err) { return fail(err); }
    finally { await c.logout().catch(() => c.close()); }
  }

  /** The server's folder for an Office folder (by its special-use mark, else by a usual name); created when missing. */
  async function folderPath(c: ImapFlow, folder: RemoteFolder, list?: ListResponse[], create = true): Promise<string | null> {
    if (folder === "inbox") return "INBOX";
    const all = list ?? await c.list();
    const f = FALLBACK[folder];
    const hit = all.find((x) => x.specialUse === f.use) ?? all.find((x) => f.names.some((n) => n.toLowerCase() === x.path.toLowerCase() || n.toLowerCase() === x.name.toLowerCase()));
    if (hit) return hit.path;
    if (!create) return null;
    const made = await c.mailboxCreate(f.names[0]!);
    return made.path;
  }

  async function fetchFolder(c: ImapFlow, path: string, from: { v: string; u: number } | undefined, spam: boolean) {
    const box = await c.mailboxOpen(path, { readOnly: true });
    const validity = String(box.uidValidity);
    let uids: number[];
    if (!from || from.v !== validity) {
      uids = (await c.search({ since: new Date(Date.now() - firstRunDays * 86_400_000) }, { uid: true })) || [];
    } else {
      uids = box.exists ? ((await c.search({ uid: `${from.u + 1}:*` }, { uid: true })) || []).filter((u) => u > from.u) : [];
    }
    uids.sort((a, b) => a - b);
    const batch = uids.slice(0, perFetch);
    const messages: IncomingMail[] = [];
    if (batch.length) {
      const got: { uid: number; raw: Buffer; flags: Set<string> }[] = [];
      for await (const m of c.fetch(batch.join(","), { uid: true, source: true, flags: true }, { uid: true })) {
        if (m.source) got.push({ uid: m.uid, raw: m.source, flags: m.flags ?? new Set() });
      }
      got.sort((a, b) => a.uid - b.uid);
      for (const g of got) messages.push(await parseRaw(refOf(validity, g.uid, path), g.raw, g.flags, spam));
    }
    const last = batch.length ? batch[batch.length - 1]! : from && from.v === validity ? from.u : Math.max(0, Number(box.uidNext) - 1);
    // What another mail app changed on recent messages Office already has.
    const flags: RemoteFlags[] = [];
    const known = from && from.v === validity ? from.u : 0;
    if (known > 0 && box.exists) {
      for await (const m of c.fetch(`${Math.max(1, known - 299)}:${known}`, { uid: true, flags: true }, { uid: true })) {
        const f = m.flags ?? new Set<string>();
        flags.push({ uid: refOf(validity, m.uid, path), read: f.has("\\Seen"), starred: f.has("\\Flagged") });
      }
    }
    return { messages, cursor: { v: validity, u: last }, flags };
  }

  async function transport(address: string) {
    const l = (cfg.smtpLogin ?? cfg.login)(address);
    return nodemailer.createTransport({
      host: cfg.smtp.host, port: cfg.smtp.port, secure: cfg.smtp.security === "tls", requireTLS: cfg.smtp.security === "starttls", ignoreTLS: cfg.smtp.security === "none",
      auth: { user: l.user, pass: l.pass }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000,
    });
  }

  return {
    key: "imap",
    autoProvision: false,
    background: true,

    async fetchNew(account: ProviderAccount, cursor) {
      return withClient(account.address, async (c) => {
        const at = readCursor(cursor);
        const inbox = await fetchFolder(c, "INBOX", at.inbox, false);
        const junkPath = await folderPath(c, "spam", undefined, false);
        const junk = junkPath ? await fetchFolder(c, junkPath, at.spam, true) : null;
        const next: Cursor = { inbox: inbox.cursor, ...(junk ? { spam: junk.cursor } : {}) };
        return { messages: [...inbox.messages, ...(junk?.messages ?? [])], cursor: JSON.stringify(next), flags: [...inbox.flags, ...(junk?.flags ?? [])] };
      });
    },

    async send(account, mail: OutgoingMail) {
      const fmt = (p: Party) => ({ name: p.name, address: p.email });
      const raw = await new MailComposer({
        from: fmt(mail.from), to: mail.to.map(fmt), cc: mail.cc.length ? mail.cc.map(fmt) : undefined, subject: mail.subject,
        text: mail.text, html: mail.html ?? undefined, messageId: mail.messageId, inReplyTo: mail.inReplyTo ?? undefined,
        references: mail.references.length ? mail.references : undefined, date: new Date(),
        attachments: mail.files.map((f) => ({ filename: f.name, contentType: f.contentType, content: f.data })),
      }).compile().build();
      const t = await transport(account.address);
      try {
        await t.sendMail({ envelope: { from: account.address, to: [...mail.to, ...mail.cc, ...mail.bcc].map((p) => p.email) }, raw });
      } catch (err) { fail(err); }
      finally { t.close(); }
      // A copy in the server's Sent folder, so the person sees it in other mail apps too. Sending already worked: a failure here is not an error.
      try {
        return await withClient(account.address, async (c) => {
          const path = (await folderPath(c, "sent"))!;
          const r = await c.append(path, raw, ["\\Seen"]);
          return { uid: r && r.uid && r.uidValidity ? refOf(r.uidValidity, r.uid, path) : null };
        });
      } catch { return { uid: null }; }
    },

    async applyChanges(account, changes: RemoteChange[]) {
      if (!changes.length) return [];
      return withClient(account.address, async (c) => {
        const out: RemoteChangeResult[] = [];
        const list = await c.list();
        const targets = new Map<RemoteFolder, string>();
        const target = async (f: RemoteFolder) => { if (!targets.has(f)) targets.set(f, (await folderPath(c, f, list))!); return targets.get(f)!; };
        const byPath = new Map<string, { change: RemoteChange; ref: NonNullable<ReturnType<typeof parseRef>> }[]>();
        for (const ch of changes) {
          const ref = parseRef(ch.uid);
          if (!ref) { out.push({ uid: ch.uid, newUid: null }); continue; }
          const arr = byPath.get(ref.path) ?? []; arr.push({ change: ch, ref }); byPath.set(ref.path, arr);
        }
        for (const [path, items] of byPath) {
          let box;
          try { box = await c.mailboxOpen(path); } catch { for (const i of items) out.push({ uid: i.change.uid, newUid: null }); continue; }
          for (const { change, ref } of items) {
            // The folder was rebuilt on the server: these ids mean nothing any more.
            if (String(box.uidValidity) !== ref.validity) { out.push({ uid: change.uid, newUid: null }); continue; }
            const one = String(ref.uid);
            const exists = ((await c.search({ uid: one }, { uid: true })) || []).includes(ref.uid);
            if (!exists) { out.push({ uid: change.uid, newUid: null }); continue; }
            if (change.folder === "deleted") {
              await c.messageDelete(one, { uid: true });
              out.push({ uid: change.uid, newUid: null });
              continue;
            }
            await (change.read ? c.messageFlagsAdd(one, ["\\Seen"], { uid: true }) : c.messageFlagsRemove(one, ["\\Seen"], { uid: true }));
            await (change.starred ? c.messageFlagsAdd(one, ["\\Flagged"], { uid: true }) : c.messageFlagsRemove(one, ["\\Flagged"], { uid: true }));
            const to = await target(change.folder);
            if (to === path) { out.push({ uid: change.uid, newUid: change.uid }); continue; }
            const moved = await c.messageMove(one, to, { uid: true });
            const newUid = moved && moved.uidMap?.get(ref.uid);
            out.push({ uid: change.uid, newUid: moved && newUid && moved.uidValidity ? refOf(moved.uidValidity, newUid, to) : null });
          }
        }
        return out;
      });
    },
  };
}

/** Builds the real provider from the server's environment, or explains what is missing. */
export function imapProviderFromEnv(env: Record<string, string | undefined>): MailProvider {
  const need = (k: string) => { const v = env[k]?.trim(); if (!v) throw new Error(`MAIL_PROVIDER=imap needs ${k}`); return v; };
  const sec = (k: string, d: Security): Security => { const v = (env[k] ?? d).trim(); if (v !== "tls" && v !== "starttls" && v !== "none") throw new Error(`${k} must be tls, starttls or none`); return v; };
  const imapSec = sec("MAIL_IMAP_SECURITY", "tls"), smtpSec = sec("MAIL_SUBMIT_SECURITY", "tls");
  if (env.NODE_ENV === "production" && (imapSec === "none" || smtpSec === "none")) throw new Error("Unencrypted mail connections aren't allowed in production");
  const login = masterLogin(env.MAIL_LOGIN_FORMAT?.trim() || "{address}*{master}", need("MAIL_MASTER_USER"), need("MAIL_MASTER_PASSWORD"));
  const relayUser = env.MAIL_SUBMIT_USER?.trim(), relayPass = env.MAIL_SUBMIT_PASSWORD;
  return imapMailProvider({
    imap: { host: need("MAIL_IMAP_HOST"), port: Number(env.MAIL_IMAP_PORT ?? (imapSec === "tls" ? 993 : 143)), security: imapSec },
    smtp: { host: env.MAIL_SUBMIT_HOST?.trim() || need("MAIL_IMAP_HOST"), port: Number(env.MAIL_SUBMIT_PORT ?? (smtpSec === "tls" ? 465 : 587)), security: smtpSec },
    login,
    ...(relayUser && relayPass ? { smtpLogin: () => ({ user: relayUser, pass: relayPass }) } : {}),
  });
}
