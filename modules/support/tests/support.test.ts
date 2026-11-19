import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createModuleContext, dispatchEvent, InlineRunner, loadEnabledModule, runModuleJob, systemContext, type ExecDeps } from "@office/platform";
import { withTenant } from "@office/db";
import type { EventEnvelope } from "@office/sdk";
import { MAIL, setup } from "../../../apps/api/test/harness.ts";
import support from "../src/index.ts";
import { stripQuoted } from "../src/service.ts";

let h: Awaited<ReturnType<typeof setup>>;
let alice: string, carol: string, vera: string, bob: string, tA: string, tB: string, exec: ExecDeps, carolId: string, aliceId: string, address: string;
const A = () => h.client(alice, tA);
const C = () => h.client(carol, tA);
const base = "/m/support";
const pub = async (method: "GET" | "POST", path: string, body?: unknown, slug = "acme") => {
  const r = await h.app.inject({ method, url: `/api/v1/public/${slug}/m/support${path}`, ...(body !== undefined ? { payload: body as object } : {}) });
  return { status: r.statusCode, body: r.body ? r.json() : null };
};
const seen = new Set<string>();
async function pump() {
  const runner = new InlineRunner(exec, 1);
  for (let i = 0; i < 20; i++) {
    const evs = (await h.events(tA)).filter((e) => !seen.has(e.id));
    if (!evs.length) break;
    for (const e of evs) { seen.add(e.id); await dispatchEvent({ ...exec, runner }, e as EventEnvelope); }
  }
}
const types = async () => (await h.events(tA)).map((e) => e.type).filter((t) => t.startsWith("support."));
let n = 0;
const email = (over: Record<string, unknown> = {}) => ({
  to: [address], from: { email: "grace@example.com", name: "Grace Hopper" }, subject: "Printer is on fire", text: "Help, the printer is on fire.", messageId: `<c${++n}@mail.example.com>`, ...over,
});
const byNumber = async (num: number) => (await A().get(`${base}/tickets?view=all&q=${num}`)).body.data[0];

beforeAll(async () => {
  h = await setup([support]);
  exec = { db: h.db, registry: h.registry, secrets: h.secrets, files: h.files, mail: MAIL, http: { allowPrivate: true, requireHttps: false } };
  [alice, carol, vera, bob] = await Promise.all([h.token("alice"), h.token("carol"), h.token("vera"), h.token("bob")]);
  tA = (await h.client(alice).post("/tenants", { slug: "acme", name: "Acme" })).body.id;
  tB = (await h.client(bob).post("/tenants", { slug: "beta", name: "Beta" })).body.id;
  carolId = (await h.client(carol).get("/me")).body.userId;
  aliceId = (await h.client(alice).get("/me")).body.userId;
  await h.client(vera).get("/me");
  await A().post("/members", { email: "carol@example.com", roles: ["member"] });
  await A().post("/members", { email: "vera@example.com", roles: ["viewer"] });
  expect((await A().patch("/modules/support/settings", { teamName: "Acme Help", signature: "Acme Inc." })).status).toBe(200);
  expect((await A().post("/modules/support/enable", {})).status).toBe(200);
  await h.client(bob, tB).post("/modules/support/enable", {});
  address = (await A().get(`${base}/meta`)).body.address;
});
afterAll(() => h?.teardown());

