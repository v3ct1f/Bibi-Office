import { afterAll, beforeAll, describe, expect, it } from "vitest";
import scheduling from "@office/module-scheduling";
import { addDays, nowIn, weekStart } from "../../../modules/scheduling/src/time.ts";
import { setup } from "./harness.ts";

let h: Awaited<ReturnType<typeof setup>>;
let owner: string, mia: string, max: string, lee: string, bob: string, tA: string, tB: string;
let maxId: string, leeId: string;
const M = "/m/scheduling";
const Mgr = () => h.client(mia, tA);
const Max = () => h.client(max, tA);
const Lee = () => h.client(lee, tA);
const B = () => h.client(bob, tB);

const today = nowIn("Europe/Madrid").date;
const next = addDays(weekStart(today), 7);   // Monday next week
const after = addDays(next, 7);              // Monday the week after

beforeAll(async () => {
  h = await setup([scheduling]);
  [owner, mia, max, lee, bob] = await Promise.all(["olga", "mia", "max", "lee", "bob"].map((n) => h.token(n))) as [string, string, string, string, string];
  tA = (await h.client(owner).post("/tenants", { slug: "bar", name: "Bar" })).body.id;
  tB = (await h.client(bob).post("/tenants", { slug: "shop", name: "Shop" })).body.id;
  for (const [t, role] of [[mia, "manager"], [max, "member"], [lee, "member"]] as const) {
    await h.join(tA, owner, t, [role]);
  }
});
afterAll(async () => { await h.teardown(); });

