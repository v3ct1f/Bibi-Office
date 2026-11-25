import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dispatchEvent, InlineRunner, type ExecDeps } from "@office/platform";
import type { EventEnvelope } from "@office/sdk";
import leads from "@office/module-leads";
import mail, { configureMail, fakeMailProvider } from "@office/module-mail";
import { setup } from "./harness.ts";

const provider = fakeMailProvider();
let h: Awaited<ReturnType<typeof setup>>;
let alice: string, bob: string, carol: string, eve: string, tA: string, tB: string, aliceId: string, bobId: string;
let exec: ExecDeps;
const as = (tok: string, t = tA) => h.client(tok, t);
const M = "/m/mail";
const seen = new Set<string>();
async function pump(tenantId: string) {
  const runner = new InlineRunner(exec, 1);
  for (let i = 0; i < 20; i++) {
    const evs = (await h.events(tenantId)).filter((e) => !seen.has(e.id));
    if (!evs.length) break;
    for (const e of evs) { seen.add(e.id); await dispatchEvent({ ...exec, runner }, e as EventEnvelope).catch(() => {}); }
  }
}
type Thread = { id: string; messageId: string; subject: string; unread: number; count: number; isStarred: boolean; hasAttachments: boolean; labels: { name: string }[]; isDraft: boolean };
const list = async (tok: string, q = "") => { const r = await as(tok).get(`${M}/threads${q}`); if (r.status !== 200) throw new Error(`threads ${r.status} ${JSON.stringify(r.body)}`); return r.body as { data: Thread[]; hasMore: boolean }; };
const subjects = async (tok: string, q = "") => (await list(tok, q)).data.map((t) => t.subject);
const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");

beforeAll(async () => {
  h = await setup([leads, mail], { mailProvider: provider });
  exec = { db: h.db, registry: h.registry, secrets: h.secrets, http: { allowPrivate: true, requireHttps: false } };
  [alice, bob, carol, eve] = await Promise.all([h.token("alice"), h.token("bob"), h.token("carol"), h.token("eve")]);
  tA = (await h.client(alice).post("/tenants", { slug: "acme", name: "Acme" })).body.id;
  tB = (await h.client(eve).post("/tenants", { slug: "globex", name: "Globex" })).body.id;
  await h.join(tA, alice, bob, ["member"]);
  await h.join(tA, alice, carol, ["viewer"]);
  aliceId = (await h.client(alice).get("/me")).body.userId;
  bobId = (await h.client(bob).get("/me")).body.userId;
});
afterAll(async () => { await h.teardown(); });

describe("mail: set up", () => {
  it("is off until the feature is turned on", async () => {
    expect((await as(alice).get(`${M}/account`)).status).toBeGreaterThanOrEqual(400);
    expect((await as(alice).post("/modules/mail/enable", {})).status).toBe(200);
    expect((await as(alice).post("/modules/leads/enable", {})).status).toBe(200);
    await h.client(eve, tB).post("/modules/mail/enable", {});
  });

  it("gives each person their own mailbox, with sample mail", async () => {
    const a = (await as(alice).get(`${M}/account`)).body;
    expect(a).toMatchObject({ available: true, account: { address: "alice@example.com", status: "active", source: "local" } });
    expect((await as(bob).get(`${M}/account`)).body.account.address).toBe("bob@example.com");
    // every role can use mail (a viewer too)
    expect((await as(carol).get(`${M}/account`)).body.account.address).toBe("carol@example.com");
    expect((await as(alice).post(`${M}/sync`, {})).body.received).toBe(5);
    expect((await as(alice).post(`${M}/sync`, {})).body.received).toBe(0); // nothing fetched twice
  });
});

