import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dispatchEvent, InlineRunner, type ExecDeps } from "@office/platform";
import type { EventEnvelope } from "@office/sdk";
import crm from "@office/module-crm";
import leads from "@office/module-leads";
import { setup } from "./harness.ts";

let h: Awaited<ReturnType<typeof setup>>;
let alice: string, carol: string, bob: string, tA: string, tB: string;
let exec: ExecDeps;
const A = () => h.client(alice, tA);
const M = "/m/leads";

const seen = new Set<string>();
async function pump(tenantId: string) {
  const runner = new InlineRunner(exec, 1);
  for (let i = 0; i < 20; i++) {
    const evs = (await h.events(tenantId)).filter((e) => !seen.has(e.id));
    if (!evs.length) break;
    for (const e of evs) { seen.add(e.id); await dispatchEvent({ ...exec, runner }, e as EventEnvelope).catch(() => {}); }
  }
}
const types = async (tenantId: string) => (await h.events(tenantId)).map((e) => e.type).filter((t) => t.startsWith("leads."));
const pub = async (tenant: string, method: "GET" | "POST", path: string, body?: unknown) => {
  const res = await h.app.inject({ method, url: `/api/v1/public/t/${tenant}/m/leads${path}`, ...(body !== undefined ? { payload: body as object } : {}) });
  return { status: res.statusCode, body: res.body ? res.json() : null };
};

beforeAll(async () => {
  h = await setup([crm, leads]);
  exec = { db: h.db, registry: h.registry, secrets: h.secrets, http: { allowPrivate: true, requireHttps: false } };
  [alice, carol, bob] = await Promise.all([h.token("alice"), h.token("carol"), h.token("bob")]);
  tA = (await h.client(alice).post("/tenants", { slug: "acme", name: "Acme" })).body.id;
  tB = (await h.client(bob).post("/tenants", { slug: "globex", name: "Globex" })).body.id;
  await h.client(carol).get("/me");
  await h.join(tA, alice, carol, ["viewer"]);
});
afterAll(async () => { await h.teardown(); });

