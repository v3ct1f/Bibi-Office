import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dispatchEvent, InlineRunner, type ExecDeps } from "@office/platform";
import type { EventEnvelope } from "@office/sdk";
import crm from "@office/module-crm";
import invoicing from "@office/module-invoicing";
import { setup } from "./harness.ts";

let h: Awaited<ReturnType<typeof setup>>;
let alice: string, carol: string, bob: string, tA: string, tB: string;
let exec: ExecDeps;
let company: { id: string }, contact: { id: string };
const A = () => h.client(alice, tA);
const M = "/m/crm";

const seen = new Set<string>();
async function pump(tenantId: string) {
  const runner = new InlineRunner(exec, 1);
  for (let i = 0; i < 20; i++) {
    const evs = (await h.events(tenantId)).filter((e) => !seen.has(e.id));
    if (!evs.length) break;
    for (const e of evs) { seen.add(e.id); await dispatchEvent({ ...exec, runner }, e as EventEnvelope).catch(() => {}); }
  }
}
const types = async (tenantId: string) => (await h.events(tenantId)).map((e) => e.type).filter((t) => t.startsWith("crm."));

beforeAll(async () => {
  h = await setup([crm, invoicing]);
  exec = { db: h.db, registry: h.registry, secrets: h.secrets, http: { allowPrivate: true, requireHttps: false } };
  [alice, carol, bob] = await Promise.all([h.token("alice"), h.token("carol"), h.token("bob")]);
  tA = (await h.client(alice).post("/tenants", { slug: "acme", name: "Acme" })).body.id;
  tB = (await h.client(bob).post("/tenants", { slug: "globex", name: "Globex" })).body.id;
  await h.client(carol).get("/me");
  await h.join(tA, alice, carol, ["viewer"]);
  company = (await A().post("/companies", { name: "Initech" })).body;
  contact = (await A().post("/contacts", { firstName: "Peter", lastName: "Gibbons", companyId: company.id })).body;
});
afterAll(async () => { await h.teardown(); });

