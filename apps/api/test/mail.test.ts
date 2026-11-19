import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineModule, publicRoute, route, type InboundMail } from "@office/sdk";
import { normalizeInbound, htmlToText } from "@office/platform";
import { setup } from "./harness.ts";

const received: { tenantId: string; mail: InboundMail }[] = [];
const mailer = defineModule({
  manifest: {
    key: "mailer", name: "Mailer", version: "1.0.0", office: "^1.0",
    permissions: { declares: [{ key: "mailer:send", label: "Send" }], requires: ["core:mail.send"] },
    settings: { type: "object", properties: { publicOn: { type: "boolean", default: true } } },
  },
  routes: [
    route({ method: "POST", path: "/send", permission: "mailer:send", body: z.object({ to: z.union([z.string(), z.array(z.string())]), subject: z.string(), inReplyTo: z.string().optional() }),
      handler: (ctx, { body }) => ctx.mail.send({ to: body.to, subject: body.subject, text: `Hi from ${ctx.mail.appUrl}`, fromName: "Acme \"Desk\"", ...(body.inReplyTo ? { inReplyTo: body.inReplyTo } : {}) }) }),
    route({ method: "POST", path: "/fail", permission: "mailer:send",
      handler: async (ctx) => { await ctx.mail.send({ to: "x@example.com", subject: "rolled back", text: "." }); throw new Error("boom"); } }),
    route({ method: "GET", path: "/address", permission: "mailer:send", handler: async (ctx) => ({ address: await ctx.mail.inboundAddress() }) }),
  ],
  publicRoutes: [publicRoute({ method: "POST", path: "/ping", body: z.object({ email: z.string() }), handler: (ctx, { body }) => ctx.mail.send({ to: body.email, subject: "Thanks", text: "We got it" }) })],
  inboundMail: async (ctx, mail) => { received.push({ tenantId: ctx.tenantId, mail }); },
});
const nomail = defineModule({
  manifest: { key: "nomail", name: "No mail", version: "1.0.0", office: "^1.0", permissions: { declares: [{ key: "nomail:x", label: "X" }] } },
  routes: [route({ method: "POST", path: "/send", permission: "nomail:x", handler: (ctx) => ctx.mail.send({ to: "a@example.com", subject: "s", text: "t" }) })],
});

let h: Awaited<ReturnType<typeof setup>>;
let alice: string, bob: string, tA: string, tB: string;
beforeAll(async () => {
  h = await setup([mailer, nomail]);
  [alice, bob] = await Promise.all([h.token("alice"), h.token("bob")]);
  tA = (await h.client(alice).post("/tenants", { slug: "acme", name: "Acme" })).body.id;
  tB = (await h.client(bob).post("/tenants", { slug: "beta", name: "Beta" })).body.id;
  for (const [u, t] of [[alice, tA], [bob, tB]] as const) {
    await h.client(u, t).post("/modules/mailer/enable", {});
    await h.client(u, t).post("/modules/nomail/enable", {});
  }
});
afterAll(() => h?.teardown());

describe("outbound mail", () => {
  it("queues in the request tx and the worker sends it once", async () => {
    const r = await h.client(alice, tA).post("/m/mailer/send", { to: ["Ada@Example.com", "ada@example.com", "bo@example.com"], subject: "Hello\r\nBcc: evil@x.com" });
    expect(r.status).toBe(200);
    expect(r.body.messageId).toMatch(/^[0-9a-f-]+@office\.test$/);
    const sent = await h.flushMail();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: ["ada@example.com", "bo@example.com"], subject: "Hello Bcc: evil@x.com", text: "Hi from https://app.office.test", from: '"Acme Desk" <no-reply@office.test>' });
    expect(await h.flushMail()).toHaveLength(0);
  });
  it("threads replies", async () => {
    await h.client(alice, tA).post("/m/mailer/send", { to: "ada@example.com", subject: "Re", inReplyTo: "<abc@x.y>" });
    expect((await h.flushMail())[0]).toMatchObject({ inReplyTo: "abc@x.y" });
  });
  it("nothing is sent when the transaction rolls back", async () => {
    expect((await h.client(alice, tA).post("/m/mailer/fail", {})).status).toBe(500);
    expect(await h.flushMail()).toHaveLength(0);
  });
  it("validates recipients", async () => {
    for (const to of ["nope", "a@b", "x@y.com, z@w.com", "<a@b.com>"]) expect((await h.client(alice, tA).post("/m/mailer/send", { to, subject: "s" })).status).toBe(400);
    expect((await h.client(alice, tA).post("/m/mailer/send", { to: [], subject: "s" })).status).toBe(400);
  });
  it("requires core:mail.send in the manifest", async () => {
    expect((await h.client(alice, tA).post("/m/nomail/send", {})).status).toBe(403);
  });
  it("public routes may send", async () => {
    const r = await h.app.inject({ method: "POST", url: "/api/v1/public/acme/m/mailer/ping", payload: { email: "visitor@example.com" } });
    expect(r.statusCode).toBe(200);
    expect((await h.flushMail()).map((m) => m.to[0])).toEqual(["visitor@example.com"]);
  });
  it("retries with backoff, then fails", async () => {
    await h.client(alice, tA).post("/m/mailer/send", { to: "ada@example.com", subject: "flaky" });
    const real = h.mailbox.send.bind(h.mailbox);
    h.mailbox.send = async () => { throw new Error("smtp down"); };
    try {
      for (let i = 0; i < 6; i++) await h.flushMail();
    } finally { h.mailbox.send = real; }
    const [row] = await h.relay`select status, attempts, last_error from mail_outbox where subject = 'flaky'`;
    expect(row).toMatchObject({ status: "failed", attempts: 6, last_error: "smtp down" });
    expect(await h.flushMail()).toHaveLength(0);
  });
  it("apps cannot read other tenants' outbox", async () => {
    const rows = await h.appSql.begin(async (tx) => { await tx`select set_config('app.tenant_id', ${tB}, true)`; return tx`select * from mail_outbox`; });
    expect(rows).toHaveLength(0);
  });
});

