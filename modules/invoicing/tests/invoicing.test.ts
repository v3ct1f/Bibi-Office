import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { dispatchEvent, InlineRunner, runDueJobs, runModuleJob, type ExecDeps } from "@office/platform";
import type { EventEnvelope } from "@office/sdk";
// Shared API test harness (real Fastify app + migrated Postgres + local JWKS).
import { setup } from "../../../apps/api/test/harness.ts";
import invoicing from "../src/index.ts";

let h: Awaited<ReturnType<typeof setup>>;
let alice: string, carol: string, tA: string, exec: ExecDeps;
let contactId: string, companyId: string;
const C = () => h.client(alice, tA);
const year = new Date().getUTCFullYear();

const seen = new Set<string>();
async function pump(tenantId = tA) {
  const runner = new InlineRunner(exec, 1);
  for (let i = 0; i < 20; i++) {
    const evs = (await h.events(tenantId)).filter((e) => !seen.has(e.id));
    if (!evs.length) break;
    for (const e of evs) { seen.add(e.id); await dispatchEvent({ ...exec, runner }, e as EventEnvelope); }
  }
}
const types = async () => (await h.events(tA)).map((e) => e.type).filter((t) => t.startsWith("invoicing."));
const draft = (over: Record<string, unknown> = {}) => C().post("/m/invoicing/invoices", {
  contactId, companyId, lines: [{ description: "Consulting", quantity: 10, unitPrice: 12000, taxRate: 19 }, { description: "Travel", quantity: 1, unitPrice: 4550 }],
  ...over,
});

beforeAll(async () => {
  h = await setup([invoicing]);
  exec = { db: h.db, registry: h.registry, secrets: h.secrets, files: h.files, http: { allowPrivate: true, requireHttps: false } };
  [alice, carol] = await Promise.all([h.token("alice"), h.token("carol")]);
  tA = (await h.client(alice).post("/tenants", { slug: "acme", name: "Acme" })).body.id;
  await h.client(carol).get("/me");
  await C().post("/members", { email: "carol@example.com", roles: ["member"] });
  companyId = (await C().post("/companies", { name: "Globex GmbH", taxId: "DE123456789", address: { line1: "Main St 1", city: "Berlin", country: "DE" } })).body.id;
  contactId = (await C().post("/contacts", { firstName: "Hank", lastName: "Scorpio", email: "hank@globex.test", companyId })).body.id;
  expect((await C().get("/m/invoicing/invoices")).status).toBe(404); // off until enabled
  expect((await C().post("/modules/invoicing/enable", {})).status).toBe(200);
  const s = await C().patch("/modules/invoicing/settings", { sellerName: "Acme Ltd", sellerTaxId: "GB999", paymentInstructions: "IBAN DE00 1234", paymentTermDays: 14 });
  expect(s.status).toBe(200);
});
afterAll(() => h?.teardown());

describe("drafts", () => {
  it("creates a draft with server-computed totals", async () => {
    const r = await draft();
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: "draft", number: null, currency: "EUR", subtotal: 124550, taxTotal: 22800, total: 147350, balance: 147350 });
    expect(r.body.lines).toHaveLength(2);
    expect(r.body.lines[0]).toMatchObject({ quantity: 10, unitPrice: 12000, taxRate: 19, net: 120000, tax: 22800 });
    expect(await types()).toContain("invoicing.invoice.created");
  });
  it("validates input and customer references", async () => {
    expect((await draft({ lines: [{ description: "x", quantity: 1.0001, unitPrice: 1 }] })).status).toBe(400);
    expect((await draft({ lines: [{ description: "x", quantity: 1, unitPrice: 1.5 }] })).status).toBe(400);
    expect((await draft({ contactId: "00000000-0000-7000-8000-000000000000" })).status).toBe(404);
  });
  it("edits and deletes drafts", async () => {
    const id = (await draft()).body.id;
    const u = await C().put(`/m/invoicing/invoices/${id}`, { contactId, lines: [{ description: "One", quantity: 2, unitPrice: 500 }] });
    expect(u.body).toMatchObject({ total: 1000, companyId: null, lines: [{ description: "One" }] });
    expect((await C().del(`/m/invoicing/invoices/${id}`)).status).toBe(204);
    expect((await C().get(`/m/invoicing/invoices/${id}`)).status).toBe(404);
  });
});

