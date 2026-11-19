import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { runDueJobs } from "@office/platform";
import support from "@office/module-support";
import { email, startMailServers } from "../../../modules/support/tests/mail-servers.ts";
import { setup } from "./harness.ts";

let h: Awaited<ReturnType<typeof setup>>;
let mail: Awaited<ReturnType<typeof startMailServers>>;
let relay: postgres.Sql;
let owner: string, mia: string, max: string, vic: string, bob: string, tA: string, tB: string;
let maxId: string, miaId: string;
const M = "/m/support";
const Own = () => h.client(owner, tA);
const Mgr = () => h.client(mia, tA);
const Max = () => h.client(max, tA);
const Vic = () => h.client(vic, tA);
const B = () => h.client(bob, tB);

let first: { id: string; number: number };
let firstCustomerMsgId: string;

const fetchMail = async () => (await Max().post(`${M}/mailbox/fetch`, {})).body;
const ticketsOf = async (q = "view=all") => (await Vic().get(`${M}/tickets?${q}`)).body;

beforeAll(async () => {
  mail = await startMailServers();
  h = await setup([support]);
  relay = postgres(h.tdb.relayUrl, { onnotice: () => {} });
  [owner, mia, max, vic, bob] = await Promise.all(["olga", "mia", "max", "vic", "bob"].map((n) => h.token(n))) as [string, string, string, string, string];
  tA = (await h.client(owner).post("/tenants", { slug: "shop", name: "Shop" })).body.id;
  tB = (await h.client(bob).post("/tenants", { slug: "other", name: "Other" })).body.id;
  for (const [t, role] of [[mia, "manager"], [max, "member"], [vic, "viewer"]] as const) {
    const me = (await h.client(t).get("/me")).body;
    await Own().post("/members", { email: me.email, roles: [role] });
  }
  maxId = (await h.client(max).get("/me")).body.userId;
  miaId = (await h.client(mia).get("/me")).body.userId;
});
afterAll(async () => { await relay.end(); await h.teardown(); await mail.stop(); });

