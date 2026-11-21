import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { dispatchEvent, InlineRunner, runDueJobs, type ExecDeps } from "@office/platform";
import type { EventEnvelope } from "@office/sdk";
import docs from "@office/module-docs";
import hr from "@office/module-hr";
import { renderTemplate } from "../../../modules/docs/src/pdf.ts";
import { startMailServers } from "../../../modules/support/tests/mail-servers.ts";
import { setup } from "./harness.ts";

let h: Awaited<ReturnType<typeof setup>>;
let exec: ExecDeps;
let relay: postgres.Sql;
let mail: Awaited<ReturnType<typeof startMailServers>>;
let owner: string, mia: string, max: string, vic: string, bob: string, tA: string, tB: string;
let maxId: string, vicId: string;
let pdf: string;
const M = "/m/docs";
const Own = () => h.client(owner, tA);
const Mgr = () => h.client(mia, tA);
const Max = () => h.client(max, tA);
const Vic = () => h.client(vic, tA);
const B = () => h.client(bob, tB);
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const APP = { appUrl: "https://office.example", companyName: "Bakery Sol" };

/** Calls a public (no sign-in) route of the module. */
async function pub(method: "GET" | "POST", path: string, body?: unknown, tenant = tA) {
  const res = await h.app.inject({ method, url: `/api/v1/public/t/${tenant}/m/docs${path}`, ...(body !== undefined ? { payload: body as object } : {}) });
  return { status: res.statusCode, body: res.body ? res.json() : null, headers: res.headers };
}
const tokenOf = (link: string) => link.split("/sign/")[1]!;
const seen = new Set<string>();
async function pump(tenantId: string) {
  const runner = new InlineRunner(exec, 1);
  for (let i = 0; i < 10; i++) {
    const evs = (await h.events(tenantId)).filter((e) => !seen.has(e.id));
    if (!evs.length) break;
    for (const e of evs) { seen.add(e.id); await dispatchEvent({ ...exec, runner }, e as EventEnvelope).catch(() => {}); }
  }
}
const yesterday = () => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

async function draft(c = Max(), title = "Service agreement") {
  const r = await c.post(`${M}/requests`, { title, folder: "Contracts", fileName: "agreement.pdf", data: pdf });
  expect(r.status).toBe(201);
  return r.body as { id: string; status: string };
}
const sig = (signer: number, page = 1) => ({ signer, kind: "signature", page, x: 0.1, y: 0.7, w: 0.3, h: 0.06 });

beforeAll(async () => {
  h = await setup([hr, docs]);
  exec = { db: h.db, registry: h.registry, secrets: h.secrets, http: { allowPrivate: true, requireHttps: false } };
  relay = postgres(h.tdb.relayUrl, { onnotice: () => {} });
  mail = await startMailServers();
  [owner, mia, max, vic, bob] = await Promise.all(["olga", "mia", "max", "vic", "bob"].map((n) => h.token(n))) as [string, string, string, string, string];
  tA = (await h.client(owner).post("/tenants", { slug: "bakery", name: "Bakery" })).body.id;
  tB = (await h.client(bob).post("/tenants", { slug: "other", name: "Other" })).body.id;
  for (const [t, role] of [[mia, "manager"], [max, "member"], [vic, "viewer"]] as const) {
    const me = (await h.client(t).get("/me")).body;
    await Own().post("/members", { email: me.email, roles: [role] });
  }
  [maxId, vicId] = await Promise.all([max, vic].map(async (t) => (await h.client(t).get("/me")).body.userId)) as [string, string];
  pdf = Buffer.from((await renderTemplate("Test", "Hello.\n\nPage text.", [])).bytes).toString("base64");
});
afterAll(async () => { await relay.end(); await mail.stop(); await h.teardown(); });

