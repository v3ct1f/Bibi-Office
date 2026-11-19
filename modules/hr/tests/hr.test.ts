import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createModuleContext, loadEnabledModule, systemContext, type ExecDeps } from "@office/platform";
import { withTenant } from "@office/db";
import { MAIL, setup } from "../../../apps/api/test/harness.ts";
import hr from "../src/index.ts";
import { allowanceFor } from "../src/service.ts";

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF");
let h: Awaited<ReturnType<typeof setup>>;
let alice: string, carol: string, dave: string, erin: string, vera: string, bob: string, tA: string, tB: string, exec: ExecDeps;
const ids: Record<string, string> = {};
const emp: Record<string, string> = {};
let types: Record<string, string> = {};
const base = "/m/hr";
const c = (t: string) => h.client(t, tA);

beforeAll(async () => {
  h = await setup([hr]);
  exec = { db: h.db, registry: h.registry, secrets: h.secrets, files: h.files, mail: MAIL, http: { allowPrivate: true, requireHttps: false } };
  [alice, carol, dave, erin, vera, bob] = await Promise.all(["alice", "carol", "dave", "erin", "vera", "bob"].map((u) => h.token(u))) as [string, string, string, string, string, string];
  tA = (await h.client(alice).post("/tenants", { slug: "acme", name: "Acme" })).body.id;
  tB = (await h.client(bob).post("/tenants", { slug: "beta", name: "Beta" })).body.id;
  for (const [u, t] of [["alice", alice], ["carol", carol], ["dave", dave], ["erin", erin], ["vera", vera]] as const) ids[u] = (await h.client(t).get("/me")).body.userId;
  for (const u of ["carol", "dave", "erin"]) await c(alice).post("/members", { email: `${u}@example.com`, roles: ["member"] });
  await c(alice).post("/members", { email: "vera@example.com", roles: ["viewer"] });
  expect((await c(alice).patch("/modules/hr/settings", { defaultAllowance: 20 })).status).toBe(200);
  expect((await c(alice).post("/modules/hr/enable", {})).status).toBe(200);
  await h.client(bob, tB).post("/modules/hr/enable", {});
});
afterAll(() => h?.teardown());

describe("employee records", () => {
  it("HR creates people and links them to member accounts", async () => {
    const mk = async (b: Record<string, unknown>) => c(alice).post(`${base}/employees`, { startDate: "2026-01-01", ...b });
    const a = await mk({ firstName: "Alice", lastName: "Owner", userId: ids.alice, workEmail: "alice@acme.test", jobTitle: "CEO" });
    expect(a.status).toBe(201);
    emp.alice = a.body.id;
    const cr = await mk({ firstName: "Carol", lastName: "Chef", userId: ids.carol, workEmail: "Carol@Acme.test", jobTitle: "Head baker", department: "Kitchen", managerId: emp.alice, birthDate: "1990-05-01" });
    expect(cr.body).toMatchObject({ workEmail: "carol@acme.test", managerName: "Alice Owner", status: "active", private: true, birthDate: "1990-05-01" });
    emp.carol = cr.body.id;
    emp.dave = (await mk({ firstName: "Dave", lastName: "Dough", userId: ids.dave, workEmail: "dave@acme.test", department: "Kitchen", managerId: emp.carol, phone: "+49 1" })).body.id;
    emp.erin = (await mk({ firstName: "Erin", lastName: "Sales", userId: ids.erin, workEmail: "erin@acme.test", department: "Shop" })).body.id;
    expect((await c(alice).get(`${base}/employees/${emp.alice}`)).body.reports).toEqual([{ id: emp.carol, name: "Carol Chef", jobTitle: "Head baker" }]);
    expect((await h.events(tA, "hr.employee.created")).length).toBe(4);
  });
  it("rejects loops, duplicate links, non-members and bad dates", async () => {
    expect((await c(alice).patch(`${base}/employees/${emp.carol}`, { managerId: emp.dave })).body.title).toBe("That would make a management loop");
    expect((await c(alice).post(`${base}/employees`, { firstName: "X", startDate: "2026-01-01", userId: ids.dave })).status).toBe(409);
    expect((await c(alice).post(`${base}/employees`, { firstName: "X", startDate: "2026-01-01", userId: "00000000-0000-4000-8000-000000000001" })).status).toBe(422);
    expect((await c(alice).post(`${base}/employees`, { firstName: "X", startDate: "2026-01-01", workEmail: "dave@acme.test" })).status).toBe(409);
    expect((await c(alice).post(`${base}/employees`, { firstName: "X", startDate: "2026-05-01", endDate: "2026-04-01" })).status).toBe(422);
  });
  it("members see the directory without private details; their own record in full", async () => {
    const list = (await c(dave).get(`${base}/employees`)).body;
    expect(list.departments).toEqual(["Kitchen", "Shop"]);
    const carolRow = list.data.find((e: { id: string }) => e.id === emp.carol);
    expect(carolRow).toMatchObject({ name: "Carol Chef", private: false });
    expect(carolRow).not.toHaveProperty("birthDate");
    expect(list.data.find((e: { id: string }) => e.id === emp.dave)).toMatchObject({ isMe: true, private: true, phone: "+49 1" });
    expect(list.data.find((e: { id: string }) => e.id === emp.dave)).not.toHaveProperty("notes");
    expect((await c(dave).get(`${base}/employees?q=kitch`)).body.data).toHaveLength(2);
    expect((await c(vera).get(`${base}/employees`)).status).toBe(403);
  });
  it("people edit their own contact details; only HR edits records", async () => {
    expect((await c(dave).patch(`${base}/me`, { phone: "+49 2", address: "Main St 2" })).body).toMatchObject({ phone: "+49 2", address: "Main St 2" });
    expect((await c(dave).patch(`${base}/employees/${emp.dave}`, { jobTitle: "Boss" })).status).toBe(403);
    const audit = (await c(alice).get("/audit?limit=50")).body.data.find((x: { action: string }) => x.action === "hr.employee.self_updated");
    expect(audit.diff).toEqual({ changed: ["phone", "address"] });
  });
});