describe("issue, pay, void", () => {
  let id: string;
  it("issues with gapless numbers, snapshots and due date from settings", async () => {
    id = (await draft()).body.id;
    const r = await C().post(`/m/invoicing/invoices/${id}/issue`, { issueDate: `${year}-01-10` });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      status: "open", number: `INV-${year}-00001`, issueDate: `${year}-01-10`, dueDate: `${year}-01-24`,
      customer: { name: "Globex GmbH", email: "hank@globex.test", taxId: "DE123456789", address: "Main St 1, Berlin, DE" },
      seller: { name: "Acme Ltd", taxId: "GB999", paymentInstructions: "IBAN DE00 1234" },
    });
    expect((await C().post(`/m/invoicing/invoices/${id}/issue`, {})).status).toBe(409);
    const second = (await draft()).body.id;
    expect((await C().post(`/m/invoicing/invoices/${second}/send`, {})).body).toMatchObject({ number: `INV-${year}-00002`, status: "open" });
    expect(await types()).toEqual(expect.arrayContaining(["invoicing.invoice.issued", "invoicing.invoice.sent"]));
  });
  it("refuses to issue without customer or lines", async () => {
    const a = (await C().post("/m/invoicing/invoices", { lines: [{ description: "x", quantity: 1, unitPrice: 1 }] })).body.id;
    expect((await C().post(`/m/invoicing/invoices/${a}/issue`, {})).status).toBe(422);
    const b = (await C().post("/m/invoicing/invoices", { contactId })).body.id;
    expect((await C().post(`/m/invoicing/invoices/${b}/issue`, {})).status).toBe(422);
  });
  it("issued invoices are immutable, in the API and in the database", async () => {
    expect((await C().put(`/m/invoicing/invoices/${id}`, { contactId, lines: [] })).status).toBe(409);
    expect((await C().del(`/m/invoicing/invoices/${id}`)).status).toBe(409);
    await expect(h.asOwner(tA, (tx) => tx`update invoicing_invoices set total = 1 where id = ${id}`)).rejects.toThrow(/immutable/);
    await expect(h.asOwner(tA, (tx) => tx`update invoicing_invoice_lines set net = 1 where invoice_id = ${id}`)).rejects.toThrow(/immutable/);
  });
  it("records partial and full payments; refuses overpayment", async () => {
    const p1 = await C().post(`/m/invoicing/invoices/${id}/payments`, { amount: 47350, paidOn: `${year}-01-15`, reference: "TX1" });
    expect(p1.status).toBe(201);
    expect(p1.body).toMatchObject({ status: "open", amountPaid: 47350, balance: 100000 });
    const over = await C().post(`/m/invoicing/invoices/${id}/payments`, { amount: 100001 });
    expect(over.status).toBe(422);
    expect((await C().post(`/m/invoicing/invoices/${id}/void`, { reason: "oops" })).status).toBe(409);
    const p2 = await C().post(`/m/invoicing/invoices/${id}/payments`, { amount: 100000, method: "card" });
    expect(p2.body).toMatchObject({ status: "paid", balance: 0, payments: [{ amount: 47350 }, { amount: 100000, method: "card" }] });
    expect(p2.body.paidAt).toBeTruthy();
    expect((await C().post(`/m/invoicing/invoices/${id}/payments`, { amount: 1 })).status).toBe(409);
    expect(await types()).toEqual(expect.arrayContaining(["invoicing.payment.recorded", "invoicing.invoice.paid"]));
  });
  it("voids unpaid issued invoices; numbers are never reused", async () => {
    const v = (await draft()).body.id;
    await C().post(`/m/invoicing/invoices/${v}/issue`, {});
    const r = await C().post(`/m/invoicing/invoices/${v}/void`, { reason: "Wrong customer" });
    expect(r.body).toMatchObject({ status: "void", number: `INV-${year}-00003`, voidReason: "Wrong customer", balance: 0 });
    const next = (await draft()).body.id;
    expect((await C().post(`/m/invoicing/invoices/${next}/issue`, {})).body.number).toBe(`INV-${year}-00004`);
  });
});

