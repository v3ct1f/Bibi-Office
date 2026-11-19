import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dispatchEvent, InlineRunner, type ExecDeps } from "@office/platform";
import type { EventEnvelope } from "@office/sdk";
import { setup } from "../../../apps/api/test/harness.ts";
import expenses from "../src/index.ts";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 9, 9]);
const PDF = new TextEncoder().encode("%PDF-1.4\n%%EOF");

let h: Awaited<ReturnType<typeof setup>>;
let alice: string, carol: string, dave: string, bob: string, tA: string, tB: string, exec: ExecDeps, carolId: string;
let travel: string, meals: string;
const A = () => h.client(alice, tA);   // owner: approver + finance
const Cm = () => h.client(carol, tA);  // member: submits
const D = () => h.client(dave, tA);    // member
const base = "/m/expenses";

const seen = new Set<string>();
async function pump() {
  const runner = new InlineRunner(exec, 1);
  for (let i = 0; i < 20; i++) {
    const evs = (await h.events(tA)).filter((e) => !seen.has(e.id));
    if (!evs.length) break;
    for (const e of evs) { seen.add(e.id); await dispatchEvent({ ...exec, runner }, e as EventEnvelope); }
  }
}
const types = async () => (await h.events(tA)).map((e) => e.type).filter((t) => t.startsWith("expenses."));
const newExpense = async (c = Cm(), over: Record<string, unknown> = {}) =>
  (await c.post(`${base}/expenses`, { spentOn: "2026-11-03", merchant: "Rail Co", categoryId: travel, amount: 4200, tax: 700, ...over })).body;

beforeAll(async () => {
  h = await setup([expenses]);
  exec = { db: h.db, registry: h.registry, secrets: h.secrets, files: h.files, http: { allowPrivate: true, requireHttps: false } };
  [alice, carol, dave, bob] = await Promise.all([h.token("alice"), h.token("carol"), h.token("dave"), h.token("bob")]);
  tA = (await h.client(alice).post("/tenants", { slug: "acme", name: "Acme" })).body.id;
  tB = (await h.client(bob).post("/tenants", { slug: "beta", name: "Beta" })).body.id;
  carolId = (await h.client(carol).get("/me")).body.userId;
  await h.client(dave).get("/me");
  await A().post("/members", { email: "carol@example.com", roles: ["member"] });
  await A().post("/members", { email: "dave@example.com", roles: ["member"] });
  expect((await A().post("/modules/expenses/enable", {})).status).toBe(200);
  const cats = (await Cm().get(`${base}/categories`)).body.data;
  travel = cats.find((c: { name: string }) => c.name === "Travel").id;
  meals = cats.find((c: { name: string }) => c.name === "Meals").id;
});
afterAll(() => h?.teardown());

describe("setup", () => {
  it("seeds categories once and grants members the submit permission", async () => {
    const cats = (await Cm().get(`${base}/categories`)).body.data;
    expect(cats.map((c: { name: string }) => c.name)).toEqual(["Travel", "Lodging", "Meals", "Office supplies", "Software", "Other"]);
    await A().post("/modules/expenses/disable", {});
    await A().post("/modules/expenses/enable", {});
    expect((await Cm().get(`${base}/categories`)).body.data).toHaveLength(6);
    const roles = (await A().get("/roles")).body.data ?? (await A().get("/roles")).body;
    const member = roles.find((r: { key: string }) => r.key === "member");
    expect(member.permissions).toContain("expenses:expense.submit");
    expect(member.permissions).not.toContain("expenses:expense.approve");
  });
  it("categories: members cannot manage; names unique; archived hidden", async () => {
    expect((await Cm().post(`${base}/categories`, { name: "Gifts" })).status).toBe(403);
    const g = await A().post(`${base}/categories`, { name: "Gifts", code: "6420" });
    expect(g.status).toBe(201);
    expect((await A().post(`${base}/categories`, { name: "gifts" })).status).toBe(409);
    await A().patch(`${base}/categories/${g.body.id}`, { archived: true });
    expect((await Cm().get(`${base}/categories`)).body.data.map((c: { name: string }) => c.name)).not.toContain("Gifts");
    expect((await Cm().post(`${base}/expenses`, { spentOn: "2026-11-01", merchant: "X", categoryId: g.body.id, amount: 100 })).status).toBe(422);
  });
});