describe("time off", () => {
  let req: string;
  it("seeds leave types on enable", async () => {
    const t = (await c(dave).get(`${base}/leave-types`)).body.data;
    expect(t.map((x: { name: string }) => x.name)).toEqual(["Vacation", "Sick leave", "Unpaid leave"]);
    types = Object.fromEntries(t.map((x: { name: string; id: string }) => [x.name, x.id]));
  });
  it("counts working days minus holidays and holds them against the allowance", async () => {
    expect((await c(alice).post(`${base}/holidays`, { day: "2027-03-03", name: "Founders day" })).status).toBe(201);
    expect((await c(alice).post(`${base}/holidays`, { day: "2027-03-03", name: "Dup" })).status).toBe(409);
    const r = await c(dave).post(`${base}/leave`, { typeId: types.Vacation, startDate: "2027-03-01", endDate: "2027-03-07", note: "Ski trip" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ days: 4, status: "requested", typeName: "Vacation", employeeName: "Dave Dough", mine: true, canDecide: false, canCancel: true });
    req = r.body.id;
    const me = (await c(dave).get(`${base}/me`)).body;
    expect(me.balance).toMatchObject({ year: 2026 });
    expect((await c(dave).get(`${base}/employees/${emp.dave}`)).body.balance.year).toBe(2026);
    const [mail] = await h.flushMail();
    expect(mail).toMatchObject({ to: ["carol@acme.test"], subject: "Time off request: Dave Dough" });
    expect(mail!.text).toContain("2027-03-01 to 2027-03-07 (4 working days)");
    expect(mail!.text).toContain("https://app.office.test/m/hr/people");
  });
  it("refuses overlaps, year-spanning, empty and over-allowance requests", async () => {
    const r = (b: Record<string, unknown>) => c(dave).post(`${base}/leave`, { typeId: types.Vacation, ...b });
    expect((await r({ startDate: "2027-03-05", endDate: "2027-03-09" })).status).toBe(409);
    expect((await r({ startDate: "2027-12-30", endDate: "2028-01-03" })).body.title).toBe("Split requests at the new year");
    expect((await r({ startDate: "2027-03-13", endDate: "2027-03-14" })).body.title).toBe("There are no working days in that range");
    expect((await r({ startDate: "2027-04-01", endDate: "2027-05-31" })).body.title).toBe("Not enough time off left: 16 days available, 43 requested");
    expect((await r({ startDate: "2025-03-03", endDate: "2025-03-03" })).status).toBe(422);   // before employment
    expect((await r({ startDate: "2027-04-05", endDate: "2027-04-06", halfDay: true })).status).toBe(400);
  });
  it("only the manager or an approver decides; never on one's own request", async () => {
    expect((await c(dave).post(`${base}/leave/${req}/approve`, {})).status).toBe(403);
    expect((await c(erin).post(`${base}/leave/${req}/approve`, {})).status).toBe(404);   // can't even see it
    expect((await c(carol).get(`${base}/leave?scope=approvals`)).body.data.map((x: { id: string }) => x.id)).toEqual([req]);
    expect((await c(erin).get(`${base}/leave?scope=approvals`)).body.data).toEqual([]);
    const ok = await c(carol).post(`${base}/leave/${req}/approve`, { note: "Enjoy" });
    expect(ok.body).toMatchObject({ status: "approved", decidedBy: expect.any(String), decisionNote: "Enjoy" });
    expect((await c(carol).post(`${base}/leave/${req}/approve`, {})).status).toBe(409);
    const [mail] = await h.flushMail();
    expect(mail).toMatchObject({ to: ["dave@acme.test"], subject: "Time off approved: 2027-03-01 to 2027-03-07" });
    expect((await h.events(tA, "hr.leave.approved")).map((e) => (e.payload as { id: string }).id)).toContain(req);
    const b = (await c(dave).get(`${base}/leave?scope=mine&year=2027`)).body.data;
    expect(b).toHaveLength(1);
  });
  it("sick leave needs no approval and does not use allowance; half days count 0.5", async () => {
    const r = await c(dave).post(`${base}/leave`, { typeId: types["Sick leave"], startDate: "2027-03-10", endDate: "2027-03-10", halfDay: true });
    expect(r.body).toMatchObject({ status: "approved", days: 0.5, decidedBy: "auto" });
    expect(await h.flushMail()).toHaveLength(0);
  });
  it("rejections need a reason", async () => {
    const r = (await c(dave).post(`${base}/leave`, { typeId: types.Vacation, startDate: "2027-06-07", endDate: "2027-06-08" })).body;
    expect((await c(alice).post(`${base}/leave/${r.id}/reject`, {})).status).toBe(400);
    expect((await c(alice).post(`${base}/leave/${r.id}/reject`, { note: "Busy week" })).body).toMatchObject({ status: "rejected", decisionNote: "Busy week" });
    expect((await c(dave).post(`${base}/leave/${r.id}/cancel`, {})).status).toBe(409);
  });
  it("people cancel future time off; started time off only HR can cancel", async () => {
    expect((await c(dave).post(`${base}/leave/${req}/cancel`, {})).body.status).toBe("cancelled");
    const past = (await c(dave).post(`${base}/leave`, { typeId: types.Vacation, startDate: "2026-02-02", endDate: "2026-02-02" })).body;
    await c(carol).post(`${base}/leave/${past.id}/approve`, {});
    expect((await c(dave).post(`${base}/leave/${past.id}/cancel`, {})).status).toBe(403);
    expect((await c(alice).post(`${base}/leave/${past.id}/cancel`, {})).body.status).toBe("cancelled");
  });
  it("the calendar shows who's away; the reason only to those allowed", async () => {
    const v = (await c(dave).post(`${base}/leave`, { typeId: types.Vacation, startDate: "2027-03-15", endDate: "2027-03-16" })).body;
    const q = `${base}/calendar?from=2027-03-01&to=2027-03-31`;
    const asCarol = (await c(carol).get(q)).body, asErin = (await c(erin).get(q)).body;
    expect(asCarol.holidays).toEqual([{ day: "2027-03-03", name: "Founders day" }]);
    expect(asCarol.data.map((x: { type: string }) => x.type)).toEqual(["Sick leave", "Vacation"]);
    expect(asErin.data.map((x: { type: string | null; employeeName: string }) => [x.employeeName, x.type])).toEqual([["Dave Dough", null], ["Dave Dough", null]]);
    expect((await c(erin).get(`${base}/leave?scope=all&employeeId=${emp.dave}`)).status).toBe(403);
    expect((await c(erin).get(`${base}/employees/${emp.dave}`)).body.balance).toBeNull();
    expect((await c(alice).get(`${base}/calendar?from=2027-01-01&to=2027-12-31`)).status).toBe(400);
    expect(v.status).toBe("requested");
  });
  it("decided requests are a record", async () => {
    await expect(h.asOwner(tA, (tx) => tx`update hr_leave_requests set end_date = start_date + 30`)).rejects.toThrow(/cannot be edited/);
  });
  it("workflows can decide", async () => {
    const r = (await c(erin).post(`${base}/leave`, { typeId: types.Vacation, startDate: "2027-07-05", endDate: "2027-07-05" })).body;
    await withTenant(h.db, tA, async (tx) => {
      const l = (await loadEnabledModule(tx, exec, tA, "hr"))!;
      const ctx = createModuleContext(tx, systemContext(tA, "t", "workflow"), l.def, l.state);
      expect(await h.registry.action("hr.decide_leave")!.spec.run(ctx, { id: r.id, decision: "approve" })).toEqual({ id: r.id, status: "approved" });
    });
  });
  it("prorates the allowance for joiners and leavers", () => {
    const s = { defaultAllowance: 24, workDays: [1, 2, 3, 4, 5], timezone: "UTC", emailNotifications: true };
    const e = { annualAllowance: null, startDate: "2026-07-01", endDate: null } as never;
    expect(allowanceFor(e, s, 2026)).toBe(12);
    expect(allowanceFor(e, s, 2027)).toBe(24);
    expect(allowanceFor(e, s, 2025)).toBe(0);
    expect(allowanceFor({ annualAllowance: 30, startDate: "2020-01-01", endDate: "2026-03-31" } as never, s, 2026)).toBe(7.5);
  });
});

