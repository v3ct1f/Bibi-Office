import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { dispatchEvent, InlineRunner, runDueJobs, type ExecDeps } from "@office/platform";
import type { EventEnvelope } from "@office/sdk";
import invoicing from "@office/module-invoicing";
import { setup } from "./harness.ts";

let h: Awaited<ReturnType<typeof setup>>;
let alice: string, carol: string, bob: string, tA: string, tB: string;
let exec: ExecDeps;
let relay: postgres.Sql;
let company: { id: string }, contact: { id: string };
const A = () => h.client(alice, tA);
const M = "/m/invoicing";
const year = new Date().getUTCFullYear();
const day = (offset: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };

const seen = new Set<string>();
async function pump(tenantId: string) {
  const runner = new InlineRunner(exec, 1);
  for (let i = 0; i < 20; i++) {
    const evs = (await h.events(tenantId)).filter((e) => !seen.has(e.id));
    if (!evs.length) break;
    for (const e of evs) { seen.add(e.id); await dispatchEvent({ ...exec, runner }, e as EventEnvelope).catch(() => {}); }
  }
}
const types = async (tenantId: string, prefix = "invoicing.") =>
  (await h.events(tenantId)).map((e) => e.type).filter((t) => t.startsWith(prefix));

const line = (description: string, quantity: number, unitPriceCents: number, taxRate = 0) => ({ description, quantity, unitPriceCents, taxRate });

beforeAll(async () => {
  h = await setup([invoicing]);
  exec = { db: h.db, registry: h.registry, secrets: h.secrets, http: { allowPrivate: true, requireHttps: false } };
  relay = postgres(h.tdb.relayUrl, { onnotice: () => {} });
  [alice, carol, bob] = await Promise.all([h.token("alice"), h.token("carol"), h.token("bob")]);
  tA = (await h.client(alice).post("/tenants", { slug: "acme", name: "Acme" })).body.id;
  tB = (await h.client(bob).post("/tenants", { slug: "globex", name: "Globex" })).body.id;
  await h.client(carol).get("/me");
  await A().post("/members", { email: "carol@example.com", roles: ["member"] });
  company = (await A().post("/companies", { name: "Initech", taxId: "NL123" })).body;
  contact = (await A().post("/contacts", { firstName: "Peter", lastName: "Gibbons", email: "peter@initech.com", companyId: company.id })).body;
});
afterAll(async () => { await relay.end(); await h.teardown(); });

