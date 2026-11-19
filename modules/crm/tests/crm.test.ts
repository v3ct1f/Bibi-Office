import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dispatchEvent, InlineRunner, type ExecDeps } from "@office/platform";
import type { EventEnvelope } from "@office/sdk";
import { setup } from "../../../apps/api/test/harness.ts";
import crm from "../src/index.ts";
import invoicing from "../../invoicing/src/index.ts"; // test-only: proves the event contract between the two modules

let h: Awaited<ReturnType<typeof setup>>;
let alice: string, carol: string, tA: string, exec: ExecDeps, aliceId: string;
let contactId: string, companyId: string;
const C = () => h.client(alice, tA);

const seen = new Set<string>();
async function pump(tenantId = tA) {
  const runner = new InlineRunner(exec, 1);
  for (let i = 0; i < 20; i++) {
    const evs = (await h.events(tenantId)).filter((e) => !seen.has(e.id));
    if (!evs.length) break;
    for (const e of evs) { seen.add(e.id); await dispatchEvent({ ...exec, runner }, e as EventEnvelope); }
  }
}
const types = async () => (await h.events(tA)).map((e) => e.type).filter((t) => t.startsWith("crm."));

beforeAll(async () => {
  h = await setup([invoicing, crm]);
  exec = { db: h.db, registry: h.registry, secrets: h.secrets, files: h.files, http: { allowPrivate: true, requireHttps: false } };
  [alice, carol] = await Promise.all([h.token("alice"), h.token("carol")]);
  tA = (await h.client(alice).post("/tenants", { slug: "acme", name: "Acme" })).body.id;
  aliceId = (await h.client(alice).get("/me")).body.userId;
  await h.client(carol).get("/me");
  await C().post("/members", { email: "carol@example.com", roles: ["member"] });
  companyId = (await C().post("/companies", { name: "Globex" })).body.id;
  contactId = (await C().post("/contacts", { firstName: "Hank", email: "hank@globex.test", companyId })).body.id;
  expect((await C().post("/modules/crm/enable", {})).status).toBe(200);
});
afterAll(() => h?.teardown());

describe("pipeline stages", () => {
  it("seeds default stages on enable (once)", async () => {
    const s = (await C().get("/m/crm/stages")).body.data;
    expect(s.map((x: { name: string }) => x.name)).toEqual(["Lead", "Qualified", "Proposal", "Negotiation"]);
    await C().post("/modules/crm/disable", {});
    await C().post("/modules/crm/enable", {});
    expect((await C().get("/m/crm/stages")).body.data).toHaveLength(4);
  });
  it("adds, renames, reorders and deletes stages", async () => {
    const won = (await C().post("/m/crm/stages", { name: "Contract sent", probability: 90 })).body;
    expect(won).toMatchObject({ position: 4, probability: 90 });
    expect((await C().patch(`/m/crm/stages/${won.id}`, { name: "Contract" })).body.name).toBe("Contract");
    const ids = (await C().get("/m/crm/stages")).body.data.map((x: { id: string }) => x.id);
    expect((await C().put("/m/crm/stages/order", { ids: ids.slice(1) })).status).toBe(422);
    const r = await C().put("/m/crm/stages/order", { ids: [ids[4], ...ids.slice(0, 4)] });
    expect(r.body.data[0].name).toBe("Contract");
    expect((await C().del(`/m/crm/stages/${won.id}`)).status).toBe(204);
  });
  it("members can't manage the pipeline", async () => {
    expect((await h.client(carol, tA).post("/m/crm/stages", { name: "x" })).status).toBe(403);
  });
});