describe("email in, reply out", () => {
  let ticketId: string, number: number;
  it("an email to the inbox address opens a numbered ticket and auto-replies", async () => {
    expect(address).toMatch(/@in\.office\.test$/);
    expect((await h.inbound(email({ subject: "Fwd: RE: Printer is on fire" }))).body).toEqual({ accepted: true });
    const list = (await C().get(`${base}/tickets?view=unassigned`)).body.data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ number: 1, reference: "[#1]", subject: "Printer is on fire", status: "new", channel: "email", requesterEmail: "grace@example.com", requesterName: "Grace Hopper", priority: "normal" });
    ({ id: ticketId, number } = list[0]);
    const [ack] = await h.flushMail();
    expect(ack).toMatchObject({ to: ["grace@example.com"], subject: "[#1] Printer is on fire", replyTo: address, inReplyTo: "c1@mail.example.com", from: '"Acme Help" <no-reply@office.test>' });
    expect(ack!.text).toContain("Your reference is [#1]");
  });
  it("links the requester to a contact", async () => {
    await pump();
    const t = (await C().get(`${base}/tickets/${ticketId}`)).body;
    expect((await A().get(`/contacts/${t.contactId}`)).body).toMatchObject({ firstName: "Grace", lastName: "Hopper", email: "grace@example.com" });
    expect((await C().get(`${base}/tickets?contactId=${t.contactId}`)).body.data.map((x: { id: string }) => x.id)).toEqual([ticketId]);
  });
  it("a reply emails the customer in-thread, takes the ticket, and records the first response", async () => {
    const r = await C().post(`${base}/tickets/${ticketId}/reply`, { body: "Unplug it, we're on our way." });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "pending", assigneeId: carolId, assigneeName: "carol", firstResponseAt: expect.any(String) });
    expect(r.body.messages.map((m: { kind: string }) => m.kind)).toEqual(["customer", "reply"]);
    expect(r.body.messages[1]).toMatchObject({ authorName: "carol", body: "Unplug it, we're on our way." });
    expect(r.body.messages[0]).not.toHaveProperty("messageId");
    const [m] = await h.flushMail();
    expect(m).toMatchObject({ to: ["grace@example.com"], subject: "Re: [#1] Printer is on fire", inReplyTo: "c1@mail.example.com", references: ["c1@mail.example.com"], replyTo: address });
    expect(m!.text).toBe("Unplug it, we're on our way.\n\nAcme Inc.\n\nAcme Help · Reference [#1]");
    expect(await types()).toEqual(expect.arrayContaining(["support.ticket.created", "support.ticket.replied", "support.ticket.assigned", "support.ticket.status_changed"]));
  });
  it("the customer's answer threads by Message-ID, drops quoted text and reopens", async () => {
    const replyId = h.mailbox.sent.at(-1)!.messageId;
    await h.inbound(email({ subject: "Re: [#1] Printer is on fire", inReplyTo: `<${replyId}>`, references: [`<c1@mail.example.com>`, `<${replyId}>`],
      text: "Thanks, it's out.\n\nOn Mon, 1 Dec 2026 at 10:00, Acme Help <no-reply@office.test> wrote:\n> Unplug it" }));
    const t = (await C().get(`${base}/tickets/${ticketId}`)).body;
    expect(t.status).toBe("open");
    expect(t.messages.at(-1)).toMatchObject({ kind: "customer", body: "Thanks, it's out." });
    expect(await h.flushMail()).toHaveLength(0);   // no auto-reply on follow-ups
    expect(await types()).toContain("support.ticket.customer_replied");
  });
  it("threads by [#n] in the subject only from the same sender", async () => {
    await h.inbound(email({ subject: `Re: [#${number}] Printer`, text: "One more thing." }));
    expect((await C().get(`${base}/tickets/${ticketId}`)).body.messages.at(-1).body).toBe("One more thing.");
    await h.inbound(email({ from: { email: "mallory@example.com" }, subject: `Re: [#${number}] Printer`, text: "Let me in" }));
    const m = await byNumber(2);
    expect(m).toMatchObject({ requesterEmail: "mallory@example.com", subject: "[#1] Printer" });
    expect((await C().get(`${base}/tickets/${ticketId}`)).body.messages).toHaveLength(4);
  });
  it("ignores bounces; no auto-reply to robots or repeat senders", async () => {
    await h.flushMail();
    await h.inbound(email({ from: { email: "MAILER-DAEMON@example.com" }, subject: "Undeliverable" }));
    expect(await byNumber(3)).toBeUndefined();
    await h.inbound(email({ from: { email: "no-reply@shop.example" }, subject: "Your order" }));
    expect(await byNumber(3)).toMatchObject({ requesterEmail: "no-reply@shop.example" });
    await h.inbound(email({ from: { email: "mallory@example.com" }, subject: "Again" }));   // second ticket within the hour
    expect(await h.flushMail()).toHaveLength(0);
  });
  it("notes are internal: never emailed", async () => {
    const r = await C().post(`${base}/tickets/${ticketId}/notes`, { body: "Fire dept. called." });
    expect(r.body.messages.at(-1)).toMatchObject({ kind: "note", authorName: "carol" });
    expect(await h.flushMail()).toHaveLength(0);
  });
  it("messages cannot be edited", async () => {
    await expect(h.asOwner(tA, (tx) => tx`update support_messages set body = 'x'`)).rejects.toThrow(/cannot be changed/);
  });
});