describe("invoicing module", () => {
  it("is off until enabled and validates its settings", async () => {
    expect((await A().get(`${M}/invoices`)).status).toBe(404);
    expect((await A().patch("/modules/invoicing/settings", { numberFormat: "INV-{YYYY}" })).status).toBe(400);
    expect((await A().patch("/modules/invoicing/settings", { currency: "euro" })).status).toBe(400);
    expect((await A().patch("/modules/invoicing/settings", { sellerName: "Acme Ltd", defaultTaxRate: 21 })).status).toBe(200);
    expect((await A().post("/modules/invoicing/enable", {})).status).toBe(200);
    const cfg = (await A().get(`${M}/config`)).body;
    expect(cfg).toMatchObject({ currency: "EUR", paymentTermDays: 30, defaultTaxRate: 21, sellerName: "Acme Ltd", defaultDueDate: day(30) });
  });

  let inv1: string;
  it("creates a draft with exact totals and a billing snapshot", async () => {
    expect((await A().post(`${M}/invoices`, { lines: [line("x", 1, 100)] })).status).toBe(400);
    expect((await A().post(`${M}/invoices`, { companyId: company.id, issueDate: day(0), dueDate: day(-1), lines: [] })).status).toBe(400);
    expect((await A().post(`${M}/invoices`, { companyId: company.id, lines: [line("x", 1.0001, 100)] })).status).toBe(400);

    const r = await A().post(`${M}/invoices`, {
      contactId: contact.id, notes: "Thanks!",
      lines: [line("Consulting", 3, 1999, 21), line("Discount", 1, -500, 21)],
    });
    expect(r.status).toBe(201);
    inv1 = r.body.id;
    expect(r.body).toMatchObject({
      status: "draft", displayStatus: "draft", number: null, currency: "EUR", companyId: company.id, contactId: contact.id,
      billTo: { name: "Initech", contactName: "Peter Gibbons", email: "peter@initech.com", taxId: "NL123" },
      subtotalCents: 5497, taxCents: 1154, totalCents: 6651, paidCents: 0, dueDate: day(30),
    });
    expect(r.body.lines).toHaveLength(2);
    expect(r.body.lines[0]).toMatchObject({ position: 1, quantity: 3, unitPriceCents: 1999, taxRate: 21, netCents: 5997, taxCents: 1259 });
    expect(await types(tA)).toEqual(["invoicing.invoice.created"]);
  });

  it("edits drafts only, and numbers gaplessly on send", async () => {
    const p = await A().patch(`${M}/invoices/${inv1}`, { lines: [line("Consulting", 10, 15000, 21)] });
    expect(p.body).toMatchObject({ subtotalCents: 150000, taxCents: 31500, totalCents: 181500 });
    expect((await A().post(`${M}/invoices/${inv1}/payments`, { amountCents: 100 })).status).toBe(409);

    const s = await A().post(`${M}/invoices/${inv1}/send`, {});
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ status: "sent", displayStatus: "sent", number: `INV-${year}-00001` });
    expect((await A().post(`${M}/invoices/${inv1}/send`, {})).status).toBe(409);
    expect((await A().patch(`${M}/invoices/${inv1}`, { notes: "x" })).status).toBe(409);
    expect((await A().del(`${M}/invoices/${inv1}`)).status).toBe(409);

    // A deleted draft never consumes a number.
    const draft = (await A().post(`${M}/invoices`, { companyId: company.id, lines: [line("Temp", 1, 100)] })).body;
    expect((await A().del(`${M}/invoices/${draft.id}`)).status).toBe(204);
    expect((await A().get(`${M}/invoices/${draft.id}`)).status).toBe(404);
    const empty = (await A().post(`${M}/invoices`, { companyId: company.id })).body;
    expect((await A().post(`${M}/invoices/${empty.id}/send`, {})).body.title).toMatch(/at least one line/);
    await A().patch(`${M}/invoices/${empty.id}`, { lines: [line("Setup", 1, 25000)] });
    expect((await A().post(`${M}/invoices/${empty.id}/send`, {})).body.number).toBe(`INV-${year}-00002`);
  });

  it("records partial and full payments", async () => {
    expect((await A().post(`${M}/invoices/${inv1}/payments`, { amountCents: 181501 })).status).toBe(400);
    const part = await A().post(`${M}/invoices/${inv1}/payments`, { amountCents: 81500, paidOn: day(0), method: "Bank transfer", reference: "TX1" });
    expect(part.status).toBe(201);
    expect(part.body).toMatchObject({ status: "sent", displayStatus: "partially_paid", paidCents: 81500, balanceCents: 100000 });
    const full = await A().post(`${M}/invoices/${inv1}/payments`, { amountCents: 100000 });
    expect(full.body).toMatchObject({ status: "paid", displayStatus: "paid", balanceCents: 0 });
    expect(full.body.payments).toHaveLength(2);
    expect((await A().post(`${M}/invoices/${inv1}/payments`, { amountCents: 1 })).status).toBe(409);
    expect((await A().post(`${M}/invoices/${inv1}/void`, {})).status).toBe(409);
    const t = await types(tA);
    expect(t.filter((x) => x === "invoicing.payment.recorded")).toHaveLength(2);
    expect(t.filter((x) => x === "invoicing.invoice.paid")).toHaveLength(1);
  });

  it("voids, reminds, lists, filters and summarises", async () => {
    const v = (await A().post(`${M}/invoices`, { companyId: company.id, lines: [line("Oops", 1, 1000)] })).body;
    expect((await A().post(`${M}/invoices/${v.id}/void`, {})).status).toBe(409); // drafts are deleted, not voided
    await A().post(`${M}/invoices/${v.id}/send`, {});
    const voided = await A().post(`${M}/invoices/${v.id}/void`, { reason: "Duplicate" });
    expect(voided.body).toMatchObject({ status: "void", number: `INV-${year}-00003`, voidReason: "Duplicate", balanceCents: 0 });

    const open = (await A().get(`${M}/invoices?status=outstanding`)).body.data;
    expect(open.map((i: { number: string }) => i.number)).toEqual([`INV-${year}-00002`]);
    const rem = await A().post(`${M}/invoices/${open[0].id}/remind`, {});
    expect(rem.body).toEqual({ invoiceId: open[0].id, reminderCount: 1 });
    expect((await A().post(`${M}/invoices/${inv1}/remind`, {})).status).toBe(409);

    expect((await A().get(`${M}/invoices?status=paid`)).body.data).toHaveLength(1);
    expect((await A().get(`${M}/invoices?q=00003`)).body.data[0].id).toBe(v.id);
    expect((await A().get(`${M}/invoices?q=initech`)).body.data.length).toBeGreaterThanOrEqual(3);
    expect((await A().get(`${M}/invoices?contactId=${contact.id}`)).body.data.map((i: { id: string }) => i.id)).toEqual([inv1]);
    const page = (await A().get(`${M}/invoices?limit=2`)).body;
    expect(page.data).toHaveLength(2);
    const next = (await A().get(`${M}/invoices?limit=2&cursor=${page.nextCursor}`)).body;
    expect(next.data.every((i: { id: string }) => !page.data.some((p: { id: string }) => p.id === i.id))).toBe(true);

    const s = (await A().get(`${M}/summary`)).body;
    expect(s.currencies).toEqual([{ currency: "EUR", outstandingCents: 25000, overdueCents: 0, openCount: 1, overdueCount: 0, draftCount: 0, paidLast30Cents: 181500 }]);
    expect(await types(tA)).toEqual(expect.arrayContaining(["invoicing.invoice.voided", "invoicing.invoice.reminded"]));
  });

  it("enforces permissions and tenant isolation", async () => {
    expect((await h.client(carol, tA).get(`${M}/invoices`)).status).toBe(403);
    const B = h.client(bob, tB);
    await B.post("/modules/invoicing/enable", {});
    expect((await B.get(`${M}/invoices`)).body.data).toEqual([]);
    expect((await B.get(`${M}/invoices/${inv1}`)).status).toBe(404);
    expect((await B.post(`${M}/invoices/${inv1}/payments`, { amountCents: 1 })).status).toBe(404);
    // Another tenant's company cannot be billed.
    expect((await B.post(`${M}/invoices`, { companyId: company.id, lines: [line("x", 1, 100)] })).status).toBe(404);
    const co = (await B.post("/companies", { name: "Umbrella" })).body;
    const b1 = (await B.post(`${M}/invoices`, { companyId: co.id, lines: [line("x", 1, 100)] })).body;
    expect((await B.post(`${M}/invoices/${b1.id}/send`, {})).body.number).toBe(`INV-${year}-00001`); // own sequence
  });

  it("flags overdue invoices once via the scheduled job", async () => {
    const late = (await A().post(`${M}/invoices`, { companyId: company.id, issueDate: day(-40), dueDate: day(-10), lines: [line("Late", 1, 5000)] })).body;
    await A().post(`${M}/invoices/${late.id}/send`, {});
    expect((await A().get(`${M}/invoices/${late.id}`)).body.displayStatus).toBe("overdue");

    const deps = { db: h.db, registry: h.registry, secrets: h.secrets };
    expect(await runDueJobs(relay, deps)).toBe(2); // one job per tenant with the module enabled
    expect(await runDueJobs(relay, deps)).toBe(0); // not due again for an hour
    const overdue = (await h.events(tA, "invoicing.invoice.overdue"));
    expect(overdue).toHaveLength(1);
    expect(overdue[0]!.payload).toMatchObject({ id: late.id, daysOverdue: 10, balanceCents: 5000, customerName: "Initech" });

    await relay`update module_job_state set next_run_at = now()`;
    expect(await runDueJobs(relay, deps)).toBe(2);
    expect(await h.events(tA, "invoicing.invoice.overdue")).toHaveLength(1); // flagged once only
    const s = (await A().get(`${M}/summary`)).body.currencies[0];
    expect(s).toMatchObject({ overdueCents: 5000, overdueCount: 1 });

    // Disabled module: its job is skipped.
    await h.client(bob, tB).post("/modules/invoicing/disable", {});
    await relay`update module_job_state set next_run_at = now()`;
    expect(await runDueJobs(relay, deps)).toBe(1);
    const [st] = await relay`select last_error from module_job_state where tenant_id = ${tA}`;
    expect(st!.last_error).toBeNull();
  });

  it("drafts one invoice per won CRM deal", async () => {
    const deal = (eventId: string): EventEnvelope => ({
      id: eventId, tenantId: tA, type: "crm.deal.won", version: 1,
      payload: { id: "deal-1", title: "Website redesign", valueCents: 990000, currency: "USD", companyId: company.id },
      actor: { type: "system", id: "test" }, causationId: null, correlationId: eventId, depth: 0, occurredAt: new Date().toISOString(),
    });
    const runner = new InlineRunner(exec, 1);
    await dispatchEvent({ ...exec, runner }, deal("01900000-0000-7000-8000-000000000001"));
    await dispatchEvent({ ...exec, runner }, deal("01900000-0000-7000-8000-000000000002"));
    const drafts = (await A().get(`${M}/invoices?status=draft`)).body.data.filter((i: { source: string }) => i.source === "crm.deal");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ currency: "USD", subtotalCents: 990000, taxCents: 207900 }); // default tax 21%
  });

  it("workflow action creates and sends an invoice", async () => {
    const cat = (await A().get("/workflow-catalog")).body;
    expect(cat.actions.map((a: { key: string }) => a.key)).toEqual(expect.arrayContaining(["invoicing.create_invoice", "invoicing.send_reminder"]));
    expect(cat.events).toContain("invoicing.invoice.overdue");
    const wf = await A().post("/workflows", {
      name: "Setup fee", trigger: { event: "core.company.created" },
      actions: [{ key: "invoicing.create_invoice", input: { companyId: "{{payload.id}}", description: "Setup fee", amount: "250", taxRate: 0, dueInDays: 14, send: true } }],
    });
    expect(wf.status).toBe(201);
    const co = (await A().post("/companies", { name: "Hooli" })).body;
    await pump(tA);
    const runs = (await A().get(`/workflows/${wf.body.id}/runs`)).body;
    expect(runs[0]).toMatchObject({ status: "succeeded" });
    const list = (await A().get(`${M}/invoices?companyId=${co.id}`)).body.data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: "sent", source: "workflow", totalCents: 25000, dueDate: day(14), billTo: { name: "Hooli" } });
  });
});