describe("mail: reading", () => {
  it("lists conversations: replies join their thread, spam is kept apart, unread is counted", async () => {
    const inbox = await list(alice);
    expect(inbox.data.map((t) => t.subject).sort()).toEqual(["Big sale: 50% off everything!", "Quote for the spring order", "Welcome to your new mailbox"]);
    const quote = inbox.data.find((t) => t.subject.startsWith("Quote"))!;
    expect(quote).toMatchObject({ count: 2, unread: 2, hasAttachments: true });
    expect(await subjects(alice, "?folder=spam")).toEqual(["You have won a million!!!"]);
    expect((await as(alice).get(`${M}/unread`)).body.count).toBe(3);
    const f = (await as(alice).get(`${M}/folders`)).body.folders as { key: string; unread: number }[];
    expect(f.find((x) => x.key === "inbox")!.unread).toBe(3);
    expect(f.find((x) => x.key === "spam")!.unread).toBe(1);
  });

  it("shows a conversation oldest first, with clean HTML and attachments", async () => {
    const inbox = await list(alice);
    const quote = inbox.data.find((t) => t.subject.startsWith("Quote"))!;
    const t = (await as(alice).get(`${M}/threads/${quote.id}`)).body;
    expect(t.messages.map((m: { subject: string }) => m.subject)).toEqual(["Quote for the spring order", "Re: Quote for the spring order"]);
    const att = t.messages[1].attachments[0];
    expect(att).toMatchObject({ name: "specification.txt", contentType: "text/plain", risky: false });
    const file = (await as(alice).get(`${M}/attachments/${att.id}`)).body;
    expect(Buffer.from(file.data, "base64").toString()).toContain("Model L");

    const sale = inbox.data.find((x) => x.subject.startsWith("Big sale"))!;
    const m = (await as(alice).get(`${M}/threads/${sale.id}`)).body.messages[0];
    expect(m.bodyHtml).not.toMatch(/<script|onclick|alert/);
    expect(m.bodyHtml).toContain("data-remote-src");
    expect(m.bodyHtml).not.toMatch(/ src=/);
    expect(m.hasRemoteImages).toBe(true);
  });

  it("marks read and unread, stars, and counts follow", async () => {
    const welcome = (await list(alice)).data.find((t) => t.subject.startsWith("Welcome"))!;
    expect((await as(alice).post(`${M}/threads/action`, { ids: [welcome.id], action: "read" })).status).toBe(200);
    expect((await as(alice).get(`${M}/unread`)).body.count).toBe(2);
    await as(alice).post(`${M}/threads/action`, { ids: [welcome.id], action: "unread" });
    expect((await as(alice).get(`${M}/unread`)).body.count).toBe(3);
    await as(alice).post(`${M}/threads/action`, { ids: [welcome.id], action: "star" });
    expect(await subjects(alice, "?folder=starred")).toEqual(["Welcome to your new mailbox"]);
    await as(alice).post(`${M}/threads/action`, { ids: [welcome.id], action: "unstar" });
    expect(await subjects(alice, "?folder=starred")).toEqual([]);
  });

  it("archives, trashes, restores and deletes for good; bulk works on many at once", async () => {
    const all = (await list(alice)).data;
    const ids = all.map((t) => t.id);
    await as(alice).post(`${M}/threads/action`, { ids, action: "archive" });
    expect(await subjects(alice)).toEqual([]);
    expect((await list(alice, "?folder=archive")).data).toHaveLength(3);
    await as(alice).post(`${M}/threads/action`, { ids, action: "inbox" });
    expect((await list(alice)).data).toHaveLength(3);
    const sale = all.find((t) => t.subject.startsWith("Big sale"))!;
    await as(alice).post(`${M}/threads/action`, { ids: [sale.id], action: "trash" });
    expect(await subjects(alice, "?folder=trash")).toEqual(["Big sale: 50% off everything!"]);
    expect((await as(alice).get(`${M}/threads/${sale.id}`)).status).toBe(404); // trashed mail isn't in the normal view
    expect((await as(alice).get(`${M}/threads/${sale.id}?folder=trash`)).status).toBe(200);
    await as(alice).post(`${M}/threads/action`, { ids: [sale.id], action: "inbox" });
    expect((await list(alice)).data).toHaveLength(3);
    await as(alice).post(`${M}/threads/action`, { ids: [sale.id], action: "trash" });
    await as(alice).post(`${M}/threads/action`, { ids: [sale.id], action: "delete" });
    expect(await subjects(alice, "?folder=trash")).toEqual([]);
    expect((await list(alice)).data).toHaveLength(2);
    // delete forever only touches what is already in the trash
    const keep = (await list(alice)).data[0]!;
    await as(alice).post(`${M}/threads/action`, { ids: [keep.id], action: "delete" });
    expect((await list(alice)).data).toHaveLength(2);
  });

  it("organises with labels", async () => {
    const l = await as(alice).post(`${M}/labels`, { name: "Clients", color: "blue" });
    expect(l.status).toBe(201);
    expect((await as(alice).post(`${M}/labels`, { name: "clients" })).status).toBe(409);
    const quote = (await list(alice)).data.find((t) => t.subject.startsWith("Quote"))!;
    await as(alice).post(`${M}/threads/action`, { ids: [quote.id], action: "label", labelId: l.body.id });
    expect((await list(alice, `?label=${l.body.id}`)).data.map((t) => t.subject)).toEqual(["Quote for the spring order"]);
    expect((await list(alice)).data.find((t) => t.id === quote.id)!.labels.map((x) => x.name)).toEqual(["Clients"]);
    expect(await subjects(alice, `?q=${encodeURIComponent("label:clients")}`)).toEqual(["Quote for the spring order"]);
    const f = (await as(alice).get(`${M}/folders`)).body.labels as { name: string; unread: number }[];
    expect(f[0]).toMatchObject({ name: "Clients", unread: 1 });
    await as(alice).post(`${M}/threads/action`, { ids: [quote.id], action: "unlabel", labelId: l.body.id });
    expect(await subjects(alice, `?label=${l.body.id}`)).toEqual([]);
    expect((await as(alice).del(`${M}/labels/${l.body.id}`)).status).toBe(204);
  });

  it("searches by sender, subject, text, attachment and date", async () => {
    const s = (q: string) => subjects(alice, `?q=${encodeURIComponent(q)}`);
    expect(await s("from:carla")).toEqual(["Quote for the spring order"]);
    expect(await s("subject:welcome")).toEqual(["Welcome to your new mailbox"]);
    expect(await s("keyboard")).toEqual(["Welcome to your new mailbox"]); // words in the text
    expect(await s("has:attachment")).toEqual(["Quote for the spring order"]);
    expect(await s("filename:specification")).toEqual(["Quote for the spring order"]);
    expect(await s("is:unread from:carla")).toEqual(["Quote for the spring order"]);
    expect(await s("after:2999-01-01")).toEqual([]);
    expect((await s("before:2999-01-01")).length).toBe(2);
    expect(await s("100%_no_such_text")).toEqual([]); // % and _ are plain characters
    expect(await s("in:spam lotto")).toEqual(["You have won a million!!!"]);
    expect(await s("-from:carla welcome")).toEqual(["Welcome to your new mailbox"]);
  });
});