describe("claim lifecycle", () => {
  let id: string;
  it("member creates a draft in the default currency", async () => {
    const e = await newExpense();
    expect(e).toMatchObject({ status: "draft", currency: "EUR", amount: 4200, tax: 700, mine: true, submitterId: carolId, submitterName: "carol", categoryName: "Travel", receipt: null });
    id = e.id;
    expect((await Cm().post(`${base}/expenses`, { spentOn: "2026-11-01", merchant: "X", amount: 100, tax: 200 })).status).toBe(400);
  });
  it("submit requires a receipt above the threshold", async () => {
    const r = await Cm().post(`${base}/expenses/${id}/submit`, {});
    expect(r.status).toBe(422);
    expect(r.body.title).toMatch(/receipt/i);
  });
  it("receipt upload: type-checked, private to the module, replaceable", async () => {
    expect((await Cm().upload(`${base}/expenses/${id}/receipt?filename=r.html`, new TextEncoder().encode("<html>"), "text/html")).status).toBe(400);
    const r1 = await Cm().upload(`${base}/expenses/${id}/receipt?filename=ticket.pdf`, PDF, "application/pdf");
    expect(r1.status).toBe(200);
    const first = r1.body.receipt.id;
    const r2 = await Cm().upload(`${base}/expenses/${id}/receipt?filename=ticket.png`, PNG);
    expect(r2.body.receipt).toMatchObject({ filename: "ticket.png", mime: "image/png" });
    expect(r2.body.receipt.id).not.toBe(first);
    // receipts are not core documents
    const docs = (await A().get("/documents")).body.data;
    expect(docs.map((d: { id: string }) => d.id)).not.toContain(r2.body.receipt.id);
    expect((await A().get(`/documents/${r2.body.receipt.id}/content`)).status).toBe(404);
    expect((await A().get(`/documents/${r2.body.receipt.id}`)).status).toBe(404);
    const dl = await Cm().get(`${base}/expenses/${id}/receipt`);
    expect(dl.status).toBe(200);
    expect(dl.headers["content-type"]).toBe("image/png");
    expect(dl.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.compare(dl.raw, Buffer.from(PNG))).toBe(0);
  });
  it("members see only their own expenses", async () => {
    expect((await D().get(`${base}/expenses/${id}`)).status).toBe(404);
    expect((await D().get(`${base}/expenses/${id}/receipt`)).status).toBe(404);
    expect((await D().get(`${base}/expenses`)).body.data).toHaveLength(0);
    expect((await A().get(`${base}/expenses`)).body.data.map((e: { id: string }) => e.id)).toContain(id);
  });
  it("submits; then locked for edits; emits event", async () => {
    const s = await Cm().post(`${base}/expenses/${id}/submit`, {});
    expect(s.status).toBe(200);
    expect(s.body.status).toBe("submitted");
    expect((await Cm().patch(`${base}/expenses/${id}`, { amount: 1 })).status).toBe(409);
    expect((await Cm().upload(`${base}/expenses/${id}/receipt?filename=x.png`, PNG)).status).toBe(409);
    expect(await types()).toContain("expenses.expense.submitted");
  });
  it("members cannot approve; reject needs a reason", async () => {
    expect((await D().post(`${base}/expenses/${id}/approve`, {})).status).toBe(403);
    expect((await A().post(`${base}/expenses/${id}/reject`, {})).status).toBe(400);
    const r = await A().post(`${base}/expenses/${id}/reject`, { note: "Wrong date" });
    expect(r.body).toMatchObject({ status: "rejected", decisionNote: "Wrong date" });
  });
  it("editing a rejected expense returns it to draft; resubmit; approve", async () => {
    const e = await Cm().patch(`${base}/expenses/${id}`, { spentOn: "2026-11-04" });
    expect(e.body.status).toBe("draft");
    await Cm().post(`${base}/expenses/${id}/submit`, {});
    const a = await A().post(`${base}/expenses/${id}/approve`, { note: "ok" });
    expect(a.body.status).toBe("approved");
    expect((await A().post(`${base}/expenses/${id}/approve`, {})).status).toBe(409);
    expect((await Cm().del(`${base}/expenses/${id}`)).status).toBe(409);
  });
  it("database refuses edits to approved expenses, even bypassing the service", async () => {
    await expect(h.asOwner(tA, (tx) => tx`update expenses_expenses set amount = 1 where id = ${id}`)).rejects.toThrow(/cannot be edited/);
    await expect(h.asOwner(tA, (tx) => tx`delete from expenses_expenses where id = ${id}`)).rejects.toThrow(/cannot be deleted/);
  });
  it("reimburses in a batch, all-or-nothing", async () => {
    const draft = await newExpense(Cm(), { amount: 900, tax: 0 });
    expect((await A().post(`${base}/reimburse`, { ids: [id, draft.id], reference: "PAY-11" })).status).toBe(409);
    expect((await Cm().post(`${base}/reimburse`, { ids: [id] })).status).toBe(403);
    const r = await A().post(`${base}/reimburse`, { ids: [id], reference: "PAY-11" });
    expect(r.body).toEqual({ reimbursed: 1 });
    expect((await A().get(`${base}/expenses/${id}`)).body).toMatchObject({ status: "reimbursed", reimbursementRef: "PAY-11" });
    expect(await types()).toEqual(expect.arrayContaining(["expenses.expense.rejected", "expenses.expense.approved", "expenses.expense.reimbursed"]));
  });
  it("drafts can be deleted with their receipt", async () => {
    const e = await newExpense(Cm(), { amount: 500, tax: 0 });
    await Cm().upload(`${base}/expenses/${e.id}/receipt?filename=a.png`, PNG);
    expect((await D().del(`${base}/expenses/${e.id}`)).status).toBe(404);
    expect((await Cm().del(`${base}/expenses/${e.id}`)).status).toBe(204);
    expect((await Cm().get(`${base}/expenses/${e.id}`)).status).toBe(404);
  });
});