describe("deals", () => {
  let id: string, stages: { id: string; name: string }[];
  it("creates in the first stage, owned by the creator", async () => {
    stages = (await C().get("/m/crm/stages")).body.data;
    const r = await C().post("/m/crm/deals", { title: "Website redesign", value: 1_250_000, contactId, companyId });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: "open", currency: "EUR", stageId: stages[0]!.id, ownerId: aliceId, stage: { name: "Lead" }, stale: false });
    id = r.body.id;
    expect((await C().post("/m/crm/deals", { title: "x", ownerId: "00000000-0000-7000-8000-000000000000" })).status).toBe(400); // not a member
    expect((await C().post("/m/crm/deals", { title: "x", contactId: "00000000-0000-7000-8000-000000000000" })).status).toBe(404);
  });
  it("moves through stages and shows on the board", async () => {
    const m = await C().post(`/m/crm/deals/${id}/move`, { stageId: stages[2]!.id });
    expect(m.body.stage.name).toBe("Proposal");
    const b = (await C().get("/m/crm/board")).body.stages;
    expect(b[2]).toMatchObject({ name: "Proposal", count: 1, totals: { EUR: 1_250_000 } });
    const ev = (await h.events(tA, "crm.deal.stage_changed")).at(-1)!;
    expect(ev.payload).toMatchObject({ fromStageId: stages[0]!.id, toStageName: "Proposal" });
    expect((await C().del(`/m/crm/stages/${stages[2]!.id}`)).status).toBe(409); // stage has deals
  });
  it("edits, filters and searches", async () => {
    const u = await C().patch(`/m/crm/deals/${id}`, { value: 1_500_000, expectedClose: "2026-12-31" });
    expect(u.body).toMatchObject({ value: 1_500_000, expectedClose: "2026-12-31" });
    expect((await C().get(`/m/crm/deals?companyId=${companyId}`)).body.data).toHaveLength(1);
    expect((await C().get("/m/crm/deals?q=redesign")).body.data).toHaveLength(1);
    expect((await C().get("/m/crm/deals?status=won")).body.data).toHaveLength(0);
  });
  it("won deal drafts an invoice once (crm.deal.won -> invoicing)", async () => {
    await C().post("/modules/invoicing/enable", {});
    await pump();
    const w = await C().post(`/m/crm/deals/${id}/won`, {});
    expect(w.body).toMatchObject({ status: "won", closedAt: expect.any(String) });
    expect((await C().post(`/m/crm/deals/${id}/won`, {})).status).toBe(409);
    expect((await C().post(`/m/crm/deals/${id}/move`, { stageId: stages[0]!.id })).status).toBe(409);
    await pump();
    const inv = (await C().get(`/m/invoicing/invoices?companyId=${companyId}`)).body.data;
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ status: "draft", total: 1_500_000, contactId, companyId });
    // paying that invoice notes it on the deal's timeline (invoicing.invoice.paid -> crm)
    await C().post(`/m/invoicing/invoices/${inv[0].id}/issue`, {});
    await C().post(`/m/invoicing/invoices/${inv[0].id}/payments`, { amount: 1_500_000 });
    await pump();
    const acts = (await C().get(`/m/crm/activities?dealId=${id}`)).body.data;
    expect(acts[0].subject).toMatch(/^Invoice INV-\d{4}-00001 paid \(€15,000\.00\)$/);
  });
  it("lost with reason, reopen, delete", async () => {
    const d = (await C().post("/m/crm/deals", { title: "Small job", value: 50_000 })).body.id;
    expect((await C().post(`/m/crm/deals/${d}/lost`, { reason: "Price" })).body).toMatchObject({ status: "lost", lostReason: "Price" });
    expect((await C().post(`/m/crm/deals/${d}/reopen`, {})).body).toMatchObject({ status: "open", lostReason: null, closedAt: null });
    expect((await C().del(`/m/crm/deals/${d}`)).status).toBe(204);
    expect(await types()).toEqual(expect.arrayContaining(["crm.deal.created", "crm.deal.won", "crm.deal.lost", "crm.deal.reopened"]));
  });
});

