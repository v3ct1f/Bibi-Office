import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { dispatchEvent, InlineRunner, runDueJobs, type ExecDeps } from "@office/platform";
import type { EventEnvelope } from "@office/sdk";
import hr from "@office/module-hr";
import scheduling from "@office/module-scheduling";
import { workingDaysByYear } from "../../../modules/hr/src/service.ts";
import { setup } from "./harness.ts";

let h: Awaited<ReturnType<typeof setup>>;
let exec: ExecDeps;
let relay: postgres.Sql;
let owner: string, mia: string, max: string, vic: string, bob: string, tA: string, tB: string;
let olgaId: string, miaId: string, maxId: string, vicId: string;
const M = "/m/hr";
const Own = () => h.client(owner, tA);
const Mgr = () => h.client(mia, tA);
const Max = () => h.client(max, tA);
const Vic = () => h.client(vic, tA);
const B = () => h.client(bob, tB);

const seen = new Set<string>();
async function pump(tenantId: string) {
  const runner = new InlineRunner(exec, 1);
  for (let i = 0; i < 20; i++) {
    const evs = (await h.events(tenantId)).filter((e) => !seen.has(e.id));
    if (!evs.length) break;
    for (const e of evs) { seen.add(e.id); await dispatchEvent({ ...exec, runner }, e as EventEnvelope).catch(() => {}); }
  }
}
const pdf = Buffer.from("%PDF-1.4\n% test contract\n").toString("base64");
const year = new Date().getUTCFullYear();
const addDays = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

beforeAll(async () => {
  h = await setup([scheduling, hr]);
  exec = { db: h.db, registry: h.registry, secrets: h.secrets, http: { allowPrivate: true, requireHttps: false } };
  relay = postgres(h.tdb.relayUrl, { onnotice: () => {} });
  [owner, mia, max, vic, bob] = await Promise.all(["olga", "mia", "max", "vic", "bob"].map((n) => h.token(n))) as [string, string, string, string, string];
  tA = (await h.client(owner).post("/tenants", { slug: "bakery", name: "Bakery" })).body.id;
  tB = (await h.client(bob).post("/tenants", { slug: "other", name: "Other" })).body.id;
  for (const [t, role] of [[mia, "manager"], [max, "member"], [vic, "viewer"]] as const) {
    const me = (await h.client(t).get("/me")).body;
    await Own().post("/members", { email: me.email, roles: [role] });
  }
  [olgaId, miaId, maxId, vicId] = await Promise.all([owner, mia, max, vic].map(async (t) => (await h.client(t).get("/me")).body.userId)) as [string, string, string, string];
});
afterAll(async () => { await relay.end(); await h.teardown(); });