describe("approval rules", () => {
  it("approvers cannot approve their own expense unless allowed", async () => {
    const e = await newExpense(A(), { amount: 1000, tax: 0 });
    expect((await A().post(`${base}/expenses/${e.id}/submit`, {})).body.canDecide).toBe(false);
    expect((await A().post(`${base}/expenses/${e.id}/approve`, {})).status).toBe(403);
    await A().patch("/modules/expenses/settings", { allowSelfApproval: true });
    expect((await A().post(`${base}/expenses/${e.id}/approve`, {})).body.status).toBe("approved");
    await A().patch("/modules/expenses/settings", { allowSelfApproval: false });
  });
  it("API keys without a user cannot create expenses", async () => {
    const k = await A().post("/api-keys", { name: "ci", scopes: ["expenses:expense.submit"] });
    expect(k.status).toBe(201);
    const r = await h.client(k.body.token).post(`${base}/expenses`, { spentOn: "2026-11-01", merchant: "X", amount: 1 });
    expect(r.status).toBe(400);
  });
  it("workflow can auto-approve small submitted expenses", async () => {
    const wf = await A().post("/workflows", {
      name: "Auto-approve small", trigger: { event: "expenses.expense.submitted" },
      conditions: { "<": [{ var: "payload.amount" }, 2000] },
      actions: [{ key: "expenses.approve", input: { id: "{{payload.id}}" } }],
    });
    expect(wf.status).toBe(201);
    await pump();
    const small = await newExpense(Cm(), { merchant: "Cafe", categoryId: meals, amount: 1500, tax: 0 });
    const big = await newExpense(Cm(), { merchant: "Hotel", amount: 9000, tax: 0, spentOn: "2026-11-05" });
    await Cm().upload(`${base}/expenses/${big.id}/receipt?filename=h.pdf`, PDF);
    await Cm().post(`${base}/expenses/${small.id}/submit`, {});
    await Cm().post(`${base}/expenses/${big.id}/submit`, {});
    await pump();
    expect((await Cm().get(`${base}/expenses/${small.id}`)).body).toMatchObject({ status: "approved", decisionNote: "Approved by workflow" });
    expect((await Cm().get(`${base}/expenses/${big.id}`)).body.status).toBe("submitted");
    await A().del(`/workflows/${wf.body.id}`);
  });
});

describe("reporting", () => {
  it("summary: members see their own numbers only", async () => {
    const m = (await Cm().get(`${base}/summary`)).body;
    expect(m.seesAll).toBe(false);
    expect(m.data[0]).not.toHaveProperty("toApprove");
    const a = (await A().get(`${base}/summary`)).body;
    expect(a.seesAll).toBe(true);
    expect(a.data[0]).toHaveProperty("toReimburseCount");
  });
  it("CSV export for finance, formula-safe", async () => {
    const e = await newExpense(Cm(), { merchant: "=HYPERLINK(\"x\")", amount: 1234, tax: 0, spentOn: "2026-11-06" });
    await Cm().post(`${base}/expenses/${e.id}/submit`, {});
    await A().post(`${base}/expenses/${e.id}/approve`, {});
    expect((await Cm().get(`${base}/export.csv`)).status).toBe(403);
    const r = await A().get(`${base}/export.csv?from=2026-11-01&to=2026-11-30`);
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/^text\/csv/);
    const text = String(r.body);
    expect(text.split("\r\n")[0]).toContain("Date,Submitted by,Merchant");
    expect(text).toContain(`"'=HYPERLINK(""x"")"`);
    expect(text).toContain("2026-11-06,carol,");
    expect(text).toContain(",12.34,0.00,EUR,approved,");
  });
});

describe("isolation", () => {
  it("other tenants cannot see or act on expenses", async () => {
    const e = await newExpense();
    await h.client(bob, tB).post("/modules/expenses/enable", {});
    expect((await h.client(bob, tB).get(`${base}/expenses/${e.id}`)).status).toBe(404);
    expect((await h.client(bob, tB).get(`${base}/expenses`)).body.data).toHaveLength(0);
    expect((await h.client(bob, tA).get(`${base}/expenses`)).status).toBe(404);
  });
});