describe("documents", () => {
  let doc: string;
  it("HR uploads; the person reads; nobody else", async () => {
    const up = await c(alice).upload(`${base}/employees/${emp.dave}/documents?filename=contract.pdf&kind=contract&title=Employment%20contract`, PDF, "application/pdf");
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ kind: "contract", title: "Employment contract", mime: "application/pdf" });
    doc = up.body.id;
    expect((await c(dave).get(`${base}/employees/${emp.dave}/documents`)).body.data).toHaveLength(1);
    const dl = await c(dave).get(`${base}/employees/${emp.dave}/documents/${doc}`);
    expect(dl.status).toBe(200);
    expect(Buffer.compare(dl.raw, Buffer.from(PDF))).toBe(0);
    expect((await c(carol).get(`${base}/employees/${emp.dave}/documents`)).status).toBe(403);   // even the manager
    expect((await c(erin).get(`${base}/employees/${emp.dave}/documents/${doc}`)).status).toBe(403);
    expect((await c(dave).upload(`${base}/employees/${emp.dave}/documents?filename=x.pdf`, PDF, "application/pdf")).status).toBe(403);
    expect((await c(alice).get("/documents")).body.data).toHaveLength(0);   // module-private, hidden from core documents
  });
  it("HR removes documents", async () => {
    expect((await c(alice).del(`${base}/employees/${emp.dave}/documents/${doc}`)).status).toBe(204);
    expect((await c(dave).get(`${base}/employees/${emp.dave}/documents`)).body.data).toHaveLength(0);
  });
});