describe("docs module", () => {
  it("is off until added; roles decide who can send and manage", async () => {
    expect((await Max().get(`${M}/documents`)).status).toBe(403);
    expect((await pub("GET", "/sign/abcdefghijklmnopqrstuvwxyz")).status).toBe(404);
    await Own().post("/modules/docs/enable", {});
    await Own().post("/modules/hr/enable", {});
    expect((await Max().get(`${M}/config`)).body).toMatchObject({ canSend: true, canManage: false, emailReady: false });
    expect((await Mgr().get(`${M}/config`)).body).toMatchObject({ canSend: true, canManage: true });
    expect((await Vic().get(`${M}/config`)).body).toMatchObject({ canSend: false, canManage: false });
    expect((await Vic().post(`${M}/requests`, { title: "x", fileName: "x.pdf", data: pdf })).status).toBe(403);
  });

  it("keeps a library with folders, private files and file checks", async () => {
    const txt = Buffer.from("Opening hours: 7-14").toString("base64");
    let r = await Max().post(`${M}/documents`, { title: "Opening hours", folder: " Shop / Notices ", fileName: "hours.txt", contentType: "text/plain", data: txt });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ folder: "Shop/Notices", status: "file", visibility: "team" });
    r = await Max().post(`${M}/documents`, { title: "My notes", fileName: "notes.txt", contentType: "text/plain", data: txt, visibility: "private" });
    const priv = r.body.id;
    expect((await Max().post(`${M}/documents`, { title: "Fake", fileName: "a.png", contentType: "image/png", data: txt })).status).toBe(400);
    expect((await Max().post(`${M}/documents`, { title: "Exe", fileName: "a.exe", contentType: "application/x-msdownload", data: txt })).status).toBe(400);

    const viewer = (await Vic().get(`${M}/documents?folder=Shop/Notices`)).body;
    expect(viewer.data.map((d: { title: string }) => d.title)).toEqual(["Opening hours"]);
    expect(viewer.folders).toEqual(["Shop/Notices"]);
    expect((await Vic().get(`${M}/documents/${priv}`)).status).toBe(404);
    expect((await Mgr().get(`${M}/documents/${priv}`)).status).toBe(200);
    expect((await Vic().get(`${M}/documents?q=hours`)).body.data).toHaveLength(1);
    // Only the uploader or a manager can change it
    expect((await Vic().patch(`${M}/documents/${viewer.data[0].id}`, { title: "Hacked" })).status).toBe(403);
    expect((await Mgr().patch(`${M}/documents/${viewer.data[0].id}`, { folder: "Shop" })).body.folder).toBe("Shop");
    // A text file can't become a signature request
    expect((await Max().post(`${M}/documents/${priv}/request`, {})).status).toBe(400);
    expect((await Max().post(`${M}/requests`, { title: "Bad", fileName: "x.pdf", data: Buffer.from("%PDF-1.4 nope").toString("base64") })).status).toBe(400);
  });

  it("without email, sending gives copyable links; the signer signs on the public page", async () => {
    const d = await draft();
    expect(d).toMatchObject({ status: "draft", visibility: "private", remindEveryDays: 3 });
    let r = await Max().put(`${M}/documents/${d.id}/setup`, {
      signers: [{ name: "Ana López", email: "ANA@client.test" }], fields: [{ signer: 0, kind: "date", page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.03 }],
    });
    expect(r.body.signers[0].email).toBe("ana@client.test");
    expect((await Max().post(`${M}/documents/${d.id}/send`, APP)).body.title).toBe("Add a signature box for Ana López");
    expect((await Max().put(`${M}/documents/${d.id}/setup`, { signers: [{ name: "Ana", email: "ana@client.test" }], fields: [{ ...sig(0), page: 3 }] })).status).toBe(400);
    await Max().put(`${M}/documents/${d.id}/setup`, {
      signers: [{ name: "Ana López", email: "ana@client.test" }],
      fields: [sig(0), { signer: 0, kind: "text", page: 1, x: 0.1, y: 0.8, w: 0.3, h: 0.03, label: "IBAN" }, { signer: 0, kind: "date", page: 1, x: 0.5, y: 0.7, w: 0.2, h: 0.03 }],
    });
    expect((await Max().post(`${M}/documents/${d.id}/send`, { appUrl: "javascript:alert(1)" })).status).toBe(400);
    r = await Max().post(`${M}/documents/${d.id}/send`, APP);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("sent");
    expect(r.body.delivery[r.body.signers[0].id]).toEqual({ emailed: false, error: null });
    const link: string = r.body.signers[0].link;
    expect(link).toMatch(new RegExp(`^https://office\\.example/p/${tA}/docs/sign/[A-Za-z0-9_-]{32}$`));
    expect((await Max().put(`${M}/documents/${d.id}/setup`, { signers: [], fields: [] })).status).toBe(409);
    // A viewer who isn't involved can't see it, and never sees links
    expect((await Vic().get(`${M}/documents/${d.id}`)).status).toBe(404);
    expect((await Mgr().get(`${M}/documents/${d.id}`)).body.signers[0].link).toBe(link);

    const token = tokenOf(link);
    let v = await pub("GET", `/sign/${token}`);
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ yourTurn: true, document: { title: "Service agreement", companyName: "Bakery Sol", status: "sent" }, signer: { name: "Ana López" } });
    expect(v.body.fields).toHaveLength(3);
    expect(v.body.pdf.length).toBeGreaterThan(100);
    expect((await pub("GET", `/sign/${token}`, undefined, tB)).status).toBe(404);
    expect((await pub("GET", "/sign/wrong-token-wrong-token-wrong")).status).toBe(404);

    expect((await pub("POST", `/sign/${token}`, { agree: false, signature: { kind: "typed", text: "Ana" } })).status).toBe(400);
    const iban = v.body.fields.find((f: { kind: string }) => f.kind === "text").id;
    expect((await pub("POST", `/sign/${token}`, { agree: true, signature: { kind: "typed", text: "Ana" } })).body.title).toBe("Fill in IBAN");
    expect((await pub("POST", `/sign/${token}`, { agree: true, signature: { kind: "drawn", image: "data:image/png;base64,AAAA" }, values: { [iban]: "ES12" } })).status).toBe(400);
    v = await pub("POST", `/sign/${token}`, { agree: true, signature: { kind: "typed", text: "Ana López" }, values: { [iban]: "ES12 3456" } });
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ document: { status: "completed" }, signer: { status: "signed" }, signedCopy: true, yourTurn: false });
    expect((await pub("POST", `/sign/${token}`, { agree: true, signature: { kind: "typed", text: "Again" } })).status).toBe(409);
    const dl = await pub("GET", `/sign/${token}/download`);
    expect(dl.body.fileName).toBe("agreement (signed).pdf");

    const done = (await Max().get(`${M}/documents/${d.id}`)).body;
    expect(done).toMatchObject({ status: "completed", signedSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(done.fields.find((f: { kind: string }) => f.kind === "text").value).toBe("ES12 3456");
    expect(done.activity.map((a: { action: string }) => a.action)).toEqual(["created", "sent", "viewed", "signed", "completed"]);
    expect(done.activity.find((a: { action: string; ip?: string }) => a.action === "signed")).toBeTruthy();
    const signed = (await Max().get(`${M}/documents/${d.id}/file?version=signed`)).body;
    expect(Buffer.from(signed.data, "base64").subarray(0, 5).toString()).toBe("%PDF-");
    expect((await h.events(tA, "docs.request.completed"))[0]!.payload).toMatchObject({ documentId: d.id, signers: [{ name: "Ana López", email: "ana@client.test" }] });
    expect((await Max().get(`${M}/summary`)).body.completedThisMonth).toBe(1);
  });

  it("two signers signing at the same moment both count, and the request completes once", async () => {
    const d = await draft(Max(), "Two at once");
    await Max().put(`${M}/documents/${d.id}/setup`, {
      signers: [{ name: "Ana", email: "ana@client.test" }, { name: "Ben", email: "ben@client.test" }], fields: [sig(0), { ...sig(1), y: 0.5 }],
    });
    const r = await Max().post(`${M}/documents/${d.id}/send`, APP);
    const [t1, t2] = (r.body.signers as { link: string }[]).map((s) => tokenOf(s.link)) as [string, string];
    const sign = (t: string, name: string) => pub("POST", `/sign/${t}`, { agree: true, signature: { kind: "typed", text: name } });
    const res = await Promise.all([sign(t1, "Ana"), sign(t2, "Ben"), sign(t1, "Ana again")]);
    expect(res.map((x) => x.status).sort()).toEqual([200, 200, 409]);
    expect((await Max().get(`${M}/documents/${d.id}`)).body.status).toBe("completed");
  });

  it("emails signers one after another, and team members sign from the app", async () => {
    expect((await Max().patch("/modules/docs/settings", { smtpHost: "127.0.0.1" })).status).toBe(403);
    const s = mail.settings;
    expect((await Own().patch("/modules/docs/settings", { fromAddress: "nope" })).status).toBe(400);
    await Own().patch("/modules/docs/settings", { fromAddress: s.address, fromName: "Bakery Sol", smtpHost: s.smtpHost, smtpPort: s.smtpPort, smtpSecurity: "none", smtpUser: s.smtpUser, smtpPassword: s.smtpPassword });
    expect((await Max().get(`${M}/config`)).body.emailReady).toBe(true);
    expect((await Own().post(`${M}/email/test`, {})).status).toBe(200);
    await mail.waitForSent(1);
    mail.sent.length = 0;

    const d = await draft(Max(), "Employment contract");
    await Max().patch(`${M}/documents/${d.id}`, { ordered: true, message: "Welcome aboard!", employeeId: vicId });
    await Max().put(`${M}/documents/${d.id}/setup`, {
      signers: [{ name: "Vic Viewer", email: (await h.client(vic).get("/me")).body.email, userId: vicId }, { name: "Olga Owner", email: "olga@example.com" }],
      fields: [sig(0), { ...sig(1), y: 0.8 }, { signer: 1, kind: "initials", page: 1, x: 0.8, y: 0.9, w: 0.08, h: 0.04 }],
    });
    let r = await Max().post(`${M}/documents/${d.id}/send`, APP);
    const [first, second] = r.body.signers;
    expect(r.body.delivery).toEqual({ [first.id]: { emailed: true, error: null } });
    const sent = await mail.waitForSent(1);
    expect(sent[0]!.to).toEqual([first.email]);
    expect(sent[0]!.mail.subject).toBe("max sent you “Employment contract” to sign");
    expect(sent[0]!.mail.text).toContain("Welcome aboard!");
    expect(sent[0]!.mail.text).toContain(first.link);

    // The second signer waits their turn
    const t2 = tokenOf(second.link);
    expect((await pub("GET", `/sign/${t2}`)).body).toMatchObject({ yourTurn: false, waitingFor: "Vic Viewer" });
    expect((await pub("POST", `/sign/${t2}`, { agree: true, signature: { kind: "typed", text: "Olga" } })).body.title).toBe("It isn't your turn to sign yet");
    expect((await Max().post(`${M}/signers/${second.id}/remind`, {})).status).toBe(409);

    // Vic (a viewer) can see it because they sign it, and signs from the app
    expect((await Vic().get(`${M}/waiting`)).body.map((w: { id: string }) => w.id)).toEqual([d.id]);
    expect((await Vic().get(`${M}/documents/${d.id}`)).body.signers[0].link).toBeNull();
    const path = (await Vic().post(`${M}/documents/${d.id}/my-link`, {})).body.path as string;
    expect(path).toBe(`/p/${tA}/docs/sign/${tokenOf(first.link)}`);
    r = await pub("POST", `/sign/${tokenOf(path)}`, { agree: true, signature: { kind: "drawn", image: PNG } });
    expect(r.body.document.status).toBe("sent");
    const next = await mail.waitForSent(2);
    expect(next[1]!.to).toEqual(["olga@example.com"]);
    expect((await Vic().get(`${M}/waiting`)).body).toEqual([]);

    expect((await pub("POST", `/sign/${t2}`, { agree: true, signature: { kind: "typed", text: "Olga" } })).body.title).toBe("Add your initials");
    r = await pub("POST", `/sign/${t2}`, { agree: true, signature: { kind: "typed", text: "Olga Owner" }, initials: { kind: "typed", text: "OO" } });
    expect(r.body.document.status).toBe("completed");
    // Both signers and the sender get the signed copy
    const all = await mail.waitForSent(5);
    const final = all.slice(2);
    expect(final.map((m) => m.to[0]).sort()).toEqual([first.email, "max@example.com", "olga@example.com"].sort());
    expect(final.every((m) => m.mail.attachments[0]?.filename === "agreement (signed).pdf")).toBe(true);

    // Filed with the team member in HR
    await pump(tA);
    const hrDocs = (await Vic().get(`/m/hr/people/${vicId}/documents`)).body;
    expect(hrDocs).toEqual([expect.objectContaining({ name: "Employment contract (signed)", category: "contract", source: "docs", refId: d.id })]);
    expect((await Vic().get(`/m/hr/documents/${hrDocs[0].id}`)).body).toMatchObject({ data: null, docsId: d.id });
    await pump(tA); // a second delivery doesn't add it twice
    expect((await Vic().get(`/m/hr/people/${vicId}/documents`)).body).toHaveLength(1);
    expect((await Vic().get(`${M}/documents/${d.id}`)).status).toBe(200);
  });

  it("templates fill in values and place signature boxes", async () => {
    const body = "# Order\n\nFor {{contact.name}}: {{price}}.\n\nNotes: {{notes}}";
    expect((await Max().post(`${M}/templates`, { name: "Order", body })).status).toBe(403);
    const t = (await Mgr().post(`${M}/templates`, { name: "Order", body, folder: "Orders" })).body;
    expect(t.placeholders).toEqual(["contact.name", "price", "notes"]);
    expect((await Mgr().post(`${M}/templates`, { name: "order", body })).status).toBe(409);
    expect((await Max().get(`${M}/templates`)).body).toHaveLength(1);
    expect((await Vic().get(`${M}/templates`)).status).toBe(403);

    const r = await Max().post(`${M}/requests/from-template`, {
      templateId: t.id, title: "Order for Ana", values: { "contact.name": "Ana López", price: "120 €" },
      signers: [{ name: "Ana López", email: "ana@client.test" }, { name: "Max", email: "max@example.com", userId: maxId }],
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: "draft", folder: "Orders", templateName: "Order", pageCount: 1 });
    expect(r.body.fields.map((f: { kind: string }) => f.kind).sort()).toEqual(["date", "date", "name", "name", "signature", "signature"]);
    expect((await Max().post(`${M}/requests/from-template`, { templateId: t.id, title: "x", signers: [{ name: "A", email: "bad" }] })).body.title).toBe("Check the email address of A");
    expect((await Max().post(`${M}/requests/from-template`, { templateId: t.id, title: "x", signers: [{ name: "A", email: "a@x.test" }, { name: "B", email: "A@x.test" }] })).status).toBe(400);
  });

  it("a signer can decline; the sender can cancel or replace a leaked link", async () => {
    mail.sent.length = 0;
    let d = await draft(Max(), "Quote");
    await Max().put(`${M}/documents/${d.id}/setup`, { signers: [{ name: "Ana", email: "ana@client.test" }], fields: [sig(0)] });
    let r = await Max().post(`${M}/documents/${d.id}/send`, APP);
    const token = tokenOf(r.body.signers[0].link);
    expect((await pub("POST", `/sign/${token}/decline`, { reason: "" })).status).toBe(400);
    r = await pub("POST", `/sign/${token}/decline`, { reason: "Price is too high" });
    expect(r.body).toMatchObject({ document: { status: "declined" }, signer: { status: "declined" }, yourTurn: false });
    const notes = await mail.waitForSent(2);
    expect(notes.find((m) => m.mail.subject === "Declined: “Quote”")!.to).toEqual(["max@example.com"]);
    expect((await h.events(tA, "docs.request.declined")).at(-1)!.payload).toMatchObject({ reason: "Price is too high" });

    d = await draft(Max(), "Second quote");
    await Max().put(`${M}/documents/${d.id}/setup`, { signers: [{ name: "Ana", email: "ana@client.test" }], fields: [sig(0)] });
    r = await Max().post(`${M}/documents/${d.id}/send`, APP);
    const old = tokenOf(r.body.signers[0].link);
    r = await Max().post(`${M}/signers/${r.body.signers[0].id}/new-link`, {});
    const fresh = tokenOf(r.body.signers[0].link);
    expect(fresh).not.toBe(old);
    expect((await pub("GET", `/sign/${old}`)).status).toBe(404);
    expect((await Vic().post(`${M}/documents/${d.id}/cancel`, {})).status).toBe(403);
    expect((await Max().post(`${M}/documents/${d.id}/cancel`, { reason: "Changed the price" })).body.status).toBe("cancelled");
    expect((await pub("GET", `/sign/${fresh}`)).body.document.status).toBe("cancelled");
    expect((await pub("POST", `/sign/${fresh}`, { agree: true, signature: { kind: "typed", text: "Ana" } })).status).toBe(409);
  });

  it("sends reminders and expires old requests", async () => {
    mail.sent.length = 0;
    const d = await draft(Max(), "Reminder test");
    await Max().patch(`${M}/documents/${d.id}`, { remindEveryDays: 2 });
    await Max().put(`${M}/documents/${d.id}/setup`, { signers: [{ name: "Ana", email: "ana@client.test" }], fields: [sig(0)] });
    await Max().post(`${M}/documents/${d.id}/send`, APP);
    await mail.waitForSent(1);
    const deps = { db: h.db, registry: h.registry, secrets: h.secrets };
    await relay`update module_job_state set next_run_at = now()`;
    await runDueJobs(relay, deps);
    expect(mail.sent).toHaveLength(1); // not due yet
    await h.asOwner(tA, (tx) => tx`update docs_signers set notified_at = now() - interval '3 days' where document_id = ${d.id}`);
    await relay`update module_job_state set next_run_at = now()`;
    await runDueJobs(relay, deps);
    const sent = await mail.waitForSent(2);
    expect(sent[1]!.mail.subject).toBe("Reminder: please sign “Reminder test”");
    const s = (await Max().get(`${M}/documents/${d.id}`)).body.signers[0];
    expect(s).toMatchObject({ remindersSent: 1, lastRemindedAt: expect.any(String) });

    await h.asOwner(tA, (tx) => tx`update docs_documents set expires_on = ${yesterday()} where id = ${d.id}`);
    expect((await pub("GET", `/sign/${tokenOf(s.link)}`)).body).toMatchObject({ yourTurn: false, document: { status: "expired" } });
    await relay`update module_job_state set next_run_at = now()`;
    await runDueJobs(relay, deps);
    expect((await Max().get(`${M}/documents/${d.id}`)).body.status).toBe("expired");
    expect((await h.events(tA, "docs.request.expired")).map((e) => e.payload.documentId)).toContain(d.id);
    expect((await Max().patch(`${M}/documents/${d.id}`, { expiresOn: "2099-01-01" })).status).toBe(409);
  });

  it("keeps companies apart, and public links stop when the module is off", async () => {
    const list = (await Max().get(`${M}/documents?kind=completed`)).body.data;
    expect(list.length).toBeGreaterThan(0);
    await B().post("/modules/docs/enable", {});
    expect((await B().get(`${M}/documents/${list[0].id}`)).status).toBe(404);
    expect((await B().get(`${M}/documents`)).body.data).toEqual([]);
    const d = await draft(Max(), "Off test");
    await Max().put(`${M}/documents/${d.id}/setup`, { signers: [{ name: "Ana", email: "ana@client.test" }], fields: [sig(0)] });
    const link = (await Max().post(`${M}/documents/${d.id}/send`, APP)).body.signers[0].link;
    expect((await pub("GET", `/sign/${tokenOf(link)}`, undefined, tB)).status).toBe(404);
    await Own().post("/modules/docs/disable", {});
    expect((await pub("GET", `/sign/${tokenOf(link)}`)).status).toBe(404);
    await Own().post("/modules/docs/enable", {});
    expect((await pub("GET", `/sign/${tokenOf(link)}`)).status).toBe(200);
    expect((await Max().del(`${M}/documents/${d.id}`)).status).toBe(204);
    expect((await pub("GET", `/sign/${tokenOf(link)}`)).status).toBe(404);
  });
});