describe("mail: writing", () => {
  let draftId: string;

  it("saves drafts as you type, lists them, and deletes them", async () => {
    const d = await as(alice).post(`${M}/drafts`, {});
    expect(d.status).toBe(201);
    draftId = d.body.id;
    expect(d.body).toMatchObject({ isDraft: true, from: { email: "alice@example.com" } });
    const saved = await as(alice).put(`${M}/drafts/${draftId}`, { to: [{ email: "Bob@Example.com", name: "Bob" }], subject: "Lunch?", text: "Fancy lunch on Friday?" });
    expect(saved.body).toMatchObject({ subject: "Lunch?", bodyText: "Fancy lunch on Friday?", to: [{ email: "bob@example.com" }] });
    expect(await subjects(alice, "?folder=drafts")).toEqual(["Lunch?"]);
    expect((await as(alice).get(`${M}/folders`)).body.folders.find((f: { key: string }) => f.key === "drafts").total).toBe(1);
    const temp = (await as(alice).post(`${M}/drafts`, {})).body.id;
    expect((await as(alice).del(`${M}/drafts/${temp}`)).status).toBe(204);
    expect((await as(alice).put(`${M}/drafts/${temp}`, { subject: "x" })).status).toBe(404);
  });

  it("attaches files with size limits, and refuses programs", async () => {
    const ok = await as(alice).post(`${M}/drafts/${draftId}/attachments`, { name: "../menu.txt", contentType: "text/plain", data: b64("pasta") });
    expect(ok.status).toBe(201);
    expect(ok.body.name).toBe("_menu.txt"); // path characters are made harmless
    expect((await as(alice).post(`${M}/drafts/${draftId}/attachments`, { name: "setup.exe", data: b64("MZ") })).status).toBe(400);
    expect((await as(alice).post(`${M}/drafts/${draftId}/attachments`, { name: "big.pdf", data: b64(Buffer.alloc(5 * 1024 * 1024 + 10, 1)) })).status).toBeGreaterThanOrEqual(400);
    const page = await as(alice).post(`${M}/drafts/${draftId}/attachments`, { name: "page.html", contentType: "text/html", data: b64("<script>alert(1)</script>") });
    expect(page.body.contentType).toBe("application/octet-stream"); // never something a browser would run
    expect((await as(alice).del(`${M}/drafts/${draftId}/attachments/${page.body.id}`)).status).toBe(204);
  });

  it("sends, delivers to the colleague, and keeps a copy in Sent", async () => {
    const empty = (await as(alice).post(`${M}/drafts`, {})).body;
    expect((await as(alice).post(`${M}/drafts/${empty.id}/send`, {})).status).toBe(400); // nobody to send to
    await as(alice).del(`${M}/drafts/${empty.id}`);
    await as(alice).put(`${M}/drafts/${draftId}`, { to: [{ email: "not-an-address" }] });
    expect((await as(alice).post(`${M}/drafts/${draftId}/send`, {})).status).toBe(400);
    await as(alice).put(`${M}/drafts/${draftId}`, { to: [{ email: "bob@example.com", name: "Bob" }] });

    provider.failNext("send");
    const fail = await as(alice).post(`${M}/drafts/${draftId}/send`, {});
    expect(fail.status).toBe(424);
    expect(await subjects(alice, "?folder=drafts")).toEqual(["Lunch?"]); // nothing lost

    const sent = await as(alice).post(`${M}/drafts/${draftId}/send`, {});
    expect(sent.status).toBe(200);
    expect(sent.body.folder).toBe("sent");
    expect(await subjects(alice, "?folder=sent")).toEqual(["Lunch?"]);
    expect(await subjects(alice, "?folder=drafts")).toEqual([]);
    expect(provider.sent.at(-1)).toMatchObject({ subject: "Lunch?", to: [{ email: "bob@example.com" }], from: { email: "alice@example.com" } });
    expect(provider.sent.at(-1)!.files).toHaveLength(1);
    expect((await as(alice).post(`${M}/drafts/${draftId}/send`, {})).status).toBe(404); // already sent
  });

  it("the colleague receives it, replies in the same conversation, and reply-all / forward work", async () => {
    expect((await as(bob).post(`${M}/sync`, {})).body.received).toBe(6); // 5 samples + Alice's message
    const got = (await list(bob)).data.find((t) => t.subject === "Lunch?")!;
    expect(got).toMatchObject({ unread: 1, count: 1, hasAttachments: true });
    const msg = (await as(bob).get(`${M}/threads/${got.id}`)).body.messages[0];
    expect(msg).toMatchObject({ from: { email: "alice@example.com", name: "alice" }, bodyText: "Fancy lunch on Friday?" });

    const reply = await as(bob).post(`${M}/drafts`, { replyTo: msg.id });
    expect(reply.body).toMatchObject({ subject: "Re: Lunch?", to: [{ email: "alice@example.com" }], threadId: got.id });
    expect(reply.body.bodyText).toContain("> Fancy lunch on Friday?");
    await as(bob).put(`${M}/drafts/${reply.body.id}`, { text: "Sounds great!\n\n" + reply.body.bodyText });
    const rs = await as(bob).post(`${M}/drafts/${reply.body.id}/send`, {}); expect(rs.body.detail ?? rs.body.title ?? rs.status).toBe(200);
    expect((await list(bob)).data.find((t) => t.id === got.id)).toMatchObject({ count: 2 }); // the answer is in the same conversation

    expect((await as(alice).post(`${M}/sync`, {})).body.received).toBe(1);
    const back = (await list(alice)).data.find((t) => t.subject === "Re: Lunch?" || t.subject === "Lunch?")!;
    expect(back).toMatchObject({ count: 2, unread: 1 }); // threaded by the headers, not just the subject

    // reply all drops me and keeps the others
    const multi = await as(alice).post(`${M}/drafts`, {});
    await as(alice).put(`${M}/drafts/${multi.body.id}`, { to: [{ email: "bob@example.com" }, { email: "zed@other.test" }], cc: [{ email: "amy@other.test" }], subject: "Plan", text: "x" });
    await as(alice).post(`${M}/drafts/${multi.body.id}/send`, {});
    await as(bob).post(`${M}/sync`, {});
    const plan = (await list(bob)).data.find((t) => t.subject === "Plan")!;
    const planMsg = (await as(bob).get(`${M}/threads/${plan.id}`)).body.messages[0];
    const ra = await as(bob).post(`${M}/drafts`, { replyTo: planMsg.id, all: true });
    expect(ra.body.to.map((x: { email: string }) => x.email)).toEqual(["alice@example.com"]);
    expect(ra.body.cc.map((x: { email: string }) => x.email).sort()).toEqual(["amy@other.test", "zed@other.test"]);

    // forward starts a new conversation and keeps the attachments
    const lunch = (await as(bob).get(`${M}/threads/${got.id}`)).body.messages[0];
    const fw = await as(bob).post(`${M}/drafts`, { forwardOf: lunch.id });
    expect(fw.body.detail ?? fw.body.title ?? fw.body.subject).toBe("Fwd: Lunch?");
    expect(fw.body.threadId).not.toBe(got.id);
    expect(fw.body.bodyText).toContain("Forwarded message");
    expect(fw.body.attachments).toHaveLength(1);
  });

  it("adds the signature to new messages", async () => {
    expect((await as(alice).patch(`${M}/account`, { signature: "Alice\nAcme Ltd" })).body.signature).toBe("Alice\nAcme Ltd");
    const d = await as(alice).post(`${M}/drafts`, {});
    expect(d.body.bodyText).toBe("\n\n-- \nAlice\nAcme Ltd");
    await as(alice).patch(`${M}/account`, { signature: "" });
  });
});