describe("team work", () => {
  let id: string;
  it("members create tickets for a customer (e.g. from a call)", async () => {
    const r = await C().post(`${base}/tickets`, { subject: "Invoice question", requesterEmail: "Ada@Example.com", requesterName: "Ada", body: "Called about invoice 42.", priority: "high" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ channel: "internal", requesterEmail: "ada@example.com", priority: "high", status: "new" });
    expect(Date.parse(r.body.dueAt) - Date.parse(r.body.createdAt)).toBe(4 * 3_600_000);
    id = r.body.id;
    expect(await h.flushMail()).toHaveLength(0);   // no auto-reply for internal tickets
  });
  it("members take tickets; only managers assign others", async () => {
    expect((await C().patch(`${base}/tickets/${id}`, { assigneeId: aliceId })).status).toBe(403);
    expect((await C().patch(`${base}/tickets/${id}`, { assigneeId: carolId })).body.assigneeName).toBe("carol");
    expect((await A().patch(`${base}/tickets/${id}`, { assigneeId: aliceId })).body.assigneeId).toBe(aliceId);
    expect((await A().patch(`${base}/tickets/${id}`, { assigneeId: "00000000-0000-4000-8000-000000000000" })).status).toBe(422);
    expect((await C().get(`${base}/tickets?view=mine`)).body.data.map((t: { id: string }) => t.id)).not.toContain(id);
  });
  it("priority changes move the first-reply target until someone replied", async () => {
    const t = (await A().patch(`${base}/tickets/${id}`, { priority: "urgent" })).body;
    expect(Date.parse(t.dueAt) - Date.parse(t.createdAt)).toBe(3_600_000);
  });
  it("solving and reopening", async () => {
    const s = (await A().patch(`${base}/tickets/${id}`, { status: "solved" })).body;
    expect(s).toMatchObject({ status: "solved", solvedAt: expect.any(String) });
    expect((await A().get(`${base}/tickets?view=solved`)).body.data.map((t: { id: string }) => t.id)).toContain(id);
    expect((await A().patch(`${base}/tickets/${id}`, { status: "open" })).body.solvedAt).toBeNull();
    expect((await A().patch(`${base}/tickets/${id}`, { status: "new" })).status).toBe(400);
  });
  it("late first replies are flagged once and emit an event", async () => {
    await h.asOwner(tA, (tx) => tx`update support_tickets set due_at = now() - interval '1 minute', created_at = now() - interval '2 hours' where id = ${id}`);
    expect((await A().get(`${base}/counts`)).body.breached).toBe(1);
    expect(await runModuleJob(exec, tA, "support", "sla-check")).toBe(1);
    expect(await runModuleJob(exec, tA, "support", "sla-check")).toBe(0);
    expect((await h.events(tA, "support.ticket.sla_breached")).map((e) => (e.payload as { id: string }).id)).toEqual([id]);
    expect((await A().get(`${base}/tickets?view=breached`)).body.data[0]).toMatchObject({ id, overdue: true });
  });
  it("search, counts and paging", async () => {
    expect((await A().get(`${base}/tickets?view=all&q=invoice`)).body.data).toHaveLength(1);
    expect((await A().get(`${base}/tickets?view=all&q=%25`)).body.data).toHaveLength(0);
    const p1 = (await A().get(`${base}/tickets?view=all&limit=2`)).body;
    const p2 = (await A().get(`${base}/tickets?view=all&limit=2&cursor=${encodeURIComponent(p1.nextCursor)}`)).body;
    const all = (await A().get(`${base}/tickets?view=all`)).body.data;
    expect([...p1.data, ...p2.data].map((t: { id: string }) => t.id)).toEqual(all.slice(0, 4).map((t: { id: string }) => t.id));
    expect((await A().get(`${base}/tickets?cursor=nope`)).status).toBe(400);
    const c = (await C().get(`${base}/counts`)).body;
    expect(c).toMatchObject({ mine: 1, pending: 0 });
    expect((await C().get(`${base}/summary`)).body.oldestUnassigned.length).toBeGreaterThan(0);
  });
  it("workflow actions assign and set status", async () => {
    const act = h.registry.action("support.assign")!;
    await withTenant(h.db, tA, async (tx) => {
      const l = (await loadEnabledModule(tx, exec, tA, "support"))!;
      const ctx = createModuleContext(tx, systemContext(tA, "t", "workflow"), l.def, l.state);
      expect(await act.spec.run(ctx, { id, assigneeId: carolId })).toEqual({ id, assigneeId: carolId });
      expect(await h.registry.action("support.set_status")!.spec.run(ctx, { id, status: "pending" })).toEqual({ id, status: "pending" });
    });
  });
});

