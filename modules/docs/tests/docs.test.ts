import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createModuleContext, loadEnabledModule, runModuleJob, systemContext, type ExecDeps } from "@office/platform";
import { withTenant } from "@office/db";
import { MAIL, setup } from "../../../apps/api/test/harness.ts";
import docs from "../src/index.ts";
import { blocks, merge } from "../src/render.ts";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
let h: Awaited<ReturnType<typeof setup>>;
let alice: string, dave: string, vera: string, bob: string, tA: string, tB: string, exec: ExecDeps;
let grace: string, tpl: string;
const base = "/m/docs";
const c = (t: string) => h.client(t, tA);
const pub = async (method: "GET" | "POST", path: string, body?: unknown) => {
  const r = await h.app.inject({ method, url: `/api/v1/public/acme/m/docs${path}`, headers: { "user-agent": "vitest" }, ...(body !== undefined ? { payload: body as object } : {}) });
  return { status: r.statusCode, body: r.headers["content-type"]?.includes("json") ? r.json() : r.rawPayload, headers: r.headers };
};
/** Signing links in the emails sent since the last call, by recipient. */
const links = async () => {
  const out: Record<string, { id: string; token: string; subject: string; text: string }> = {};
  for (const m of await h.flushMail()) {
    const x = /\/p\/acme\/docs\/sign\/([0-9a-f-]{36})#([\w-]{43})/.exec(m.text);
    out[m.to[0]!] = { id: x?.[1] ?? "", token: x?.[2] ?? "", subject: m.subject, text: m.text };
  }
  return out;
};

beforeAll(async () => {
  h = await setup([docs]);
  exec = { db: h.db, registry: h.registry, secrets: h.secrets, files: h.files, mail: MAIL, http: { allowPrivate: true, requireHttps: false } };
  [alice, dave, vera, bob] = await Promise.all(["alice", "dave", "vera", "bob"].map((u) => h.token(u))) as [string, string, string, string];
  tA = (await h.client(alice).post("/tenants", { slug: "acme", name: "Acme" })).body.id;
  tB = (await h.client(bob).post("/tenants", { slug: "beta", name: "Beta" })).body.id;
  for (const t of [dave, vera]) await h.client(t).get("/me");
  await c(alice).post("/members", { email: "dave@example.com", roles: ["member"] });
  await c(alice).post("/members", { email: "vera@example.com", roles: ["viewer"] });
  await c(alice).patch("/modules/docs/settings", { senderName: "Acme Studio" });
  expect((await c(alice).post("/modules/docs/enable", {})).status).toBe(200);
  await h.client(bob, tB).post("/modules/docs/enable", {});
  const co = (await c(alice).post("/companies", { name: "Hopper Labs" })).body.id;
  grace = (await c(alice).post("/contacts", { firstName: "Grace", lastName: "Hopper", email: "Grace@Example.com", companyId: co })).body.id;
  await h.flushMail();
});
afterAll(() => h?.teardown());

describe("body format and merge fields", () => {
  it("parses headings, paragraphs and bullets; values can't inject fields", () => {
    expect(blocks("# T\n\nline one\nline two\n\n- a\n- b\n## S")).toEqual([
      { kind: "h1", text: "T" }, { kind: "p", text: "line one line two" }, { kind: "ul", items: ["a", "b"] }, { kind: "h2", text: "S" },
    ]);
    expect(merge("Hi {{ contact.name }}, {{x}}", { "contact.name": "{{x}}" })).toEqual({ text: "Hi { {x}}, {{x}}", missing: ["x"] });
  });
});

