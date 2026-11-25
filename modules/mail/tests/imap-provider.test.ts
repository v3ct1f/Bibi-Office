/**
 * The real provider against real (in-memory) IMAP and SMTP servers. Office signs in as a "master user"
 * (alice@acme.test*office with the master password), never with Alice's own password.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
// @ts-expect-error hoodiecrow-imap ships no types
import hoodiecrow from "hoodiecrow-imap";
import { SMTPServer } from "smtp-server";
import { simpleParser, type ParsedMail } from "mailparser";
import { imapMailProvider, imapProviderFromEnv, masterLogin } from "../src/imap-provider.ts";
import { MailProviderError, type MailProvider } from "../src/provider.ts";

const ALICE = "alice@acme.test";
const MASTER_USER = "office", MASTER_PASS = "master-secret";
let imap: any, smtp: SMTPServer, imapPort = 0, smtpPort = 0;
const sent: { to: string[]; mail: ParsedMail; auth: string }[] = [];
let p: MailProvider;
const acct = { address: ALICE, providerRef: "mbx-1" };

let n = 0;
const raw = (o: { from: string; subject: string; body: string; spam?: boolean; attach?: boolean }) => {
  const id = `<m${++n}@sender.test>`;
  const head = [`From: "Sender ${n}" <${o.from}>`, `To: ${ALICE}`, `Subject: ${o.subject}`, `Date: ${new Date().toUTCString()}`, `Message-ID: ${id}`, "MIME-Version: 1.0"];
  if (!o.attach) return [...head, "Content-Type: text/plain; charset=utf-8", "", o.body, ""].join("\r\n");
  return [...head, 'Content-Type: multipart/mixed; boundary="xx"', "", "--xx", "Content-Type: text/plain; charset=utf-8", "", o.body, "",
    "--xx", 'Content-Type: application/pdf; name="quote.pdf"', 'Content-Disposition: attachment; filename="quote.pdf"', "Content-Transfer-Encoding: base64", "",
    Buffer.from("%PDF-1.4 pretend").toString("base64"), "", "--xx--", ""].join("\r\n");
};
const box = (path: string) => imap.getMailbox(path) as { messages: { uid: number; flags: string[] }[] };

beforeAll(async () => {
  imap = hoodiecrow({
    plugins: ["ID", "UIDPLUS", "ENABLE", "SPECIAL-USE", "LITERALPLUS", "MOVE"],
    users: { [`${ALICE}*${MASTER_USER}`]: { password: MASTER_PASS } },
    storage: { INBOX: { messages: [] }, "": { separator: "/", folders: { Junk: { "special-use": "\\Junk", messages: [] } } } },
  });
  await new Promise<void>((r) => imap.listen(0, "127.0.0.1", r));
  imapPort = (imap.address() as AddressInfo).port;
  smtp = new SMTPServer({
    secure: false, disabledCommands: ["STARTTLS"], allowInsecureAuth: true, logger: false,
    onAuth(a, _s, cb) { if (a.username === `${ALICE}*${MASTER_USER}` && a.password === MASTER_PASS) cb(null, { user: a.username }); else cb(new Error("Invalid login")); },
    onData(stream, session, cb) { simpleParser(stream).then((mail) => { sent.push({ to: session.envelope.rcptTo.map((r) => r.address), mail, auth: String(session.user) }); cb(); }).catch(cb); },
  });
  await new Promise<void>((r) => smtp.listen(0, "127.0.0.1", r));
  smtpPort = (smtp.server.address() as AddressInfo).port;
  p = imapMailProvider({
    imap: { host: "127.0.0.1", port: imapPort, security: "none" }, smtp: { host: "127.0.0.1", port: smtpPort, security: "none" },
    login: masterLogin("{address}*{master}", MASTER_USER, MASTER_PASS),
  });
});
afterAll(async () => {
  await new Promise<void>((r) => imap.close(() => r()));
  await new Promise<void>((r) => smtp.close(() => r()));
});

describe("real mail server (IMAP + SMTP)", () => {
  let cursor: string;
  it("reads new mail from Inbox and Junk, with read/starred state and attachments", async () => {
    imap.appendMessage("INBOX", ["\\Seen"], new Date(), raw({ from: "carla@client.test", subject: "Quote", body: "Hi Alice", attach: true }));
    imap.appendMessage("INBOX", ["\\Flagged"], new Date(), raw({ from: "bob@client.test", subject: "Lunch?", body: "Friday?" }));
    imap.appendMessage("Junk", [], new Date(), raw({ from: "win@prize.test", subject: "You won", body: "Send bank details" }));
    const got = await p.fetchNew(acct, null);
    expect(got.messages.map((m) => [m.subject, m.spam, m.read, m.starred])).toEqual([
      ["Quote", false, true, false], ["Lunch?", false, false, true], ["You won", true, false, false],
    ]);
    const q = got.messages[0]!;
    expect(q).toMatchObject({ from: { name: "Sender 1", email: "carla@client.test" }, to: [{ email: ALICE }], text: expect.stringContaining("Hi Alice") });
    expect(q.files).toHaveLength(1);
    expect(q.files[0]).toMatchObject({ name: "quote.pdf", contentType: "application/pdf" });
    expect(q.uid).toMatch(/^\d+:\d+:INBOX$/);
    cursor = got.cursor;
    // Reading in Office does not mark mail read on the server.
    expect(box("INBOX").messages[1]!.flags).not.toContain("\\Seen");
  });

  it("brings only what is new next time, plus what another mail app changed", async () => {
    const again = await p.fetchNew(acct, cursor);
    expect(again.messages).toEqual([]);
    expect(again.flags!.filter((f) => f.uid.endsWith(":INBOX")).map((f) => [f.read, f.starred])).toEqual([[true, false], [false, true]]);
    imap.appendMessage("INBOX", [], new Date(), raw({ from: "dan@client.test", subject: "New one", body: "hello" }));
    box("INBOX").messages[1]!.flags.push("\\Seen"); // read on a phone
    const next = await p.fetchNew(acct, again.cursor);
    expect(next.messages.map((m) => m.subject)).toEqual(["New one"]);
    expect(next.flags!.find((f) => f.uid.endsWith(":INBOX") && f.starred)).toMatchObject({ read: true });
    cursor = next.cursor;
  });

  it("sends over SMTP as the person, and keeps a copy in the server's Sent folder", async () => {
    const r = await p.send(acct, {
      from: { name: "Alice", email: ALICE }, to: [{ name: "Carla", email: "carla@client.test" }], cc: [], bcc: [{ name: "", email: "boss@acme.test" }],
      subject: "Your quote", text: "Attached.", html: "<p>Attached.</p>", messageId: "<out-1@acme.test>", inReplyTo: null, references: [],
      files: [{ name: "q.txt", contentType: "text/plain", data: Buffer.from("40 units") }],
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to.sort()).toEqual(["boss@acme.test", "carla@client.test"]);
    expect(sent[0]!.mail.subject).toBe("Your quote");
    expect(sent[0]!.mail.messageId).toBe("<out-1@acme.test>");
    expect(sent[0]!.mail.attachments[0]!.filename).toBe("q.txt");
    expect(r && r.uid).toMatch(/^\d+:\d+:Sent$/);
    expect(box("Sent").messages).toHaveLength(1);
    expect(box("Sent").messages[0]!.flags).toContain("\\Seen");
  });

  it("writes read, star, moves and deletes back to the server", async () => {
    const inbox = (await p.fetchNew(acct, null)).messages.filter((m) => !m.spam);
    const [quote, lunch, fresh] = inbox;
    const res = await p.applyChanges!(acct, [
      { uid: quote!.uid, read: false, starred: true, folder: "inbox" },
      { uid: lunch!.uid, read: true, starred: false, folder: "archive" },
      { uid: fresh!.uid, read: true, starred: false, folder: "deleted" },
      { uid: "1:999:INBOX", read: true, starred: false, folder: "trash" },
    ]);
    expect(res[0]).toEqual({ uid: quote!.uid, newUid: quote!.uid });
    expect(res[1]!.newUid).toMatch(/^\d+:\d+:Archive$/);
    expect(res[2]!.newUid).toBeNull();
    expect(res[3]!.newUid).toBeNull(); // not on the server (any more)
    const left = box("INBOX").messages;
    expect(left).toHaveLength(1);
    expect(left[0]!.flags).toContain("\\Flagged");
    expect(left[0]!.flags).not.toContain("\\Seen");
    expect(box("Archive").messages).toHaveLength(1);
    expect(box("Archive").messages[0]!.flags).toContain("\\Seen");
    // and it can be moved on from Archive by its new id
    const back = await p.applyChanges!(acct, [{ uid: res[1]!.newUid!, read: true, starred: false, folder: "trash" }]);
    expect(back[0]!.newUid).toMatch(/:Trash$/);
  });

  it("explains a refused sign-in in plain words", async () => {
    const bad = imapMailProvider({
      imap: { host: "127.0.0.1", port: imapPort, security: "none" }, smtp: { host: "127.0.0.1", port: smtpPort, security: "none" },
      login: masterLogin("{address}*{master}", MASTER_USER, "wrong"),
    });
    const e = await bad.fetchNew(acct, null).catch((x) => x);
    expect(e).toBeInstanceOf(MailProviderError);
    expect(e.message).toMatch(/refused Office's sign-in/);
  });

  it("is set up from the server's environment, and says what is missing", () => {
    expect(() => imapProviderFromEnv({ MAIL_IMAP_HOST: "mail.test" })).toThrow(/MAIL_MASTER_USER/);
    expect(() => imapProviderFromEnv({ NODE_ENV: "production", MAIL_IMAP_HOST: "mail.test", MAIL_MASTER_USER: "o", MAIL_MASTER_PASSWORD: "x", MAIL_IMAP_SECURITY: "none" })).toThrow(/Unencrypted/);
    const ok = imapProviderFromEnv({ MAIL_IMAP_HOST: "mail.test", MAIL_MASTER_USER: "o", MAIL_MASTER_PASSWORD: "x" });
    expect(ok).toMatchObject({ key: "imap", background: true, autoProvision: false });
    expect(masterLogin("{address}%{master}", "office", "pw")("a@b.test")).toEqual({ user: "a@b.test%office", pass: "pw" });
  });
});