describe("support module", () => {
  it("is off until added; roles decide who can do what; needs a mailbox to email", async () => {
    expect((await Max().get(`${M}/tickets`)).status).toBe(403);
    await Own().post("/modules/support/enable", {});
    expect((await Max().get(`${M}/config`)).body).toMatchObject({ canReply: true, canManage: false, mailbox: { configured: false } });
    expect((await Mgr().get(`${M}/config`)).body).toMatchObject({ canReply: true, canManage: true });
    expect((await Vic().get(`${M}/config`)).body).toMatchObject({ canReply: false, canManage: false });
    expect((await fetchMail()).error).toMatch(/Mailbox not set up/);
    const r = await Max().post(`${M}/tickets`, { mode: "email", email: "x@customer.test", subject: "Hi", body: "Hello" });
    expect(r.status).toBe(409);
    expect(r.body.title).toMatch(/Set up the support mailbox/);
    expect((await Vic().post(`${M}/tickets`, { mode: "log", subject: "Call", body: "x" })).status).toBe(403);
  });

  it("keeps mailbox passwords secret and tests the connection", async () => {
    expect((await Max().patch("/modules/support/settings", mail.settings)).status).toBe(403);
    expect((await Own().patch("/modules/support/settings", { ...mail.settings, address: "not-an-email" })).status).toBe(400);
    const r = await Own().patch("/modules/support/settings", mail.settings);
    expect(r.status).toBe(200);
    expect(r.body.secretsSet.sort()).toEqual(["imapPassword", "smtpPassword"]);
    expect(JSON.stringify(r.body.settings)).not.toContain(mail.pass);
    expect((await Mgr().get(`${M}/config`)).body.mailbox).toEqual({ configured: true, address: mail.user, missing: [] });
    expect((await Mgr().post(`${M}/mailbox/test`, {})).body).toEqual({ ok: true, smtp: null, imap: null, missing: [] });
    expect((await Max().post(`${M}/mailbox/test`, {})).status).toBe(403);

    await Own().patch("/modules/support/settings", { imapPassword: "wrong" });
    expect((await Mgr().post(`${M}/mailbox/test`, {})).body).toMatchObject({ ok: false, smtp: null, imap: expect.stringMatching(/user name or password/) });
    await Own().patch("/modules/support/settings", { imapPassword: mail.pass });
  });

  it("turns new email into tickets, links the customer to Contacts and keeps attachments", async () => {
    firstCustomerMsgId = "<ana-1@customer.test>";
    mail.deliver(email({ from: "ana@customer.test", fromName: "Ana Ruiz", subject: "My lamp is broken", body: "It flickers.\n\nOn Mon, someone wrote:\n> old", messageId: firstCustomerMsgId, attachment: { name: "lamp.txt", type: "text/plain", content: "photo" } }));
    mail.deliver(email({ from: "robot@customer.test", subject: "Out of office", body: "Away", headers: { "Auto-Submitted": "auto-replied" } }));
    mail.deliver(email({ from: mail.user, subject: "Our own copy", body: "x" }));
    expect(await fetchMail()).toEqual({ imported: 1, ignored: 2, error: null });
    // The same message delivered twice is only imported once.
    mail.deliver(email({ from: "ana@customer.test", fromName: "Ana Ruiz", subject: "My lamp is broken", body: "It flickers.", messageId: firstCustomerMsgId }));
    expect(await fetchMail()).toEqual({ imported: 0, ignored: 0, error: null });

    const list = await ticketsOf("view=open");
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({ number: 1, ref: "#1", subject: "My lamp is broken", status: "open", priority: "normal", requesterEmail: "ana@customer.test", requesterName: "Ana Ruiz", preview: "It flickers.", lastFrom: "customer", assigneeId: null });
    expect(list.counts).toMatchObject({ open: 1, unassigned: 1, overdue: 0 });
    first = list.data[0];

    const t = (await Vic().get(`${M}/tickets/${first.id}`)).body;
    expect(t.contact).toMatchObject({ name: "Ana Ruiz" });
    expect(t.messages).toHaveLength(1);
    expect(t.messages[0]).toMatchObject({ kind: "inbound", fromEmail: "ana@customer.test", body: "It flickers." });
    const att = t.messages[0].attachments[0];
    expect(att).toMatchObject({ name: "lamp.txt", sizeBytes: 5 });
    const file = (await Vic().get(`${M}/files/${att.id}`)).body;
    expect(Buffer.from(file.data, "base64").toString()).toBe("photo");
    const contacts = (await Own().get("/contacts?q=ana@customer.test")).body.data;
    expect(contacts).toHaveLength(1);
    expect(contacts[0].id).toBe(t.contactId);
    expect((await h.events(tA, "support.ticket.created"))[0]!.payload).toMatchObject({ number: 1, requesterEmail: "ana@customer.test" });
  });

  it("emails replies threaded under the customer's message, and threads their answers back", async () => {
    let r = await Max().post(`${M}/tickets/${first.id}/reply`, { body: "Sorry! A new one is on its way.", status: "pending" });
    expect(r.body).toMatchObject({ sent: true, error: null });
    const [out] = await mail.waitForSent(1);
    expect(out!.to).toEqual(["ana@customer.test"]);
    expect(out!.mail.subject).toBe("Re: My lamp is broken [#1]");
    expect(out!.mail.inReplyTo).toBe(firstCustomerMsgId);
    expect(out!.mail.from?.text).toContain("Shop Support");
    expect(out!.mail.text).toContain("Sorry! A new one is on its way.");
    const ourId = out!.mail.messageId!;

    let t = (await Vic().get(`${M}/tickets/${first.id}`)).body;
    expect(t).toMatchObject({ status: "pending", assigneeId: maxId });
    expect(t.firstResponseAt).not.toBeNull();
    expect(t.messages[1]).toMatchObject({ kind: "reply", sendStatus: "sent", to: ["ana@customer.test"] });

    // Ana answers from her mail app: same ticket, reopened.
    mail.deliver(email({ from: "ana@customer.test", fromName: "Ana Ruiz", subject: "Re: My lamp is broken [#1]", body: "Thanks!\n\nOn Tue, Shop Support wrote:\n> Sorry!", inReplyTo: ourId, references: [firstCustomerMsgId, ourId] }));
    // Headers lost but the [#1] tag is there, from the same person: same ticket.
    mail.deliver(email({ from: "ana@customer.test", subject: "Fwd: lamp [#1]", body: "One more thing" }));
    // Someone else using the tag gets their own ticket.
    mail.deliver(email({ from: "eve@other.test", subject: "Re: lamp [#1]", body: "Me too" }));
    expect((await fetchMail()).imported).toBe(3);

    t = (await Vic().get(`${M}/tickets/${first.id}`)).body;
    expect(t.status).toBe("open");
    expect(t.messages.map((m: { kind: string; body: string }) => [m.kind, m.body])).toEqual([
      ["inbound", "It flickers."], ["reply", "Sorry! A new one is on its way."], ["inbound", "Thanks!"], ["inbound", "One more thing"],
    ]);
    expect((await ticketsOf()).total).toBe(2);
    expect(await h.events(tA, "support.ticket.customer_replied")).toHaveLength(2);

    // A second ticket from Ana shows up in her history.
    mail.deliver(email({ from: "ana@customer.test", fromName: "Ana Ruiz", subject: "Invoice question", body: "Where is my invoice?" }));
    await fetchMail();
    const newest = (await ticketsOf("view=all&q=invoice")).data[0];
    t = (await Vic().get(`${M}/tickets/${newest.id}`)).body;
    expect(t.contactId).toBe((await Vic().get(`${M}/tickets/${first.id}`)).body.contactId);
    expect(t.otherTickets.map((o: { ref: string }) => o.ref)).toEqual(["#1"]);
  });

  it("keeps notes internal and lets the team assign, prioritise and search", async () => {
    const before = mail.sent.length;
    const n = await Max().post(`${M}/tickets/${first.id}/notes`, { body: "Check stock of lamps" });
    expect(n.status).toBe(201);
    expect(n.body).toMatchObject({ kind: "note", body: "Check stock of lamps", to: [] });
    expect(mail.sent.length).toBe(before);
    expect((await Vic().post(`${M}/tickets/${first.id}/notes`, { body: "x" })).status).toBe(403);
    expect((await Max().post(`${M}/tickets/${first.id}/notes`, { body: "  " })).status).toBe(400);

    expect((await Mgr().patch(`${M}/tickets/${first.id}`, { assigneeId: "019a0000-0000-7000-8000-000000000000" })).body.title).toMatch(/isn't a member/);
    let r = await Mgr().patch(`${M}/tickets/${first.id}`, { assigneeId: miaId, priority: "urgent" });
    expect(r.body).toMatchObject({ assigneeId: miaId, priority: "urgent" });
    expect(new Date(r.body.resolutionDue).getTime() - new Date(r.body.createdAt).getTime()).toBe(8 * 3600_000);
    expect((await Mgr().get(`${M}/tickets?view=mine`)).body.data.map((x: { number: number }) => x.number)).toEqual([1]);
    expect((await Max().get(`${M}/tickets?view=mine`)).body.data).toHaveLength(0);
    expect((await ticketsOf("view=all&q=%231")).data.map((x: { number: number }) => x.number)).toEqual([1]);
    expect((await ticketsOf("view=all&q=flickers")).data.map((x: { number: number }) => x.number)).toEqual([1]);
    expect((await ticketsOf("view=all&q=eve@")).data).toHaveLength(1);
    expect((await ticketsOf("view=all&priority=urgent")).data).toHaveLength(1);

    r = await Max().patch(`${M}/tickets/${first.id}`, { status: "solved" });
    expect(r.body.status).toBe("solved");
    expect(r.body.solvedAt).not.toBeNull();
    expect((await ticketsOf("view=solved")).data.map((x: { number: number }) => x.number)).toEqual([1]);
    expect((await Max().del(`${M}/tickets/${first.id}`)).status).toBe(403);
  });

  it("logs phone tickets, and emails new conversations started by us", async () => {
    let r = await Max().post(`${M}/tickets`, { mode: "log", name: "Tom", email: "tom@customer.test", subject: "Called about delivery", body: "Asked when the parcel arrives" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ channel: "manual", status: "open", requesterEmail: "tom@customer.test" });
    const before = mail.sent.length;
    await Max().post(`${M}/tickets/${r.body.id}/reply`, { body: "Told him tomorrow", status: "solved" });
    expect(mail.sent.length).toBe(before); // phone tickets aren't emailed

    r = await Max().post(`${M}/tickets`, { mode: "email", email: "lia@customer.test", subject: "Your order", body: "Your order is ready for pickup." });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ channel: "email", status: "pending", assigneeId: maxId });
    const sent = await mail.waitForSent(before + 1);
    expect(sent[before]!.mail.subject).toBe(`Re: Your order [#${r.body.number}]`);
    expect((await Max().post(`${M}/tickets`, { mode: "email", subject: "x", body: "y" })).body.title).toMatch(/customer's email/);
  });

  it("marks failed sends and retries them", async () => {
    const t = (await ticketsOf("view=all&q=invoice")).data[0];
    await Own().patch("/modules/support/settings", { smtpPort: 1 });
    let r = await Max().post(`${M}/tickets/${t.id}/reply`, { body: "Here it is", status: "solved" });
    expect(r.body).toMatchObject({ sent: false, error: expect.stringMatching(/refused/) });
    let d = (await Vic().get(`${M}/tickets/${t.id}`)).body;
    expect(d.status).toBe("open");
    expect(d.firstResponseAt).toBeNull();
    const failed = d.messages.at(-1);
    expect(failed).toMatchObject({ sendStatus: "failed" });
    expect((await Vic().get(`${M}/summary`)).body.failedSends).toBe(1);

    await Own().patch("/modules/support/settings", { smtpPort: mail.smtpPort });
    r = await Max().post(`${M}/tickets/${t.id}/messages/${failed.id}/retry`, {});
    expect(r.body).toEqual({ sent: true, error: null });
    expect((await Max().post(`${M}/tickets/${t.id}/messages/${failed.id}/retry`, {})).body.title).toMatch(/already sent/);
    d = (await Vic().get(`${M}/tickets/${t.id}`)).body;
    expect(d.firstResponseAt).not.toBeNull();
    expect((await Vic().get(`${M}/summary`)).body.failedSends).toBe(0);
  });

  it("saved replies fill in the customer's details", async () => {
    expect((await Max().post(`${M}/macros`, { name: "Thanks", body: "x" })).status).toBe(403);
    const m = (await Mgr().post(`${M}/macros`, { name: "Thanks", body: "Hi {{customer.firstName}}, about ticket #{{ticket.number}}: {{ticket.subject}}." })).body;
    expect((await Mgr().post(`${M}/macros`, { name: "thanks", body: "x" })).status).toBe(409);
    expect((await Max().get(`${M}/macros`)).body.map((x: { name: string }) => x.name)).toEqual(["Thanks"]);
    const r = await Max().get(`${M}/tickets/${first.id}/macros/${m.id}`);
    expect(r.body.body).toBe("Hi Ana, about ticket #1: My lamp is broken.");
    expect((await Mgr().patch(`${M}/macros/${m.id}`, { name: "Thank you" })).body.name).toBe("Thank you");
    expect((await Mgr().del(`${M}/macros/${m.id}`)).status).toBe(204);
  });

  it("response-time targets flag overdue tickets", async () => {
    const def = (await Vic().get(`${M}/targets`)).body;
    expect(def.find((x: { priority: string }) => x.priority === "normal")).toEqual({ priority: "normal", firstResponseMin: 480, resolutionMin: 2880 });
    const body = def.map((x: { priority: string }) => (x.priority === "normal" ? { priority: "normal", firstResponseMin: 30, resolutionMin: 120 } : x));
    expect((await Max().put(`${M}/targets`, body)).status).toBe(403);
    expect((await Mgr().put(`${M}/targets`, body.map((x: { priority: string }) => (x.priority === "low" ? { ...x, firstResponseMin: 100, resolutionMin: 50 } : x)))).body.title).toMatch(/can't be shorter/);
    expect((await Mgr().put(`${M}/targets`, body.slice(1))).status).toBe(400);
    expect((await Mgr().put(`${M}/targets`, body)).status).toBe(200);

    // Eve's ticket (normal, never answered) was created 45 minutes ago.
    const eve = (await ticketsOf("view=all&q=eve@")).data[0];
    await h.asOwner(tA, (tx) => tx`update support_tickets set created_at = now() - interval '45 minutes' where id = ${eve.id}`);
    await Mgr().put(`${M}/targets`, body); // due dates follow created_at
    const over = (await ticketsOf("view=overdue")).data;
    expect(over.map((x: { id: string }) => x.id)).toEqual([eve.id]);
    expect(over[0].overdue).toEqual({ firstResponse: true, resolution: false });
    expect((await Vic().get(`${M}/summary`)).body).toMatchObject({ overdue: 1 });
  });

  it("fetches mail every minute in the background", async () => {
    mail.deliver(email({ from: "zoe@customer.test", subject: "Job test", body: "Hello from Zoe" }));
    await relay`update module_job_state set next_run_at = now()`;
    expect(await runDueJobs(relay, { db: h.db, registry: h.registry, secrets: h.secrets })).toBeGreaterThanOrEqual(2);
    expect((await ticketsOf("view=all&q=zoe")).data).toHaveLength(1);
  });

  it("keeps companies apart, and keeps data when switched off and on", async () => {
    await h.client(bob, tB).post("/modules/support/enable", {});
    expect((await B().get(`${M}/tickets?view=all`)).body.total).toBe(0);
    expect((await B().get(`${M}/tickets/${first.id}`)).status).toBe(404);
    expect((await B().patch(`${M}/tickets/${first.id}`, { status: "open" })).status).toBe(404);

    await Own().post("/modules/support/disable", {});
    expect((await Max().get(`${M}/tickets`)).status).toBe(403);
    await Own().post("/modules/support/enable", {});
    expect((await ticketsOf()).total).toBeGreaterThanOrEqual(5);
    expect((await Mgr().del(`${M}/tickets/${first.id}`)).status).toBe(204);
    expect((await Vic().get(`${M}/tickets/${first.id}`)).status).toBe(404);
  });
});