describe("mail: privacy", () => {
  it("nobody else can read your mail: not a colleague, not another business", async () => {
    const inbox = (await list(alice)).data;
    const mine = inbox[0]!;
    expect((await as(bob).get(`${M}/threads/${mine.id}`)).status).toBe(404);
    expect((await as(bob).get(`${M}/messages/${mine.messageId}`)).status).toBe(404);
    await as(bob).post(`${M}/threads/action`, { ids: [mine.id], action: "trash" }); // has no effect on Alice's mail
    expect((await list(alice)).data.map((t) => t.id)).toContain(mine.id);
    expect((await as(bob).patch(`${M}/messages/${mine.messageId}`, { isRead: true })).status).toBe(404);
    expect((await as(bob).post(`${M}/drafts`, { replyTo: mine.messageId })).status).toBe(404);
    expect((await h.client(eve, tB).get(`${M}/threads/${mine.id}`)).status).toBe(404);
    // Alice owns the business, and still sees nothing of Bob's mail
    for (const t of (await list(bob)).data) expect((await as(alice).get(`${M}/threads/${t.id}`)).status).toBe(404);
  });

  it("is enforced by the database itself, even for a query that forgets to filter", async () => {
    const count = (user: string | null) => h.asOwner(tA, async (tx) => {
      if (user) await tx`select set_config('app.mail_user', ${user}, true)`;
      const [r] = await tx`select count(*)::int as n from mail_messages`;
      return r!.n as number;
    });
    expect(await count(null)).toBe(0); // nobody asked: nothing visible
    expect(await count(aliceId)).toBeGreaterThan(0);
    expect(await count(bobId)).toBeGreaterThan(0);
    const owners = await h.asOwner(tA, async (tx) => {
      await tx`select set_config('app.mail_user', ${bobId}, true)`;
      return (await tx`select distinct user_id from mail_messages`).map((r) => r.user_id);
    });
    expect(owners).toEqual([bobId]);
  });

  it("stores no mailbox password anywhere", async () => {
    const cols = await h.ownerSql`select column_name from information_schema.columns where table_name like 'mail\\_%' and (column_name ilike '%pass%' or column_name ilike '%secret%' or column_name ilike '%token%')`;
    expect(cols).toHaveLength(0);
  });
});