describe("crm module", () => {
  let pipeline: { id: string; stages: { id: string; name: string; kind: string }[] };
  const stage = (name: string) => pipeline.stages.find((s) => s.name === name)!.id;

  it("is off until enabled, then seeds a default Sales pipeline", async () => {
    expect((await A().get(`${M}/pipelines`)).status).toBe(403);
    expect((await A().post("/modules/crm/enable", {})).status).toBe(200);
    const ps = (await A().get(`${M}/pipelines`)).body;
    expect(ps).toHaveLength(1);
    pipeline = ps[0];
    expect(pipeline).toMatchObject({ name: "Sales" });
    expect(pipeline.stages.map((s) => s.name)).toEqual(["Lead", "Qualified", "Proposal sent", "Negotiation", "Won", "Lost"]);
    // Re-enabling does not seed a second pipeline.
    await A().post("/modules/crm/disable", {});
    await A().post("/modules/crm/enable", {});
    expect((await A().get(`${M}/pipelines`)).body).toHaveLength(1);
  });

  let dealId: string;
  it("creates deals in the first stage with customer names and an activity", async () => {
    expect((await A().post(`${M}/deals`, { title: "" })).status).toBe(400);
    expect((await A().post(`${M}/deals`, { title: "X", companyId: "00000000-0000-7000-8000-000000000000" })).status).toBe(400);
    const r = await A().post(`${M}/deals`, { title: "Website redesign", valueCents: 500000, companyId: company.id, contactId: contact.id, nextStep: "Send proposal" });
    expect(r.status).toBe(201);
    dealId = r.body.id;
    expect(r.body).toMatchObject({
      status: "open", stageName: "Lead", currency: "EUR", valueCents: 500000, companyName: "Initech", contactName: "Peter Gibbons", nextStep: "Send proposal",
    });
    expect(r.body.activities[0]).toMatchObject({ kind: "system", body: "Deal created in Lead" });
    expect(await types(tA)).toEqual(["crm.deal.created"]);
  });

  it("moves through stages, logs activity and wins: Invoicing drafts an invoice once", async () => {
    let r = await A().post(`${M}/deals/${dealId}/move`, { stageId: stage("Proposal sent") });
    expect(r.body).toMatchObject({ status: "open", stageName: "Proposal sent", probability: 50 });
    expect(r.body.activities[0].body).toBe("Moved from Lead to Proposal sent");

    const n = await A().post(`${M}/deals/${dealId}/activities`, { kind: "call", body: "Called Peter, budget approved" });
    expect(n.status).toBe(201);
    expect((await A().post(`${M}/deals/${dealId}/activities`, { kind: "stage", body: "x" })).status).toBe(400);

    r = await A().post(`${M}/deals/${dealId}/move`, { stageId: stage("Won") });
    expect(r.body).toMatchObject({ status: "won", stageName: "Won" });
    expect(r.body.closedAt).toBeTruthy();
    await pump(tA);
    const invs = (await A().get("/m/invoicing/invoices")).status;
    expect(invs).toBe(403); // invoicing not enabled yet: nothing happens

    await A().post("/modules/invoicing/enable", {});
    // Reopen and win again: now Invoicing drafts exactly one invoice.
    await A().post(`${M}/deals/${dealId}/move`, { stageId: stage("Negotiation") });
    await A().post(`${M}/deals/${dealId}/move`, { stageId: stage("Won") });
    await A().post(`${M}/deals/${dealId}/move`, { stageId: stage("Negotiation") });
    await A().post(`${M}/deals/${dealId}/move`, { stageId: stage("Won") });
    await pump(tA);
    const list = (await A().get("/m/invoicing/invoices")).body.data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: "draft", companyId: company.id, totalCents: 500000, source: "crm.deal" });

    const t = await types(tA);
    expect(t.filter((x) => x === "crm.deal.won")).toHaveLength(3);
    expect(t).toContain("crm.deal.reopened");
    expect(t).toContain("crm.activity.logged");
    const won = (await h.events(tA)).filter((e) => e.type === "crm.deal.won").at(-1)!;
    expect(won.payload).toMatchObject({ id: dealId, title: "Website redesign", valueCents: 500000, currency: "EUR", companyId: company.id, contactId: contact.id });
  });

  it("marks deals lost with a reason, edits fields, lists, boards and summarises", async () => {
    const d = (await A().post(`${M}/deals`, { title: "Support contract", valueCents: 120000, contactId: contact.id })).body;
    const lost = await A().post(`${M}/deals/${d.id}/move`, { stageId: stage("Lost"), lostReason: "Went with a competitor" });
    expect(lost.body).toMatchObject({ status: "lost", lostReason: "Went with a competitor" });
    expect(lost.body.activities[0].body).toBe("Marked as lost: Went with a competitor");

    const open = (await A().post(`${M}/deals`, { title: "Training", valueCents: 200000, stageId: stage("Qualified") })).body;
    const p = await A().patch(`${M}/deals/${open.id}`, { valueCents: 250000, expectedClose: "2030-01-31", nextStep: "" });
    expect(p.body).toMatchObject({ valueCents: 250000, expectedClose: "2030-01-31", nextStep: null });

    expect((await A().get(`${M}/deals?status=open`)).body.data.map((x: { title: string }) => x.title)).toEqual(["Training"]);
    expect((await A().get(`${M}/deals?companyId=${company.id}`)).body.data).toHaveLength(1);
    expect((await A().get(`${M}/deals?q=supp`)).body.data).toHaveLength(1);

    const b = (await A().get(`${M}/board`)).body;
    expect(b.pipeline.name).toBe("Sales");
    const col = (name: string) => b.columns.find((c: { stage: { name: string } }) => c.stage.name === name);
    expect(col("Qualified").deals).toHaveLength(1);
    expect(col("Qualified").totals).toEqual({ EUR: 250000 });
    expect(col("Won").deals).toHaveLength(1);
    expect(col("Lost").deals).toHaveLength(1);

    const s = (await A().get(`${M}/summary`)).body;
    expect(s.currencies[0]).toMatchObject({ currency: "EUR", openCount: 1, openCents: 250000, weightedCents: 62500, wonMonthCount: 1, wonMonthCents: 500000 });
    expect(s.winRate90d).toBe(50);
  });

  it("edits pipelines safely", async () => {
    // Removing a stage that still has deals is refused; renaming and adding is fine.
    const st = pipeline.stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind, probability: 10 }));
    const withoutQualified = st.filter((s) => s.name !== "Qualified");
    expect((await A().patch(`${M}/pipelines/${pipeline.id}`, { stages: withoutQualified })).status).toBe(409);
    expect((await A().patch(`${M}/pipelines/${pipeline.id}`, { stages: st.filter((s) => s.kind !== "lost") })).status).toBe(400);
    const r = await A().patch(`${M}/pipelines/${pipeline.id}`, {
      name: "New business", stages: [...st.slice(0, 1), { name: "Demo booked", kind: "open", probability: 30 }, ...st.slice(1)],
    });
    expect(r.status).toBe(200);
    expect(r.body.name).toBe("New business");
    expect(r.body.stages.map((s: { name: string }) => s.name)).toContain("Demo booked");

    const second = await A().post(`${M}/pipelines`, { name: "Partnerships" });
    expect(second.status).toBe(201);
    expect(second.body.stages).toHaveLength(6);
    expect((await A().del(`${M}/pipelines/${second.body.id}`)).status).toBe(204);
    expect((await A().del(`${M}/pipelines/${pipeline.id}`)).status).toBe(409);
  });

  it("workflow actions create, note and move deals", async () => {
    const cat = (await A().get("/workflow-catalog")).body;
    expect(cat.events).toContain("crm.deal.won");
    expect(cat.actions.map((a: { key: string }) => a.key)).toEqual(expect.arrayContaining(["crm.create_deal", "crm.move_deal", "crm.log_activity"]));
    const wf = await A().post("/workflows", {
      name: "Deal for new companies", trigger: { event: "core.company.created" },
      actions: [
        { key: "crm.create_deal", input: { title: "Intro: {{payload.name}}", amount: "1000", companyId: "{{payload.id}}" } },
        { key: "crm.log_activity", input: { dealId: "{{steps.0.dealId}}", body: "Created by a workflow" } },
        { key: "crm.move_deal", input: { dealId: "{{steps.0.dealId}}", stage: "Demo booked" } },
      ],
    });
    expect(wf.status).toBe(201);
    await A().post("/companies", { name: "Globochem" });
    await pump(tA);
    const d = (await A().get(`${M}/deals?q=Globochem`)).body.data[0];
    expect(d).toMatchObject({ title: "Intro: Globochem", valueCents: 100000, companyName: "Globochem", stageName: "Demo booked" });
    const full = (await A().get(`${M}/deals/${d.id}`)).body;
    expect(full.activities.map((a: { body: string }) => a.body)).toContain("Created by a workflow");
  });

  it("enforces permissions and tenant isolation", async () => {
    const C = () => h.client(carol, tA);
    expect((await C().get(`${M}/board`)).status).toBe(200); // viewers may look at deals...
    expect((await C().post(`${M}/deals`, { title: "nope" })).status).toBe(403); // ...but not change them
    const B = () => h.client(bob, tB);
    await B().post("/modules/crm/enable", {});
    expect((await B().get(`${M}/deals/${dealId}`)).status).toBe(404);
    expect((await B().get(`${M}/deals`)).body.data).toHaveLength(0);
    expect((await B().post(`${M}/deals`, { title: "x", companyId: company.id })).status).toBe(400);
    expect((await A().del(`${M}/deals/${dealId}`)).status).toBe(204);
    expect((await A().get(`${M}/deals/${dealId}`)).status).toBe(404);
  });
});