describe("leaving and isolation", () => {
  it("an end date emits 'left' and hides the person from the directory", async () => {
    await c(alice).patch(`${base}/employees/${emp.erin}`, { endDate: "2026-01-31" });
    expect((await h.events(tA, "hr.employee.left")).map((e) => (e.payload as { id: string }).id)).toEqual([emp.erin]);
    expect((await c(alice).get(`${base}/employees`)).body.data.map((e: { id: string }) => e.id)).not.toContain(emp.erin);
    expect((await c(alice).get(`${base}/employees?includeLeft=true`)).body.data.find((e: { id: string }) => e.id === emp.erin).status).toBe("left");
    const audit = (await c(alice).get("/audit?limit=100")).body.data.find((x: { action: string }) => x.action === "hr.employee.updated");
    expect(audit).toBeDefined();
  });
  it("other organizations see nothing", async () => {
    expect((await h.client(bob, tB).get(`${base}/employees/${emp.dave}`)).status).toBe(404);
    expect((await h.client(bob, tB).get(`${base}/employees`)).body.data).toHaveLength(0);
  });
  it("dashboard summary", async () => {
    const s = (await c(carol).get(`${base}/summary`)).body;
    expect(s).toMatchObject({ approvals: 1, balance: { allowance: 20 } });
  });
});