describe("mail: contacts and leads (only through shared contacts and events)", () => {
  it("shows the sender's name when they are already a contact, and can add one", async () => {
    const quote = (await list(alice)).data.find((t) => t.subject.startsWith("Quote"))!;
    const before = (await as(alice).get(`${M}/threads/${quote.id}`)).body.messages[0];
    expect(before.contact).toBeNull();
    const added = await as(alice).post(`${M}/messages/${before.id}/add-contact`, {});
    expect(added.body).toMatchObject({ created: true, name: "Carla Mendes" });
    const c = (await as(alice).get(`/contacts/${added.body.contactId}`)).body;
    expect(c).toMatchObject({ firstName: "Carla", lastName: "Mendes", email: "carla@clientco.test" });
    expect((await as(alice).get(`${M}/threads/${quote.id}`)).body.messages[0].contact).toEqual({ id: added.body.contactId, name: "Carla Mendes" });
    expect((await as(alice).post(`${M}/messages/${before.id}/add-contact`, {})).body).toMatchObject({ created: false, contactId: added.body.contactId });
  });

  it("asks Leads (by event) to add the sender as a lead, once", async () => {
    const welcome = (await list(alice)).data.find((t) => t.subject.startsWith("Welcome"))!;
    const m = (await as(alice).get(`${M}/threads/${welcome.id}`)).body.messages[0];
    expect((await as(alice).post(`${M}/messages/${m.id}/add-lead`, {})).body).toEqual({ requested: true });
    await pump(tA);
    const found = (await as(alice).get("/m/leads/leads?view=all&q=hello@office.test")).body.data;
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ email: "hello@office.test", source: "email" });
    await as(alice).post(`${M}/messages/${m.id}/add-lead`, {});
    await pump(tA);
    expect((await as(alice).get("/m/leads/leads?view=all&q=hello@office.test")).body.data).toHaveLength(1); // not twice
    const mine = (await as(alice).post(`${M}/drafts`, {})).body;
    await as(alice).put(`${M}/drafts/${mine.id}`, { to: [{ email: "bob@example.com" }] });
    await as(alice).post(`${M}/drafts/${mine.id}/send`, {});
    const sentMsg = (await list(alice, "?folder=sent")).data[0]!;
    expect((await as(alice).post(`${M}/messages/${sentMsg.messageId}/add-lead`, {})).status).toBe(400); // can't add yourself
  });
});