describe("templates", () => {
  it("seeds a sample template and lists its fields", async () => {
    const t = (await c(dave).get(`${base}/templates`)).body.data;
    expect(t).toHaveLength(1);
    expect(t[0].fields).toEqual(["contact.name", "today", "org.name", "scope"]);
    tpl = t[0].id;
  });
  it("admins manage templates; names are unique", async () => {
    expect((await c(dave).post(`${base}/templates`, { name: "NDA", title: "NDA", body: "x" })).status).toBe(403);
    const r = await c(alice).post(`${base}/templates`, { name: "NDA", title: "NDA with {{company.name}}", body: "# NDA\n\n{{company.name}} keeps things secret." });
    expect(r.status).toBe(201);
    expect((await c(alice).post(`${base}/templates`, { name: "nda", title: "x", body: "x" })).status).toBe(409);
  });
});

describe("sending and signing", () => {
  let doc: string;
  it("creates a draft from a template with contact fields; missing fields block sending", async () => {
    const r = await c(dave).post(`${base}/documents`, { templateId: tpl, contactId: grace });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ number: 1, title: "Agreement with Grace Hopper", status: "draft", missing: ["scope"], unresolved: ["scope"] });
    expect(r.body.body).toContain("between Acme Studio and Grace Hopper");
    expect(r.body.signers).toMatchObject([{ name: "Grace Hopper", email: "grace@example.com", status: "waiting" }]);
    doc = r.body.id;
    const s = await c(dave).post(`${base}/documents/${doc}/send`, {});
    expect(s.status).toBe(422);
    expect(s.body.title).toContain("scope");
  });
  it("edits the draft, adds a second signer in order, and sends", async () => {
    const d = (await c(dave).get(`${base}/documents/${doc}`)).body;
    const p = await c(dave).patch(`${base}/documents/${doc}`, {
      body: d.body.replace("{{scope}}", "Website redesign"), inOrder: true,
      signers: [{ name: "Grace Hopper", email: "grace@example.com" }, { name: "Alice Owner", email: "alice@acme.test" }],
    });
    expect(p.body.unresolved).toEqual([]);
    const s = await c(dave).post(`${base}/documents/${doc}/send`, {});
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ status: "sent", contentHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(s.body.signers.map((x: { status: string }) => x.status)).toEqual(["pending", "waiting"]);
    const m = await links();
    expect(Object.keys(m)).toEqual(["grace@example.com"]);
    expect(m["grace@example.com"]!.subject).toBe("Please sign: Agreement with Grace Hopper");
    expect(m["grace@example.com"]!.text).toContain("Acme Studio has sent you a document to sign");
    expect((await h.events(tA, "docs.document.sent")).length).toBe(1);
  });
  it("a sent document can't be edited, even directly in the database", async () => {
    expect((await c(dave).patch(`${base}/documents/${doc}`, { title: "Changed" })).status).toBe(409);
    await expect(h.asOwner(tA, (tx) => tx`update docs_documents set body = 'changed' where id = ${doc}`)).rejects.toThrow(/cannot be edited/);
    await expect(h.asOwner(tA, (tx) => tx`delete from docs_events`)).rejects.toThrow(/append-only/);
  });
  let g: { id: string; token: string };
  it("reminders rotate the link; old links stop working", async () => {
    expect((await c(dave).post(`${base}/documents/${doc}/remind`, {})).status).toBe(409);   // just sent
    await h.asOwner(tA, (tx) => tx`update docs_signers set last_sent_at = now() - interval '2 hours' where document_id = ${doc}`);
    const before = (await c(dave).get(`${base}/documents/${doc}`)).body;
    expect(before.status).toBe("sent");
    // re-read the first link: it is not stored, so get a fresh one by reminding
    expect((await c(dave).post(`${base}/documents/${doc}/remind`, {})).status).toBe(200);
    const m = await links();
    expect(m["grace@example.com"]!.subject).toBe("Reminder: Please sign: Agreement with Grace Hopper");
    g = m["grace@example.com"]!;
    expect((await pub("POST", `/sign/${g.id}/open`, { token: "x".repeat(43) })).status).toBe(404);
  });
  it("the signer opens the page (recorded once) and signs", async () => {
    const o = await pub("POST", `/sign/${g.id}/open`, { token: g.token });
    expect(o.status).toBe(200);
    expect(o.body).toMatchObject({ canSign: true, signer: { name: "Grace Hopper", status: "viewed" }, document: { sender: "Acme Studio", status: "sent" } });
    expect(o.body.signers).toEqual([{ name: "Grace Hopper", status: "viewed", me: true }, { name: "Alice Owner", status: "waiting", me: false }]);
    expect(o.body.document.body).toContain("Website redesign");
    await pub("POST", `/sign/${g.id}/open`, { token: g.token });
    expect((await h.events(tA, "docs.document.viewed")).length).toBe(1);

    expect((await pub("POST", `/sign/${g.id}/sign`, { token: g.token, name: "Grace Hopper" })).status).toBe(400);   // no consent
    expect((await pub("POST", `/sign/${g.id}/sign`, { token: g.token, name: "Grace Hopper", agree: true, signature: "data:image/png;base64,AAAA" })).status).toBe(400);
    const s = await pub("POST", `/sign/${g.id}/sign`, { token: g.token, name: "Grace B. Hopper", agree: true, signature: PNG });
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ canSign: false, signer: { status: "signed" } });
    expect((await pub("POST", `/sign/${g.id}/sign`, { token: g.token, name: "Again", agree: true })).status).toBe(409);
    await expect(h.asOwner(tA, (tx) => tx`update docs_signers set signed_name = 'forged' where id = ${g.id}`)).rejects.toThrow(/cannot be changed/);
  });
  it("then the next signer gets their link; when all sign the document completes", async () => {
    const m = await links();
    expect(Object.keys(m)).toEqual(["alice@acme.test"]);
    const a = m["alice@acme.test"]!;
    const s = await pub("POST", `/sign/${a.id}/sign`, { token: a.token, name: "Alice Owner", agree: true });
    expect(s.body.document).toMatchObject({ status: "completed" });
    const done = await links();
    expect(Object.keys(done).sort()).toEqual(["alice@acme.test", "grace@example.com"]);
    expect(done["grace@example.com"]!.subject).toBe("Signed by everyone: Agreement with Grace Hopper");
    expect((await h.events(tA, "docs.document.completed")).length).toBe(1);
    const d = (await c(dave).get(`${base}/documents/${doc}`)).body;
    expect(d.trail.map((e: { kind: string }) => e.kind)).toEqual(["created", "sent", "reminded", "viewed", "signed", "signed", "completed"]);
    expect(d.trail.find((e: { kind: string }) => e.kind === "viewed")).toMatchObject({ who: "grace@example.com", ip: expect.any(String) });
    expect(d.signers[0]).toMatchObject({ signedName: "Grace B. Hopper", hasSignatureImage: true });
    expect(d.signers[0]).not.toHaveProperty("tokenHash");
    // Grace downloads the signed PDF with her new link
    const pdf = await pub("GET", `/sign/${done["grace@example.com"]!.id}/pdf?token=${done["grace@example.com"]!.token}`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    const parsed = await PDFDocument.load(pdf.body as Buffer);
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(2);
    expect(parsed.getTitle()).toBe("Agreement with Grace Hopper");
    const team = await c(dave).get(`${base}/documents/${doc}/pdf`);
    expect(team.headers["content-disposition"]).toContain("signed-1-Agreement_with_Grace_Hopper.pdf");
  });
});

