import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { check, fetchNew, isPrivateAddress, send, type Mailbox } from "../src/mail.ts";
import { cleanSubject, parseIncoming, renderTemplate, stripQuoted, textToHtml, ticketToken } from "../src/parse.ts";
import { email, startMailServers } from "./mail-servers.ts";

describe("parsing", () => {
  it("keeps only the new part of a reply", () => {
    expect(stripQuoted("Thanks, that worked!\n\nOn Mon, 3 Mar 2026 at 10:00, Shop <help@shop.test> wrote:\n> Try restarting it")).toBe("Thanks, that worked!");
    expect(stripQuoted("Gracias\n\nEl lun, 3 mar 2026 a las 10:00, Tienda escribió:\n> hola")).toBe("Gracias");
    expect(stripQuoted("Ok\r\n\r\nFrom: Shop\r\nSent: Monday\r\nSubject: x\r\n\r\nold")).toBe("Ok");
    expect(stripQuoted("> only a quote")).toBe("> only a quote");
  });
  it("finds ticket numbers and cleans subjects", () => {
    expect(ticketToken("Re: Broken lamp [#42]")).toBe(42);
    expect(ticketToken("Broken lamp")).toBeNull();
    expect(cleanSubject("RE: Fwd: Broken lamp [#42]")).toBe("Broken lamp");
    expect(cleanSubject("Re:  ")).toBe("(no subject)");
  });
  it("fills templates and escapes HTML", () => {
    expect(renderTemplate("Hi {{customer.firstName}}, about #{{ticket.number}} {{x.y}}", { "customer.firstName": "Ana", "ticket.number": "7" })).toBe("Hi Ana, about #7 {{x.y}}");
    expect(textToHtml("<b>1 & 2</b>\nok")).toContain("&lt;b&gt;1 &amp; 2&lt;/b&gt;<br>ok");
  });
  it("reads headers, attachments and spots auto-replies", async () => {
    const m = await parseIncoming(email({
      from: "Ana@Customer.test", fromName: "Ana Ruiz", subject: "Re: Order [#3]", body: "Hello", inReplyTo: "<a@shop.test>", references: ["<z@shop.test>", "<a@shop.test>"],
      attachment: { name: "photo.txt", type: "text/plain", content: "pixels" },
    }));
    expect(m).toMatchObject({ fromEmail: "ana@customer.test", fromName: "Ana Ruiz", inReplyTo: "<a@shop.test>", references: ["<z@shop.test>", "<a@shop.test>"], body: "Hello", autoReply: false });
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments[0]!.content.toString()).toBe("pixels");
    expect((await parseIncoming(email({ from: "a@b.test", subject: "Out of office", body: "Away", headers: { "Auto-Submitted": "auto-replied" } }))).autoReply).toBe(true);
    expect((await parseIncoming(email({ from: "MAILER-DAEMON@b.test", subject: "Undelivered", body: "x" }))).autoReply).toBe(true);
  });
  it("knows private addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"]) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "2a00:1450::1"]) expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe("mailbox connections", () => {
  let s: Awaited<ReturnType<typeof startMailServers>>;
  let mb: Mailbox;
  beforeAll(async () => {
    s = await startMailServers();
    mb = {
      address: s.user, fromName: "Shop Support", folder: "INBOX",
      smtp: { host: "127.0.0.1", port: s.smtpPort, security: "none", user: s.user, pass: s.pass },
      imap: { host: "127.0.0.1", port: s.imapPort, security: "none", user: s.user, pass: s.pass },
    };
  });
  afterAll(async () => { await s.stop(); });

  it("checks both connections and explains failures", async () => {
    expect(await check(mb)).toEqual({ smtp: null, imap: null });
    const bad = await check({ ...mb, smtp: { ...mb.smtp, pass: "nope" }, imap: { ...mb.imap, pass: "nope" }, folder: "INBOX" });
    expect(bad.smtp).toMatch(/user name or password/);
    expect(bad.imap).toMatch(/user name or password/);
    expect((await check({ ...mb, folder: "Nope" })).imap).toMatch(/folder/);
    expect((await check({ ...mb, smtp: { ...mb.smtp, port: 1 } })).smtp).toMatch(/refused/);
  });

  it("fetches only new mail, remembering where it stopped", async () => {
    s.deliver(email({ from: "a@customer.test", subject: "One", body: "1" }));
    let r = await fetchNew(mb, { uidValidity: null, lastUid: 0 });
    expect(r.messages).toHaveLength(1);
    const first = r;
    s.deliver(email({ from: "a@customer.test", subject: "Two", body: "2" }));
    s.deliver(email({ from: "a@customer.test", subject: "Three", body: "3" }));
    r = await fetchNew(mb, first);
    expect((await Promise.all(r.messages.map((m) => parseIncoming(m.raw)))).map((m) => m.subject)).toEqual(["Two", "Three"]);
    expect((await fetchNew(mb, r)).messages).toEqual([]);
  });

  it("sends threaded replies", async () => {
    await send(mb, { to: ["ana@customer.test"], subject: "Re: Lamp [#1]", text: "Fixed", html: textToHtml("Fixed"), messageId: "<r1@shop.test>", inReplyTo: "<c1@customer.test>", references: ["<c1@customer.test>"] });
    const [m] = await s.waitForSent(1);
    expect(m!.to).toEqual(["ana@customer.test"]);
    expect(m!.mail.messageId).toBe("<r1@shop.test>");
    expect(m!.mail.inReplyTo).toBe("<c1@customer.test>");
    expect(m!.mail.from?.text).toContain("Shop Support");
  });
});