describe("inbound mail", () => {
  let addrA: string;
  it("gives each tenant module a stable address", async () => {
    addrA = (await h.client(alice, tA).get("/m/mailer/address")).body.address;
    expect(addrA).toMatch(/^[0-9a-f]{24}@in\.office\.test$/);
    expect((await h.client(alice, tA).get("/m/mailer/address")).body.address).toBe(addrA);
    expect((await h.client(bob, tB).get("/m/mailer/address")).body.address).not.toBe(addrA);
  });
  const msg = (over: Record<string, unknown> = {}) => ({
    to: [`Support <${addrA}>`], from: { email: "Cust@Example.com", name: "Cust" }, subject: "Help", text: "It broke", messageId: "<m1@mail.example.com>", ...over,
  });
  it("rejects a bad secret", async () => {
    expect((await h.inbound(msg(), "wrong")).status).toBe(401);
    expect(received).toHaveLength(0);
  });
  it("routes to the module once per Message-ID", async () => {
    expect((await h.inbound(msg())).body).toEqual({ accepted: true });
    expect((await h.inbound(msg())).body).toEqual({ accepted: true, duplicate: true });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ tenantId: tA, mail: { messageId: "m1@mail.example.com", subject: "Help", text: "It broke", from: { email: "Cust@Example.com" } } });
  });
  it("accepts plus-addressing and derives text from HTML", async () => {
    const [local, dom] = addrA.split("@");
    await h.inbound(msg({ to: [`${local}+abc@${dom}`], messageId: "m2@x", text: "", html: "<p>Hello<br>there</p><script>x()</script>" }));
    expect(received.at(-1)!.mail.text).toBe("Hello\nthere");
  });
  it("ignores unknown recipients and disabled modules without retry", async () => {
    expect((await h.inbound(msg({ to: ["nobody@in.office.test"], messageId: "m3@x" }))).body).toMatchObject({ accepted: false });
    expect((await h.inbound(msg({ to: ["aaaaaaaaaaaaaaaaaaaaaaaa@in.office.test"], messageId: "m3@x" }))).body).toMatchObject({ accepted: false });
    await h.client(alice, tA).post("/modules/mailer/disable", {});
    expect((await h.inbound(msg({ messageId: "m4@x" }))).body).toMatchObject({ accepted: false, reason: "module_disabled" });
    await h.client(alice, tA).post("/modules/mailer/enable", {});
  });
  it("rejects malformed payloads", async () => {
    expect((await h.inbound({ hello: 1 })).status).toBe(400);
  });
  it("accepts Postmark's format", () => {
    const m = normalizeInbound({
      FromFull: { Email: "a@b.com", Name: "A" }, ToFull: [{ Email: "k@in.x" }], CcFull: [], Subject: "S", TextBody: "T", MessageID: "pm-id",
      Headers: [{ Name: "Message-ID", Value: "<real@b.com>" }, { Name: "In-Reply-To", Value: "<prev@office.test>" }, { Name: "References", Value: "<r1@x> <prev@office.test>" }],
    });
    expect(m).toMatchObject({ to: ["k@in.x"], messageId: "real@b.com", inReplyTo: "prev@office.test", references: ["r1@x", "prev@office.test"] });
    expect(htmlToText("<style>a{}</style>a &amp; b&nbsp;&lt;c&gt;")).toBe("a & b <c>");
  });
});