describe("decline, cancel, expire, access", () => {
  const draft = (signers: { name: string; email: string }[], who = dave) =>
    c(who).post(`${base}/documents`, { title: "Quote approval", body: "Please approve.", signers }).then((r) => r.body.id as string);
  it("a signer can decline with a reason", async () => {
    const id = await draft([{ name: "Ken", email: "ken@example.com" }, { name: "Lin", email: "lin@example.com" }]);
    await c(dave).post(`${base}/documents/${id}/send`, {});
    const m = await links();
    expect(Object.keys(m).sort()).toEqual(["ken@example.com", "lin@example.com"]);   // parallel
    const k = m["ken@example.com"]!;
    expect((await pub("POST", `/sign/${k.id}/decline`, { token: k.token, reason: "" })).status).toBe(400);
    const r = await pub("POST", `/sign/${k.id}/decline`, { token: k.token, reason: "Price too high" });
    expect(r.body).toMatchObject({ canSign: false, document: { status: "declined" } });
    const l = m["lin@example.com"]!;
    expect((await pub("POST", `/sign/${l.id}/sign`, { token: l.token, name: "Lin", agree: true })).status).toBe(409);
    expect((await h.events(tA, "docs.document.declined")).at(-1)!.payload).toMatchObject({ signer: "ken@example.com", reason: "Price too high" });
  });
  it("the sender or an admin can cancel; links die and signers are told", async () => {
    const id = await draft([{ name: "Max", email: "max@example.com" }], alice);
    await c(alice).post(`${base}/documents/${id}/send`, {});
    const m = (await links())["max@example.com"]!;
    expect((await c(dave).post(`${base}/documents/${id}/void`, { reason: "Wrong" })).status).toBe(403);
    expect((await c(alice).post(`${base}/documents/${id}/void`, { reason: "Wrong price" })).body.status).toBe("voided");
    expect((await links())["max@example.com"]!.subject).toBe("Cancelled: Quote approval");
    expect((await pub("POST", `/sign/${m.id}/open`, { token: m.token })).status).toBe(404);
  });
  it("expires unsigned documents after the signing window", async () => {
    const id = await draft([{ name: "Nia", email: "nia@example.com" }]);
    await c(dave).post(`${base}/documents/${id}/send`, { expiresInDays: 3 });
    const n = (await links())["nia@example.com"]!;
    await h.asOwner(tA, (tx) => tx`update docs_documents set expires_at = now() - interval '1 minute' where id = ${id}`);
    expect((await pub("POST", `/sign/${n.id}/sign`, { token: n.token, name: "Nia", agree: true })).status).toBe(409);
    expect(await runModuleJob(exec, tA, "docs", "expire")).toBe(1);
    expect((await c(dave).get(`${base}/documents/${id}`)).body.status).toBe("expired");
  });
  it("lists and searches; viewers and other tenants are kept out", async () => {
    const all = (await c(dave).get(`${base}/documents`)).body.data;
    expect(all.map((d: { number: number }) => d.number)).toEqual([4, 3, 2, 1]);
    expect((await c(dave).get(`${base}/documents?status=completed`)).body.data).toHaveLength(1);
    expect((await c(dave).get(`${base}/documents?q=ken@example`)).body.data).toHaveLength(1);
    expect((await c(dave).get(`${base}/documents?q=1`)).body.data[0].number).toBe(1);
    expect((await c(vera).get(`${base}/documents`)).status).toBe(403);
    expect((await h.client(bob, tB).get(`${base}/documents/${all[0].id}`)).status).toBe(404);
    const other = await h.app.inject({ method: "POST", url: `/api/v1/public/beta/m/docs/sign/${all[0].id}/open`, payload: { token: "a".repeat(43) } });
    expect(other.statusCode).toBe(404);
  });
});

describe("workflows", () => {
  it("send a template to a contact", async () => {
    const nda = (await c(alice).get(`${base}/templates`)).body.data.find((t: { name: string }) => t.name === "NDA").id;
    await withTenant(h.db, tA, async (tx) => {
      const l = (await loadEnabledModule(tx, exec, tA, "docs"))!;
      const ctx = createModuleContext(tx, systemContext(tA, "t", "workflow"), l.def, l.state);
      expect(await h.registry.action("docs.send_template")!.spec.run(ctx, { templateId: nda, contactId: grace })).toMatchObject({ number: 5, status: "sent" });
    });
    const m = await links();
    expect(m["grace@example.com"]!.subject).toBe("Please sign: NDA with Hopper Labs");
  });
});