describe("hr module", () => {
  it("is off until added; everyone sees the directory", async () => {
    expect((await Max().get(`${M}/people`)).status).toBe(403);
    await Own().post("/modules/hr/enable", {});
    expect((await Max().get(`${M}/config`)).body).toMatchObject({ canManage: false, canPay: false, currency: "EUR", defaultAllowanceDays: 25 });
    expect((await Mgr().get(`${M}/config`)).body).toMatchObject({ canManage: true, canPay: false });
    expect((await Own().get(`${M}/config`)).body).toMatchObject({ canManage: true, canPay: true });
    const dir = (await Vic().get(`${M}/people`)).body;
    expect(dir).toHaveLength(4);
    expect(dir.every((p: { active: boolean }) => p.active)).toBe(true);
  });

  it("HR managers edit profiles; private details stay private", async () => {
    let r = await Mgr().patch(`${M}/people/${maxId}`, {
      jobTitle: "Baker", department: "Kitchen", managerId: miaId, employmentType: "full_time", weeklyHours: 38, startDate: "2023-03-01",
      birthDate: "1995-07-14", personalPhone: "+34 600 000 000", emergencyName: "Lena", emergencyRelation: "Sister", emergencyPhone: "+34 611 111 111", notes: "Night shifts ok",
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ jobTitle: "Baker", managerName: expect.any(String), birthday: "07-14" });
    expect(r.body.private).toMatchObject({ emergencyName: "Lena", notes: "Night shifts ok", effectiveAllowance: 25 });
    await Mgr().patch(`${M}/people/${miaId}`, { jobTitle: "Head baker", department: "Kitchen", managerId: olgaId });

    // A colleague sees the public part only.
    r = await Vic().get(`${M}/people/${maxId}`);
    expect(r.body).toMatchObject({ jobTitle: "Baker", department: "Kitchen", birthday: "07-14", private: null });
    // Max sees his own private details (not HR notes) and may update his contact details only.
    r = await Max().get(`${M}/people/${maxId}`);
    expect(r.body.private).toMatchObject({ emergencyName: "Lena", notes: null });
    expect((await Max().patch(`${M}/people/${maxId}`, { emergencyPhone: "+34 622 222 222" })).body.private.emergencyPhone).toBe("+34 622 222 222");
    expect((await Max().patch(`${M}/people/${maxId}`, { jobTitle: "Boss" })).status).toBe(403);
    expect((await Max().patch(`${M}/people/${vicId}`, { personalPhone: "1" })).status).toBe(403);

    // Validation and no reporting loops.
    expect((await Mgr().patch(`${M}/people/${maxId}`, { managerId: maxId })).body.title).toMatch(/own manager/);
    expect((await Mgr().patch(`${M}/people/${olgaId}`, { managerId: maxId })).body.title).toMatch(/loop/);
    expect((await Mgr().patch(`${M}/people/${maxId}`, { personalEmail: "nope" })).status).toBe(400);
    expect((await Mgr().patch(`${M}/people/${maxId}`, { endDate: "2020-01-01" })).body.title).toMatch(/before the start date/);
    expect((await Mgr().get(`${M}/people/019a0000-0000-7000-8000-000000000000`)).status).toBe(404);

    const org = (await Vic().get(`${M}/people`)).body;
    expect(org.find((p: { userId: string }) => p.userId === maxId).managerId).toBe(miaId);
    expect((await Vic().get(`${M}/people?department=Kitchen`)).body).toHaveLength(2);
    expect((await Vic().get(`${M}/people?q=head`)).body.map((p: { jobTitle: string }) => p.jobTitle)).toEqual(["Head baker"]);
    expect((await Vic().get(`${M}/people/${miaId}`)).body.directReports.map((x: { userId: string }) => x.userId)).toEqual([maxId]);
    expect((await h.events(tA, "hr.employee.updated")).length).toBeGreaterThan(0);
  });

  it("pay is only for owners, admins and the person themself", async () => {
    expect((await Mgr().post(`${M}/people/${maxId}/pay`, { effectiveFrom: "2024-01-01", basis: "hourly", amountCents: 1450 })).status).toBe(403);
    let r = await Own().post(`${M}/people/${maxId}/pay`, { effectiveFrom: "2024-01-01", basis: "hourly", amountCents: 1450, note: "Start rate" });
    expect(r.status).toBe(201);
    await Own().post(`${M}/people/${maxId}/pay`, { effectiveFrom: "2025-01-01", basis: "hourly", amountCents: 1600 });
    await Own().post(`${M}/people/${maxId}/pay`, { effectiveFrom: `${year + 1}-01-01`, basis: "hourly", amountCents: 1700 });
    r = await Own().get(`${M}/people/${maxId}/pay`);
    expect(r.body.current).toMatchObject({ amountCents: 1600, currency: "EUR", basis: "hourly" });
    expect(r.body.history).toHaveLength(3);
    expect((await Own().post(`${M}/people/${maxId}/pay`, { effectiveFrom: "2025-01-01", basis: "hourly", amountCents: 1 })).status).toBe(409);
    expect((await Own().post(`${M}/people/${maxId}/pay`, { effectiveFrom: "2025-02-01", basis: "hourly", amountCents: 0 })).status).toBe(400);

    expect((await Max().get(`${M}/people/${maxId}/pay`)).body.current.amountCents).toBe(1600);
    expect((await Mgr().get(`${M}/people/${maxId}/pay`)).status).toBe(403);
    expect((await Vic().get(`${M}/people/${maxId}/pay`)).status).toBe(403);
    // Events never carry the amount.
    const ev = (await h.events(tA, "hr.pay.changed"))[0]!;
    expect(JSON.stringify(ev.payload)).not.toContain("1450");
    // Admins can grant pay to other roles under Settings → Roles; until then managers can't see it.
    expect((await Mgr().get(`${M}/people/${maxId}`)).body.can).toMatchObject({ seePay: false, editPay: false });
  });

  it("approved time off in Schedule counts against the allowance", async () => {
    await Own().post("/modules/scheduling/enable", {});
    // Tuesday Dec 29 this year … Friday Jan 1 next year would be ideal, but dates depend on the calendar; use 10 days from now.
    const start = addDays(10), end = addDays(16);
    const expected = workingDaysByYear(start, end);
    const t = (await Max().post("/m/scheduling/time-off", { kind: "vacation", startDate: start, endDate: end })).body;
    expect((await Mgr().post(`/m/scheduling/time-off/${t.id}/approve`, {})).status).toBe(200);
    await pump(tA);

    const y = Number(start.slice(0, 4));
    let l = (await Max().get(`${M}/people/${maxId}/leave?year=${y}`)).body;
    expect(l.vacationBooked).toBe(expected.get(y) ?? 0);
    expect(l.remaining).toBe(25 - (expected.get(y) ?? 0));
    expect(l.entries[0]).toMatchObject({ kind: "vacation", source: "schedule", startDate: start });
    await pump(tA); // replays don't double count
    expect((await Max().get(`${M}/people/${maxId}/leave?year=${y}`)).body.vacationBooked).toBe(expected.get(y) ?? 0);

    // HR adds carry-over and a past sick day; the person's own allowance is changed.
    await Mgr().patch(`${M}/people/${maxId}`, { allowanceDays: 22 });
    expect((await Mgr().post(`${M}/people/${maxId}/leave`, { kind: "carry_over", days: 3, year: y, note: "From last year" })).status).toBe(201);
    expect((await Mgr().post(`${M}/people/${maxId}/leave`, { kind: "sick", days: 1, startDate: `${y}-01-05` })).status).toBe(201);
    expect((await Mgr().post(`${M}/people/${maxId}/leave`, { kind: "sick", days: -1 })).status).toBe(400);
    expect((await Mgr().post(`${M}/people/${maxId}/leave`, { kind: "vacation", days: 0.3 })).status).toBe(400);
    expect((await Max().post(`${M}/people/${maxId}/leave`, { kind: "carry_over", days: 30 })).status).toBe(403);
    l = (await Max().get(`${M}/people/${maxId}/leave?year=${y}`)).body;
    expect(l).toMatchObject({ allowance: 22, adjustments: 3, total: 25, sick: 1, remaining: 25 - (expected.get(y) ?? 0) });
    expect((await Max().get(`${M}/people/${vicId}/leave`)).status).toBe(403);

    // Only manual entries can be deleted here.
    const fromSchedule = l.entries.find((e: { source: string }) => e.source === "schedule");
    expect((await Mgr().del(`${M}/leave/${fromSchedule.id}`)).body.title).toMatch(/Cancel it there/);

    const all = (await Mgr().get(`${M}/leave?year=${y}`)).body.data;
    expect(all).toHaveLength(4);
    expect(all.find((x: { userId: string }) => x.userId === vicId)).toMatchObject({ allowance: 25, remaining: 25 });
    expect((await Max().get(`${M}/leave?year=${y}`)).body.data.map((x: { userId: string }) => x.userId)).toEqual([maxId]);

    // Cancelling the time off gives the days back.
    expect((await Max().post(`/m/scheduling/time-off/${t.id}/cancel`, {})).status).toBe(200);
    await pump(tA);
    expect((await Max().get(`${M}/people/${maxId}/leave?year=${y}`)).body).toMatchObject({ vacationBooked: 0, remaining: 25 });
  });

  it("stores documents per person with expiry reminders", async () => {
    let r = await Mgr().post(`${M}/people/${maxId}/documents`, { name: "Contract 2023", category: "contract", contentType: "application/pdf", data: pdf });
    expect(r.status).toBe(201);
    const contract = r.body;
    r = await Mgr().post(`${M}/people/${maxId}/documents`, { name: "Food safety certificate", category: "certificate", contentType: "application/pdf", data: pdf, expiresOn: addDays(10) });
    expect(r.body).toMatchObject({ expiringSoon: true, expired: false });
    expect((await Mgr().post(`${M}/people/${maxId}/documents`, { name: "Fake", category: "id", contentType: "image/png", data: pdf })).body.title).toMatch(/does not match/);
    expect((await Max().post(`${M}/people/${maxId}/documents`, { name: "x", category: "other", contentType: "application/pdf", data: pdf })).status).toBe(403);

    expect((await Max().get(`${M}/people/${maxId}/documents`)).body).toHaveLength(2);
    expect(Buffer.from((await Max().get(`${M}/documents/${contract.id}`)).body.data, "base64").toString()).toContain("%PDF");
    expect((await Vic().get(`${M}/people/${maxId}/documents`)).status).toBe(403);
    expect((await Vic().get(`${M}/documents/${contract.id}`)).status).toBe(404);
    expect((await Mgr().get(`${M}/documents/expiring`)).body.map((d: { name: string; personName: string }) => d.name)).toEqual(["Food safety certificate"]);

    const deps = { db: h.db, registry: h.registry, secrets: h.secrets };
    await relay`update module_job_state set next_run_at = now()`;
    await runDueJobs(relay, deps);
    await relay`update module_job_state set next_run_at = now()`;
    await runDueJobs(relay, deps);
    const reminders = await h.events(tA, "hr.document.expiring");
    expect(reminders).toHaveLength(1); // once only
    expect(reminders[0]!.payload).toMatchObject({ userId: maxId, name: "Food safety certificate", expiresOn: addDays(10) });

    expect((await Mgr().patch(`${M}/documents/${contract.id}`, { expiresOn: addDays(400) })).body.expiringSoon).toBe(false);
    expect((await Mgr().del(`${M}/documents/${contract.id}`)).status).toBe(204);
  });

  it("onboarding checklists assign tasks to the person, their manager and HR", async () => {
    const tpl = (await Mgr().post(`${M}/templates`, {
      name: "New baker", kind: "onboarding",
      items: [{ title: "Sign contract", owner: "employee", dueDays: 0 }, { title: "Kitchen tour", owner: "manager", dueDays: 1 }, { title: "Order uniform", owner: "hr", dueDays: -3 }],
    })).body;
    expect((await Mgr().post(`${M}/templates`, { name: "new baker", kind: "other", items: [{ title: "x", owner: "hr", dueDays: 0 }] })).status).toBe(409);
    expect((await Mgr().post(`${M}/templates`, { name: "Empty", kind: "other", items: [] })).status).toBe(400);
    expect((await Max().post(`${M}/templates`, { name: "Mine", kind: "other", items: [{ title: "x", owner: "hr", dueDays: 0 }] })).status).toBe(403);

    // Vic starts next week; Vic's manager is Mia.
    await Mgr().patch(`${M}/people/${vicId}`, { managerId: miaId, startDate: addDays(7) });
    const c = (await Own().post(`${M}/people/${vicId}/checklists`, { templateId: tpl.id, startDate: addDays(7) })).body;
    expect(c).toMatchObject({ name: "New baker", kind: "onboarding", done: 0, total: 3 });
    expect(c.tasks.map((t: { title: string; ownerId: string; dueDate: string }) => [t.title, t.ownerId, t.dueDate])).toEqual([
      ["Sign contract", vicId, addDays(7)], ["Kitchen tour", miaId, addDays(8)], ["Order uniform", olgaId, addDays(4)],
    ]);

    // Each person sees and ticks off only their own tasks.
    expect((await Vic().get(`${M}/my-tasks`)).body.map((t: { title: string }) => t.title)).toEqual(["Sign contract"]);
    expect((await Max().get(`${M}/checklists/${c.id}`)).status).toBe(404);
    expect((await Vic().patch(`${M}/tasks/${c.tasks[1].id}`, { done: true })).status).toBe(403);
    expect((await Vic().patch(`${M}/tasks/${c.tasks[0].id}`, { done: true })).body.done).toBe(1);
    expect((await Vic().get(`${M}/checklists`)).body).toHaveLength(1);
    expect((await Mgr().patch(`${M}/tasks/${c.tasks[1].id}`, { done: true })).body.done).toBe(2);
    const last = (await Own().patch(`${M}/tasks/${c.tasks[2].id}`, { done: true })).body;
    expect(last.completedAt).not.toBeNull();
    expect(await h.events(tA, "hr.checklist.completed")).toHaveLength(1);
    expect((await Mgr().get(`${M}/checklists?status=active`)).body).toHaveLength(0);
    expect((await Mgr().get(`${M}/checklists?status=done`)).body).toHaveLength(1);
    // Unticking reopens it.
    expect((await Own().patch(`${M}/tasks/${c.tasks[2].id}`, { done: false })).body.completedAt).toBeNull();
  });

  it("the dashboard shows birthdays, anniversaries and who is away", async () => {
    const md = (n: number) => addDays(n).slice(5);
    await Mgr().patch(`${M}/people/${miaId}`, { birthDate: `1990-${md(3)}`, startDate: `${year - 2}-${md(5)}` });
    await Mgr().post(`${M}/people/${olgaId}/leave`, { kind: "sick", days: 1, startDate: addDays(0), endDate: addDays(0) });
    const s = (await Vic().get(`${M}/summary`)).body;
    expect(s.celebrations).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: miaId, kind: "birthday", date: addDays(3) }),
      expect.objectContaining({ userId: miaId, kind: "anniversary", years: 2 }),
    ]));
    expect(s.awayToday.map((a: { userId: string }) => a.userId)).toEqual([olgaId]);
    expect(s.expiringDocuments).toBeNull(); // not for viewers
    expect((await Mgr().get(`${M}/summary`)).body.expiringDocuments).toBe(1);
  });

  it("keeps companies apart and keeps data when switched off and on", async () => {
    await B().post("/modules/hr/enable", {});
    expect((await B().get(`${M}/people`)).body).toHaveLength(1);
    expect((await B().get(`${M}/people/${maxId}`)).status).toBe(404);
    expect((await B().get(`${M}/checklists`)).body).toHaveLength(0);
    await Own().post("/modules/hr/disable", {});
    expect((await Max().get(`${M}/people`)).status).toBe(403);
    await Own().post("/modules/hr/enable", {});
    expect((await Vic().get(`${M}/people/${maxId}`)).body.jobTitle).toBe("Baker");
  });
});