describe("activities", () => {
  it("logs notes (done) and tasks (open), inheriting the deal's contact/company", async () => {
    const d = (await C().post("/m/crm/deals", { title: "Support plan", contactId })).body.id;
    const note = await C().post("/m/crm/activities", { type: "call", subject: "Intro call", dealId: d });
    expect(note.body).toMatchObject({ type: "call", doneAt: expect.any(String), contactId, dealId: d });
    const due = new Date(Date.now() - 3600_000).toISOString();
    const task = (await C().post("/m/crm/activities", { type: "task", subject: "Send proposal", dealId: d, dueAt: due })).body;
    expect(task).toMatchObject({ doneAt: null, overdue: true });
    expect((await C().get(`/m/crm/activities?contactId=${contactId}`)).body.data.length).toBeGreaterThanOrEqual(2);
    expect((await C().get("/m/crm/activities?open=true")).body.data.map((a: { id: string }) => a.id)).toEqual([task.id]);
    expect((await C().get("/m/crm/summary")).body.tasksDue).toBe(1);
    const done = await C().patch(`/m/crm/activities/${task.id}`, { done: true });
    expect(done.body).toMatchObject({ overdue: false, doneAt: expect.any(String) });
    expect(await types()).toContain("crm.activity.completed");
    expect((await C().post("/m/crm/activities", { subject: "orphan" })).status).toBe(422);
    expect((await C().del(`/m/crm/activities/${task.id}`)).status).toBe(204);
  });
  it("summarizes the pipeline", async () => {
    const s = (await C().get("/m/crm/summary")).body.data[0];
    expect(s).toMatchObject({ currency: "EUR", wonCount: 1, wonValue: 1_500_000, openCount: 1 });
  });
});

describe("security + workflows", () => {
  it("isolates tenants and enforces permissions", async () => {
    const id = (await C().get("/m/crm/deals?limit=1")).body.data[0].id;
    expect((await h.client(carol, tA).get("/m/crm/deals")).status).toBe(403);
    const bob = await h.token("bob");
    const tB = (await h.client(bob).post("/tenants", { slug: "globex", name: "Globex" })).body.id;
    await h.client(bob, tB).post("/modules/crm/enable", {});
    expect((await h.client(bob, tB).get(`/m/crm/deals/${id}`)).status).toBe(404);
    expect((await h.client(bob, tB).post("/m/crm/activities", { subject: "x", dealId: id })).status).toBe(404);
    expect((await h.client(bob, tB).get("/m/crm/board")).body.stages.every((s: { count: number }) => s.count === 0)).toBe(true);
    // another tenant's stage id is rejected
    const stageA = (await C().get("/m/crm/stages")).body.data[0].id;
    expect((await h.client(bob, tB).post("/m/crm/deals", { title: "x", stageId: stageA })).status).toBe(422);
  });
  it("workflow: new company contact -> deal + follow-up task", async () => {
    await pump();
    const wf = await C().post("/workflows", {
      name: "Inbound lead", trigger: { event: "core.contact.created" },
      conditions: { "==": [{ var: "payload.lastName" }, "Lead"] },
      actions: [
        { key: "crm.create_deal", input: { title: "Inbound: {{payload.firstName}}", contactId: "{{payload.id}}" } },
        { key: "crm.log_activity", input: { type: "task", subject: "Call {{payload.firstName}}", dealId: "{{steps.0.id}}", dueInDays: 1 } },
      ],
    });
    expect(wf.status).toBe(201);
    await C().post("/contacts", { firstName: "Iris", lastName: "Lead" });
    await pump();
    const runs = (await C().get(`/workflows/${wf.body.id}/runs`)).body;
    expect(runs[0]).toMatchObject({ status: "succeeded" });
    const deal = (await C().get(`/m/crm/deals/${runs[0].steps[0].output.id}`)).body;
    expect(deal.title).toBe("Inbound: Iris");
    expect((await C().get(`/m/crm/activities?dealId=${deal.id}`)).body.data[0]).toMatchObject({ subject: "Call Iris", type: "task", doneAt: null });
  });
});