describe("scheduling module", () => {
  let bar: string, kitchen: string, maxMon: string, leeTue: string;

  it("is off until added, then knows who may do what", async () => {
    expect((await Max().get(`${M}/week`)).status).toBe(403);
    await h.client(owner, tA).post("/modules/scheduling/enable", {});
    const cfg = (await Max().get(`${M}/config`)).body;
    expect(cfg).toMatchObject({ timezone: "Europe/Madrid", canSelf: true, canManage: false });
    maxId = cfg.me;
    leeId = (await Lee().get(`${M}/config`)).body.me;
    expect((await Mgr().get(`${M}/config`)).body.canManage).toBe(true);
    expect((await Max().post(`${M}/shifts`, { employeeId: maxId, day: next, start: "09:00", end: "10:00" })).status).toBe(403);
    expect((await Max().get(`${M}/timesheet`)).status).toBe(403);
  });

  it("positions: unique names", async () => {
    bar = (await Mgr().post(`${M}/positions`, { name: "Bar", color: "orange" })).body.id;
    kitchen = (await Mgr().post(`${M}/positions`, { name: "Kitchen", color: "green" })).body.id;
    const dupe = await Mgr().post(`${M}/positions`, { name: "bar" });
    expect(dupe.status).toBe(409);
    expect(dupe.body.title).toContain("already a position");
  });

  it("builds a week of draft shifts with clear clash messages", async () => {
    let r = await Mgr().post(`${M}/shifts`, { employeeId: maxId, positionId: bar, day: next, start: "09:00", end: "17:30", breakMinutes: 30 });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ published: false, minutes: 480 });
    maxMon = r.body.id;
    r = await Mgr().post(`${M}/shifts`, { employeeId: maxId, day: next, start: "17:00", end: "20:00" });
    expect(r.status).toBe(409);
    expect(r.body.title).toMatch(/already works 09:00–17:30/);
    // Overnight shift on Sunday clashes with an early Monday one.
    expect((await Mgr().post(`${M}/shifts`, { employeeId: leeId, day: addDays(next, 6), start: "20:00", end: "02:00" })).status).toBe(201);
    expect((await Mgr().post(`${M}/shifts`, { employeeId: leeId, day: addDays(next, 7), start: "01:00", end: "06:00" })).status).toBe(409);
    leeTue = (await Mgr().post(`${M}/shifts`, { employeeId: leeId, positionId: kitchen, day: addDays(next, 1), start: "12:00", end: "20:00" })).body.id;
    expect((await Mgr().post(`${M}/shifts`, { employeeId: maxId, day: next, start: "25:00", end: "26:00" })).status).toBe(400);
    expect((await Mgr().post(`${M}/shifts`, { employeeId: maxId, day: next, start: "09:00", end: "09:00" })).status).toBe(400);
    expect((await Mgr().post(`${M}/shifts`, { employeeId: maxId, day: addDays(next, 2), start: "09:00", end: "10:00", breakMinutes: 60 })).status).toBe(400);
    const stranger = await Mgr().post(`${M}/shifts`, { employeeId: "019a0000-0000-7000-8000-000000000000", day: next, start: "09:00", end: "10:00" });
    expect(stranger.status).toBe(400);
    expect(stranger.body.title).toContain("not a member");

    // Staff don't see drafts.
    expect((await Max().get(`${M}/week?start=${next}`)).body.shifts).toEqual([]);
    const w = (await Mgr().get(`${M}/week?start=${addDays(next, 3)}`)).body;
    expect(w.start).toBe(next);
    expect(w.drafts).toBe(3);
    expect(w.people.map((p: { userId: string }) => p.userId)).toEqual(expect.arrayContaining([maxId, leeId]));
  });

  it("publishing shows the week to everyone; copying makes drafts for the next week", async () => {
    const pub = await Mgr().post(`${M}/week/publish`, { start: next });
    expect(pub.body, JSON.stringify(pub.body)).toMatchObject({ published: 3 });
    const w = (await Max().get(`${M}/week?start=${next}`)).body;
    expect(w.shifts).toHaveLength(3);
    expect(w.shifts.find((s: { id: string }) => s.id === maxMon)).toMatchObject({ mine: true, start: "09:00", end: "17:30" });
    expect((await Max().get(`${M}/my-shifts?from=${next}&to=${addDays(next, 6)}`)).body.map((s: { id: string }) => s.id)).toEqual([maxMon]);
    expect((await h.events(tA, "scheduling.shifts.published")).length).toBe(1);

    const c = (await Mgr().post(`${M}/week/copy`, { from: next, to: after })).body;
    expect(c).toEqual({ copied: 3, skipped: [] });
    expect((await Mgr().post(`${M}/week/copy`, { from: next, to: after })).body.skipped).toHaveLength(3); // already there
  });

  it("time off: request, no double requests, approve shows clashing shifts and blocks new ones", async () => {
    const wed = addDays(after, 2);
    let r = await Max().post(`${M}/time-off`, { kind: "vacation", startDate: after, endDate: wed, reason: "Family wedding" });
    expect(r.status).toBe(201);
    const id = r.body.id;
    expect((await Max().post(`${M}/time-off`, { startDate: wed, endDate: wed })).status).toBe(409);
    expect((await Max().post(`${M}/time-off`, { startDate: wed, endDate: after })).status).toBe(400);
    expect((await Max().post(`${M}/time-off/${id}/approve`, {})).status).toBe(403);
    expect((await Lee().get(`${M}/time-off`)).body).toEqual([]); // only own

    const pending = (await Mgr().get(`${M}/time-off?status=pending`)).body;
    expect(pending[0].conflicts.map((c: { day: string }) => c.day)).toEqual([after]); // the copied Monday shift
    expect((await Mgr().post(`${M}/time-off/${id}/reject`, {})).status).toBe(400);
    r = await Mgr().post(`${M}/time-off/${id}/approve`, { comment: "Enjoy" });
    expect(r.body.status).toBe("approved");
    expect(r.body.conflicts).toHaveLength(1);
    const blocked = await Mgr().post(`${M}/shifts`, { employeeId: maxId, day: addDays(after, 1), start: "09:00", end: "12:00" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.title).toMatch(/approved time off/);
    expect((await Max().post(`${M}/time-off/${id}/cancel`, {})).body.status).toBe("cancelled");
  });

  it("swaps: colleague accepts, manager approves, the shift moves", async () => {
    expect((await Max().post(`${M}/swaps`, { shiftId: leeTue, toEmployeeId: leeId })).status).toBe(404); // not his shift
    let r = await Max().post(`${M}/swaps`, { shiftId: maxMon, toEmployeeId: leeId, message: "Doctor's appointment" });
    expect(r.status).toBe(201);
    const id = r.body.id;
    expect((await Max().post(`${M}/swaps`, { shiftId: maxMon, toEmployeeId: leeId })).status).toBe(409);
    expect((await Mgr().post(`${M}/swaps/${id}/approve`, {})).status).toBe(409); // colleague first
    expect((await Max().post(`${M}/swaps/${id}/accept`, {})).status).toBe(403);
    expect((await Lee().post(`${M}/swaps/${id}/accept`, {})).body.status).toBe("accepted");
    expect((await Mgr().get(`${M}/swaps`)).body.map((s: { id: string }) => s.id)).toContain(id);
    r = await Mgr().post(`${M}/swaps/${id}/approve`, {});
    expect(r.body.status).toBe("approved");
    const w = (await Lee().get(`${M}/week?start=${next}`)).body;
    expect(w.shifts.find((s: { id: string }) => s.id === maxMon)).toMatchObject({ employeeId: leeId, mine: true });

    // Declined requests change nothing.
    const back = (await Lee().post(`${M}/swaps`, { shiftId: maxMon, toEmployeeId: maxId })).body.id;
    expect((await Max().post(`${M}/swaps/${back}/decline`, {})).body.status).toBe("declined");
  });

  it("time clock: in, no double clock-in, out", async () => {
    let r = await Max().post(`${M}/clock/in`, {});
    expect(r.status).toBe(200);
    expect(r.body.open).toBeTruthy();
    r = await Max().post(`${M}/clock/in`, {});
    expect(r.status).toBe(409);
    expect(r.body.title).toMatch(/already clocked in/);
    r = await Max().post(`${M}/clock/out`, { note: "Closed the bar" });
    expect(r.body.open).toBeNull();
    expect(r.body.week.entries).toHaveLength(1);
    expect((await Max().post(`${M}/clock/out`, {})).status).toBe(409);
  });

  it("managers fix hours, see the week's totals and export them", async () => {
    const yesterday = addDays(today, -1);
    let r = await Mgr().post(`${M}/entries`, { employeeId: leeId, date: yesterday, in: "09:00", out: "17:30", note: "Forgot to clock" });
    expect(r.status).toBe(201);
    const entry = r.body.id;
    expect((await Mgr().post(`${M}/entries`, { employeeId: leeId, date: yesterday, in: "17:00", out: "18:00" })).status).toBe(409);
    expect((await Mgr().post(`${M}/entries`, { employeeId: leeId, date: addDays(today, 3), in: "09:00", out: "10:00" })).status).toBe(400);
    // Overnight manual entry is fine.
    expect((await Mgr().post(`${M}/entries`, { employeeId: leeId, date: addDays(today, -3), in: "22:00", out: "02:00" })).status).toBe(201);

    const ts = (await Mgr().get(`${M}/timesheet?from=${addDays(today, -6)}&to=${today}`)).body;
    const leeRow = ts.rows.find((x: { employeeId: string }) => x.employeeId === leeId);
    expect(leeRow.workedMinutes).toBe(510 + 240);
    expect(leeRow.entries.find((e: { id: string }) => e.id === entry)).toMatchObject({ in: "09:00", out: "17:30", source: "manual" });
    expect(leeRow.entries.some((e: { overnight: boolean }) => e.overnight)).toBe(true);
    expect(ts.rows.find((x: { employeeId: string }) => x.employeeId === maxId).entries).toHaveLength(1);

    expect((await Mgr().patch(`${M}/entries/${entry}`, { out: "16:00" })).status).toBe(200);
    const csv = (await Mgr().get(`${M}/timesheet/export?from=${addDays(today, -6)}&to=${today}`)).body;
    expect(csv.filename).toMatch(/^hours-/);
    const rows = csv.csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(rows[0]).toBe("Employee,Date,Clock in,Clock out,Hours,Decimal hours,Note,Edited by manager");
    expect(rows.some((l: string) => l.includes(`,${yesterday},09:00,16:00,7h 00m,7.00,Forgot to clock,yes`))).toBe(true);
    expect(rows.some((l: string) => l.includes("02:00 (+1 day)"))).toBe(true);
    expect(rows.some((l: string) => /total,.*11h 00m,11\.00/.test(l))).toBe(true);
    expect((await Mgr().get(`${M}/timesheet?from=${today}&to=${addDays(today, -1)}`)).status).toBe(400);
  });

  it("dashboard summary", async () => {
    const s = (await Mgr().get(`${M}/summary`)).body;
    expect(s).toMatchObject({ pendingTimeOff: 0, pendingSwaps: 0 });
    expect((await Lee().get(`${M}/summary`)).body.nextShift).toBeTruthy();
  });

  it("another company never sees this schedule", async () => {
    expect((await B().get(`${M}/week`)).status).toBe(403);
    await B().post("/modules/scheduling/enable", {});
    const w = (await B().get(`${M}/week?start=${next}`)).body;
    expect(w.shifts).toEqual([]);
    expect(w.positions).toEqual([]);
    expect((await B().patch(`${M}/shifts/${maxMon}`, { start: "10:00" })).status).toBe(404);
    expect((await B().post(`${M}/shifts`, { employeeId: maxId, day: next, start: "09:00", end: "10:00" })).status).toBe(400); // not their member
    expect((await B().get(`${M}/timesheet`)).body.rows.every((r: { entries: unknown[] }) => r.entries.length === 0)).toBe(true);
  });
});