describe("mail: Work email link and a mail server that fails", () => {
  it("a work mailbox made for a colleague becomes their mailbox; switching it off pauses it", async () => {
    const ev = (type: string, payload: Record<string, unknown>): EventEnvelope => ({
      id: crypto.randomUUID(), tenantId: tA, type, version: 1, payload, actor: { type: "user", id: aliceId }, causationId: null,
      correlationId: crypto.randomUUID(), depth: 0, occurredAt: new Date().toISOString(),
    });
    const runner = new InlineRunner(exec, 1);
    await dispatchEvent({ ...exec, runner }, ev("workmail.mailbox.created", { id: "mbx-1", address: "Bob@Acme.test", domain: "acme.test", userId: bobId }));
    expect((await as(bob).get(`${M}/account`)).body.account).toMatchObject({ address: "bob@acme.test", source: "workmail" });
    expect((await as(bob).post(`${M}/sync`, {})).status).toBe(200);
    await dispatchEvent({ ...exec, runner }, ev("workmail.mailbox.suspended", { id: "mbx-1", reason: "by_hand", userId: bobId }));
    expect((await as(bob).get(`${M}/account`)).body.account.status).toBe("paused");
    expect((await as(bob).post(`${M}/sync`, {})).status).toBe(409);
    expect((await as(bob).post(`${M}/drafts`, {})).status).toBe(409);
    expect((await list(bob)).data.length).toBeGreaterThan(0); // old mail can still be read
    await dispatchEvent({ ...exec, runner }, ev("workmail.mailbox.resumed", { id: "mbx-1", userId: bobId }));
    expect((await as(bob).get(`${M}/account`)).body.account.status).toBe("active");
  });

  it("a mail server that doesn't answer gives a clear message and never breaks the page", async () => {
    provider.failNext("fetch");
    expect((await as(carol).post(`${M}/sync`, {})).status).toBe(424);
    provider.failNext("fetch");
    await h.ownerSql`update mail_accounts set last_synced_at = now() - interval '1 hour'`.catch(() => {});
    expect((await as(carol).get(`${M}/unread`)).status).toBe(200); // the menu badge keeps what it has
  });

  it("without a mail server set up, Mail says so", async () => {
    configureMail({ provider: null });
    expect((await as(alice).get(`${M}/account`)).body.available).toBe(false);
    expect((await as(alice).post(`${M}/sync`, {})).status).toBe(424);
    configureMail({ provider });
  });
});