describe("leads module", () => {
  let leadId: string;

  it("is off until enabled", async () => {
    expect((await A().get(`${M}/leads`)).status).toBe(403);
    expect((await A().post("/modules/leads/enable", {})).status).toBe(200);
    expect((await A().get(`${M}/leads`)).body).toEqual({ data: [], nextCursor: null });
  });

  it("adds a lead owned by whoever added it; needs someone to reach", async () => {
    expect((await A().post(`${M}/leads`, { notes: "just a note" })).status).toBe(400);
    expect((await A().post(`${M}/leads`, { firstName: "X", email: "not-an-email" })).status).toBe(400);
    const r = await A().post(`${M}/leads`, {
      firstName: "Peter", lastName: "Gibbons", email: "Peter@Initech.com", companyName: "Initech", source: "referral", valueCents: 250000,
    });
    expect(r.status).toBe(201);
    leadId = r.body.id;
    expect(r.body).toMatchObject({ name: "Peter Gibbons", email: "peter@initech.com", status: "new", source: "referral", currency: "EUR", ownerName: "alice" });
    expect(r.body.activities[0]).toMatchObject({ kind: "system", body: "Lead added (Referral)" });
    expect(await types(tA)).toEqual(["leads.lead.created"]);
  });

  it("viewers can look but not change; other businesses can't see it", async () => {
    const c = h.client(carol, tA);
    expect((await c.get(`${M}/leads/${leadId}`)).status).toBe(200);
    expect((await c.post(`${M}/leads`, { firstName: "Y" })).status).toBe(403);
    expect((await c.post(`${M}/leads/${leadId}/status`, { status: "qualified" })).status).toBe(403);
    await h.client(bob, tB).post("/modules/leads/enable", {});
    expect((await h.client(bob, tB).get(`${M}/leads/${leadId}`)).status).toBe(404);
  });

  it("logging a call marks a new lead as contacted; status changes are on the timeline", async () => {
    await A().post(`${M}/leads/${leadId}/activities`, { kind: "call", body: "Wants a quote for 10 seats" });
    let l = (await A().get(`${M}/leads/${leadId}`)).body;
    expect(l.status).toBe("contacted");
    expect(l.activities.map((a: { body: string }) => a.body)).toEqual(expect.arrayContaining(["Wants a quote for 10 seats", "New → Contacted"]));
    l = (await A().post(`${M}/leads/${leadId}/status`, { status: "qualified" })).body;
    expect(l.status).toBe("qualified");
    expect(await types(tA)).toEqual(expect.arrayContaining(["leads.lead.status_changed", "leads.lead.qualified", "leads.activity.logged"]));
  });

  it("disqualifies with a reason and reopens", async () => {
    const other = (await A().post(`${M}/leads`, { companyName: "Spam Inc" })).body;
    let r = (await A().post(`${M}/leads/${other.id}/status`, { status: "disqualified", reason: "Not a good fit" })).body;
    expect(r).toMatchObject({ status: "disqualified", disqualifyReason: "Not a good fit" });
    expect((await A().get(`${M}/leads?view=open`)).body.data.map((x: { id: string }) => x.id)).not.toContain(other.id);
    expect((await A().get(`${M}/leads?view=disqualified`)).body.data.map((x: { id: string }) => x.id)).toEqual([other.id]);
    r = (await A().post(`${M}/leads/${other.id}/status`, { status: "contacted" })).body;
    expect(r).toMatchObject({ status: "contacted", disqualifyReason: null });
    expect((await A().post(`${M}/leads/${other.id}/status`, { status: "converted" })).status).toBe(400);
    expect((await A().get(`${M}/leads?q=spam`)).body.data).toHaveLength(1);
  });

  it("converts into a contact and company, and CRM (when on) opens the deal", async () => {
    await A().post("/modules/crm/enable", {});
    // An existing company with the same name is reused.
    const initech = (await A().post("/companies", { name: "initech" })).body;
    const r = await A().post(`${M}/leads/${leadId}/convert`, { company: true, deal: { title: "10 seats", valueCents: 500000 } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "converted", companyId: initech.id, companyReused: true, contactReused: false });
    const contact = (await A().get(`/contacts/${r.body.contactId}`)).body;
    expect(contact).toMatchObject({ firstName: "Peter", lastName: "Gibbons", email: "peter@initech.com", companyId: initech.id });
    expect((await A().post(`${M}/leads/${leadId}/convert`, {})).status).toBe(409);
    expect((await A().post(`${M}/leads/${leadId}/status`, { status: "new" })).status).toBe(409);

    await pump(tA);
    const deals = (await A().get(`/m/crm/deals?contactId=${r.body.contactId}`)).body.data;
    expect(deals).toEqual([expect.objectContaining({ title: "10 seats", valueCents: 500000, companyId: initech.id, status: "open" })]);
    const deal = (await A().get(`/m/crm/deals/${deals[0].id}`)).body;
    expect(deal.activities.map((a: { body: string }) => a.body)).toContain("Created from a lead (Peter Gibbons)");
  });

  it("a second lead with the same email links to the existing contact; no deal unless asked", async () => {
    const l = (await A().post(`${M}/leads`, { email: "peter@initech.com" })).body;
    const r = (await A().post(`${M}/leads/${l.id}/convert`, { company: false })).body;
    expect(r).toMatchObject({ contactReused: true, companyId: null });
    const before = (await A().get("/m/crm/deals")).body.data.length;
    await pump(tA);
    expect((await A().get("/m/crm/deals")).body.data).toHaveLength(before);
  });

  it("summary counts what's left to work on", async () => {
    await A().post(`${M}/leads`, { firstName: "Due", followUpOn: "2020-01-01" });
    const s = (await A().get(`${M}/summary`)).body;
    expect(s).toMatchObject({ byStatus: { new: 1, contacted: 1, qualified: 0 }, open: 2, followUpsDue: 1, conversionRate90d: 100 });
  });

  it("the web form is off until turned on, then makes leads (and ignores bots)", async () => {
    const f = (await A().get(`${M}/form`)).body;
    expect(f).toMatchObject({ enabled: false, path: `/p/${tA}/leads/form/${f.token}` });
    expect((await pub(tA, "GET", `/form/${f.token}`)).status).toBe(404);
    expect((await h.client(carol, tA).patch(`${M}/form`, { enabled: true })).status).toBe(403);
    await A().patch(`${M}/form`, { enabled: true, heading: "Talk to us", askPhone: false });

    expect((await pub(tA, "GET", `/form/${f.token}`)).body).toEqual({ heading: "Talk to us", intro: expect.any(String), askPhone: false, askCompany: true });
    expect((await pub(tB, "GET", `/form/${f.token}`)).status).toBe(404); // the token belongs to another business
    expect((await pub(tA, "POST", `/form/${f.token}`, { name: "Joanna", email: "nope" })).status).toBe(400);

    const sent = await pub(tA, "POST", `/form/${f.token}`, { name: "Joanna Smith", email: "Joanna@Chotchkies.com", phone: "123", company: "Chotchkie's", message: "Need flair" });
    expect(sent).toEqual({ status: 201, body: { thanks: expect.any(String) } });
    let list = (await A().get(`${M}/leads?source=web_form`)).body.data;
    expect(list).toEqual([expect.objectContaining({ name: "Joanna Smith", email: "joanna@chotchkies.com", phone: null, companyName: "Chotchkie's", message: "Need flair", ownerId: null })]);

    // Writing again adds to the same open lead.
    await pub(tA, "POST", `/form/${f.token}`, { name: "Joanna Smith", email: "joanna@chotchkies.com", message: "Any news?" });
    list = (await A().get(`${M}/leads?source=web_form`)).body.data;
    expect(list).toHaveLength(1);
    expect((await A().get(`${M}/leads/${list[0].id}`)).body.activities[0].body).toContain("Any news?");

    // A bot fills in the hidden field: thanked, nothing kept.
    expect((await pub(tA, "POST", `/form/${f.token}`, { name: "Bot", email: "bot@spam.test", website: "http://spam" })).status).toBe(201);
    expect((await A().get(`${M}/leads?q=bot`)).body.data).toHaveLength(0);

    // A new link stops the old one.
    const g = (await A().post(`${M}/form/replace-link`, {})).body;
    expect(g.token).not.toBe(f.token);
    expect((await pub(tA, "GET", `/form/${f.token}`)).status).toBe(404);
    expect((await pub(tA, "GET", `/form/${g.token}`)).status).toBe(200);
  });

  it("deleting a lead keeps the contact made from it", async () => {
    const contactId = (await A().get(`${M}/leads/${leadId}`)).body.contactId;
    const del = await A().del(`${M}/leads/${leadId}`);
    expect(del.status).toBe(204);
    expect((await A().get(`${M}/leads/${leadId}`)).status).toBe(404);
    expect((await A().get(`/contacts/${contactId}`)).status).toBe(200);
  });
});