describe("contact form", () => {
  it("anyone can send a request; it becomes a web ticket with an auto-reply", async () => {
    expect((await pub("GET", "/form")).body).toEqual({ title: null, teamName: "Acme Help" });
    const r = await pub("POST", "/form", { name: "Linus", email: "linus@example.com", subject: "Login broken", message: "Can't log in." });
    expect(r).toMatchObject({ status: 201, body: { reference: expect.stringMatching(/^\[#\d+\]$/) } });
    expect((await h.flushMail()).map((m) => m.to[0])).toEqual(["linus@example.com"]);
    expect((await byNumber(r.body.number))).toMatchObject({ channel: "web", requesterName: "Linus" });
  });
  it("blocks bots and floods; closed form is not found", async () => {
    expect((await pub("POST", "/form", { name: "B", email: "b@example.com", subject: "s", message: "m", website: "x" })).status).toBe(400);
    for (let i = 0; i < 4; i++) expect((await pub("POST", "/form", { name: "L", email: "linus@example.com", subject: `s${i}`, message: "m" })).status).toBe(201);
    expect((await pub("POST", "/form", { name: "L", email: "linus@example.com", subject: "s", message: "m" })).status).toBe(409);
    await A().patch("/modules/support/settings", { publicForm: false });
    expect((await pub("GET", "/form")).status).toBe(404);
    expect((await pub("POST", "/form", { name: "L", email: "new@example.com", subject: "s", message: "m" })).status).toBe(404);
    expect((await A().get(`${base}/meta`)).body.formUrl).toBeNull();
    await A().patch("/modules/support/settings", { publicForm: true });
    expect((await A().get(`${base}/meta`)).body.formUrl).toBe("https://app.office.test/p/acme/support/contact");
  });
});

describe("access", () => {
  it("viewers read but cannot reply; other tenants see nothing", async () => {
    const t = (await A().get(`${base}/tickets?view=all`)).body.data[0];
    expect((await h.client(vera, tA).get(`${base}/tickets/${t.id}`)).status).toBe(403);   // viewer has no support grant by default
    expect((await h.client(bob, tB).get(`${base}/tickets/${t.id}`)).status).toBe(404);
    expect((await h.client(bob, tB).get(`${base}/tickets?view=all`)).body.data).toHaveLength(0);
    expect((await h.client(bob, tB).get(`${base}/meta`)).body.address).not.toBe(address);
  });
  it("mail to another tenant's address stays there", async () => {
    const other = (await h.client(bob, tB).get(`${base}/meta`)).body.address;
    await h.inbound(email({ to: [other], subject: "[#1] Printer is on fire", from: { email: "grace@example.com" } }));
    expect((await h.client(bob, tB).get(`${base}/tickets?view=all`)).body.data).toHaveLength(1);
    expect((await A().get(`${base}/tickets?view=all&q=1`)).body.data[0].id).toBeDefined();
  });
});

describe("quoted text", () => {
  it("keeps only the new part", () => {
    expect(stripQuoted("Hi\r\n\r\nOn Tue, Bob <b@x.com> wrote:\r\n> old")).toBe("Hi");
    expect(stripQuoted("New\n-----Original Message-----\nFrom: x")).toBe("New");
    expect(stripQuoted("> only quoted")).toBe("");
    expect(stripQuoted("From: is fine at the start\nbody")).toBe("From: is fine at the start\nbody");
  });
});