describe("reminders, overdue job, summary, PDF", () => {
  let overdueId: string;
  it("throttles reminders", async () => {
    overdueId = (await draft()).body.id;
    await C().post(`/m/invoicing/invoices/${overdueId}/issue`, { issueDate: "2020-01-01" });
    expect((await C().post(`/m/invoicing/invoices/${overdueId}/remind`, {})).body.reminderCount).toBe(1);
    expect((await C().post(`/m/invoicing/invoices/${overdueId}/remind`, {})).status).toBe(409);
    expect(await types()).toContain("invoicing.invoice.reminder_requested");
  });
  it("marks overdue once via the scheduled job", async () => {
    expect((await C().get(`/m/invoicing/invoices?status=overdue`)).body.data.map((i: { id: string }) => i.id)).toContain(overdueId);
    expect(await runModuleJob(exec, tA, "invoicing", "mark-overdue")).toBeGreaterThanOrEqual(1);
    expect(await runModuleJob(exec, tA, "invoicing", "mark-overdue")).toBe(0);
    const ev = (await h.events(tA, "invoicing.invoice.overdue")).filter((e) => (e.payload as { id: string }).id === overdueId);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toMatchObject({ v: 1, number: expect.stringMatching(/^INV-2020-/), daysOverdue: expect.any(Number) });
  });
  it("worker loop seeds, claims and reschedules jobs", async () => {
    const relay = postgres(h.tdb.relayUrl, { max: 1, onnotice: () => {} });
    try {
      expect(await runDueJobs(relay, exec)).toBe(1);
      expect(await runDueJobs(relay, exec)).toBe(0); // rescheduled an hour out
      const [row] = await h.asOwner(tA, (tx) => tx`select last_error, next_run_at > now() + interval '50 minutes' as later from module_jobs`);
      expect(row).toMatchObject({ last_error: null, later: true });
    } finally { await relay.end(); }
  });
  it("summarizes per currency", async () => {
    const s = (await C().get("/m/invoicing/summary")).body.data;
    expect(s[0]).toMatchObject({ currency: "EUR", overdueCount: expect.any(Number), paid30d: 147350 });
    expect(s[0].outstanding).toBeGreaterThan(0);
  });
  it("renders a PDF", async () => {
    const res = await h.app.inject({ method: "GET", url: `/api/v1/m/invoicing/invoices/${overdueId}/pdf`, headers: { authorization: `Bearer ${alice}`, "x-tenant-id": tA } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="INV-2020-\d{5}\.pdf"/);
    expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    expect(res.rawPayload.length).toBeGreaterThan(1000);
  });
  it("lists with search and cursor pagination", async () => {
    const p1 = (await C().get("/m/invoicing/invoices?limit=2")).body;
    expect(p1.data).toHaveLength(2);
    const p2 = (await C().get(`/m/invoicing/invoices?limit=2&cursor=${p1.nextCursor}`)).body;
    expect(p2.data[0].id < p1.data[1].id).toBe(true);
    expect((await C().get(`/m/invoicing/invoices?q=INV-${year}-00001`)).body.data).toHaveLength(1);
    expect((await C().get("/m/invoicing/invoices?q=globex")).body.data.length).toBeGreaterThan(1);
  });
});

describe("security", () => {
  it("members without invoicing permissions are denied", async () => {
    expect((await h.client(carol, tA).get("/m/invoicing/invoices")).status).toBe(403);
  });
  it("other tenants can't see or touch invoices", async () => {
    const id = (await C().get("/m/invoicing/invoices?limit=1")).body.data[0].id;
    const bob = await h.token("bob");
    const tB = (await h.client(bob).post("/tenants", { slug: "globex", name: "Globex" })).body.id;
    await h.client(bob, tB).post("/modules/invoicing/enable", {});
    expect((await h.client(bob, tB).get(`/m/invoicing/invoices/${id}`)).status).toBe(404);
    expect((await h.client(bob, tB).post(`/m/invoicing/invoices/${id}/payments`, { amount: 1 })).status).toBe(404);
    expect((await h.client(bob, tB).get("/m/invoicing/invoices")).body.data).toHaveLength(0);
    // numbering is per tenant
    const c = (await h.client(bob, tB).post("/contacts", { firstName: "Zed" })).body.id;
    const d = (await h.client(bob, tB).post("/m/invoicing/invoices", { contactId: c, lines: [{ description: "x", quantity: 1, unitPrice: 100 }] })).body.id;
    expect((await h.client(bob, tB).post(`/m/invoicing/invoices/${d}/issue`, {})).body.number).toBe(`INV-${year}-00001`);
  });
});

describe("events in: crm.deal.won, workflows", () => {
  it("drafts one invoice per won deal", async () => {
    const e = (id: string): EventEnvelope => ({
      id, tenantId: tA, type: "crm.deal.won", version: 1, actor: { type: "user", id: null }, causationId: null,
      correlationId: id, depth: 0, occurredAt: new Date().toISOString(),
      payload: { dealId: "D-1", title: "Website redesign", amount: 500000, companyId },
    });
    const runner = new InlineRunner(exec, 1);
    await dispatchEvent({ ...exec, runner }, e("01900000-0000-7000-8000-000000000001"));
    await dispatchEvent({ ...exec, runner }, e("01900000-0000-7000-8000-000000000002")); // another event, same deal
    const rows = await h.asOwner(tA, (tx) => tx`select status, total, source from invoicing_invoices where source = 'crm.deal:D-1'`);
    expect(rows).toEqual([{ status: "draft", total: "500000", source: "crm.deal:D-1" }]);
  });
  it("exposes triggers and actions to workflows", async () => {
    const cat = (await C().get("/workflow-catalog")).body;
    expect(cat.events).toEqual(expect.arrayContaining(["invoicing.invoice.paid", "invoicing.invoice.overdue"]));
    expect(cat.actions.map((a: { key: string }) => a.key)).toEqual(expect.arrayContaining(["invoicing.create_invoice", "invoicing.send_reminder"]));
    await pump();
    const wf = await C().post("/workflows", {
      name: "Onboarding fee", trigger: { event: "core.contact.created" },
      conditions: { "==": [{ var: "payload.lastName" }, "Customer"] },
      actions: [
        { key: "invoicing.create_invoice", input: { contactId: "{{payload.id}}", lines: [{ description: "Onboarding", quantity: 1, unitPrice: 9900, taxRate: 19 }], issue: true } },
        { key: "core.create_task", input: { title: "Check invoice {{steps.0.number}}" } },
      ],
    });
    expect(wf.status).toBe(201);
    await C().post("/contacts", { firstName: "New", lastName: "Customer" });
    await pump();
    const runs = (await C().get(`/workflows/${wf.body.id}/runs`)).body;
    expect(runs[0]).toMatchObject({ status: "succeeded" });
    expect(runs[0].steps[0].output).toMatchObject({ status: "open", total: 11781, number: expect.stringMatching(/^INV-/) });
    const tasks = (await C().get("/tasks")).body.data;
    expect(tasks.map((t: { title: string }) => t.title)).toContain(`Check invoice ${runs[0].steps[0].output.number}`);
  });
});
