import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "@office/db";
import { moduleErrors as E, type ModuleContext, type Person } from "@office/sdk";
import { clockEntries, COLORS, positions, shifts, swaps, timeOff, type TimeOffKind } from "./schema.ts";
import {
  addDays, fmtHours, hhmm, isDate, isTime, nowIn, overlaps, paidMinutes, shiftInterval, validTimeZone, weekDays, weekStart,
} from "./time.ts";

export const P = {
  READ: "scheduling:schedule.read",   // see the published schedule
  SELF: "scheduling:self.use",        // clock in/out, request time off and swaps
  MANAGE: "scheduling:schedule.manage", // build schedules, approve requests, edit time entries, export
} as const;

const NONE = "00000000-0000-0000-0000-000000000000";
export const tzOf = (ctx: ModuleContext) => validTimeZone(ctx.settings.get<{ timezone?: string }>().timezone ?? "Europe/Madrid");
const me = (ctx: ModuleContext) => ctx.actor.userId ?? null;
const requireMe = (ctx: ModuleContext) => {
  const id = me(ctx);
  if (!id) throw E.badRequest("This needs a signed-in person");
  return id;
};
const canManage = (ctx: ModuleContext) => ctx.authz.can(P.MANAGE);

// ───────── Validation ─────────
const day = z.string().refine(isDate, "Use a real date in the format YYYY-MM-DD");
const time = z.string().refine(isTime, "Use a time like 09:00");
const text = (max: number) => z.string().trim().max(max);

export const PositionInput = z.object({ name: text(60).min(1, "Give the position a name"), color: z.enum(COLORS).default("blue") }).strict();
export const PositionPatch = PositionInput.partial().strict();
export const ShiftInput = z.object({
  employeeId: z.uuid("Choose who works this shift"),
  positionId: z.uuid().nullish(),
  day,
  start: time,
  end: time,
  breakMinutes: z.number().int().min(0, "Break can't be negative").max(600).default(0),
  notes: text(500).nullish(),
}).strict().refine((s) => s.start !== s.end, { message: "Start and end can't be the same time", path: ["end"] });
export const ShiftPatch = z.object({
  employeeId: z.uuid().optional(), positionId: z.uuid().nullish(), day: day.optional(), start: time.optional(), end: time.optional(),
  breakMinutes: z.number().int().min(0).max(600).optional(), notes: text(500).nullish(),
}).strict();
export const WeekQuery = z.object({ start: day.optional() });
export const WeekBody = z.object({ start: day }).strict();
export const CopyBody = z.object({ from: day, to: day }).strict();
export const RangeQuery = z.object({ from: day.optional(), to: day.optional(), start: day.optional(), employeeId: z.uuid().optional() });
export const TimeOffInput = z.object({
  kind: z.enum(["vacation", "sick", "personal", "other"]).default("vacation"),
  startDate: day, endDate: day, reason: text(500).nullish(),
}).strict().refine((t) => t.endDate >= t.startDate, { message: "The last day can't be before the first day", path: ["endDate"] });
export const TimeOffQuery = z.object({ status: z.enum(["pending", "approved", "rejected", "cancelled"]).optional(), mine: z.enum(["true", "false"]).optional() });
export const DecisionInput = z.object({ comment: text(500).optional() }).strict();
export const RejectInput = z.object({ comment: text(500).min(1, "Say why, so they know what to change") }).strict();
export const SwapInput = z.object({
  shiftId: z.uuid(), toEmployeeId: z.uuid("Choose a colleague"), targetShiftId: z.uuid().nullish(), message: text(500).nullish(),
}).strict();
export const ClockInput = z.object({ note: text(300).optional() }).strict();
export const EntryInput = z.object({
  employeeId: z.uuid(), date: day, in: time, out: time, note: text(300).nullish(),
}).strict();
export const EntryPatch = z.object({ date: day.optional(), in: time.optional(), out: time.optional(), note: text(300).nullish() }).strict();

// ───────── People ─────────
async function peopleMap(ctx: ModuleContext) {
  const people = await ctx.people.list();
  return { people, name: (id: string | null) => (id ? people.find((p) => p.userId === id)?.name ?? "Former member" : null) };
}
async function requirePerson(ctx: ModuleContext, userId: string): Promise<Person> {
  const p = await ctx.people.get(userId);
  if (!p) throw E.badRequest("That person is not a member of this workspace");
  return p;
}

// ───────── Positions ─────────
export async function listPositions(ctx: ModuleContext) {
  return ctx.db.select({ id: positions.id, name: positions.name, color: positions.color }).from(positions)
    .where(eq(positions.archived, false)).orderBy(asc(positions.name));
}
export async function createPosition(ctx: ModuleContext, input: z.infer<typeof PositionInput>) {
  const [dupe] = await ctx.db.select({ id: positions.id }).from(positions)
    .where(and(eq(positions.archived, false), sql`lower(${positions.name}) = lower(${input.name})`));
  if (dupe) throw E.conflict(`There is already a position called “${input.name}”`);
  const [p] = await ctx.db.insert(positions).values({ id: uuidv7(), tenantId: ctx.tenantId, name: input.name, color: input.color, archived: false }).returning();
  return { id: p!.id, name: p!.name, color: p!.color };
}
export async function updatePosition(ctx: ModuleContext, id: string, patch: z.infer<typeof PositionPatch>) {
  if (patch.name) {
    const [dupe] = await ctx.db.select({ id: positions.id }).from(positions)
      .where(and(eq(positions.archived, false), ne(positions.id, id), sql`lower(${positions.name}) = lower(${patch.name})`));
    if (dupe) throw E.conflict(`There is already a position called “${patch.name}”`);
  }
  const [p] = await ctx.db.update(positions).set(patch).where(and(eq(positions.id, id), eq(positions.archived, false))).returning();
  if (!p) throw E.notFound("Position");
  return { id: p.id, name: p.name, color: p.color };
}
/** Positions used by shifts are archived (old shifts keep their label); unused ones are deleted. */
export async function deletePosition(ctx: ModuleContext, id: string) {
  const [used] = await ctx.db.select({ id: shifts.id }).from(shifts).where(eq(shifts.positionId, id)).limit(1);
  const r = used
    ? await ctx.db.update(positions).set({ archived: true }).where(eq(positions.id, id)).returning()
    : await ctx.db.delete(positions).where(eq(positions.id, id)).returning();
  if (!r.length) throw E.notFound("Position");
}

// ───────── Shifts ─────────
type ShiftRow = typeof shifts.$inferSelect;
const shiftDto = (s: ShiftRow, uid: string | null) => ({
  id: s.id, employeeId: s.employeeId, positionId: s.positionId, day: s.day, start: hhmm(s.startTime), end: hhmm(s.endTime),
  breakMinutes: s.breakMinutes, notes: s.notes, published: !!s.publishedAt, mine: s.employeeId === uid,
  minutes: paidMinutes(s.startTime, s.endTime, s.breakMinutes),
});

/** Throws a clear 409 when the person already works then or is off that day. */
async function checkShift(ctx: ModuleContext, s: { employeeId: string; day: string; start: string; end: string; breakMinutes: number }, ignore: string[] = []) {
  const span = paidMinutes(s.start, s.end, 0);
  if (s.breakMinutes >= span) throw E.badRequest("The break is as long as the shift");
  const person = await requirePerson(ctx, s.employeeId);
  const near = await ctx.db.select().from(shifts).where(and(
    eq(shifts.employeeId, s.employeeId), gte(shifts.day, addDays(s.day, -1)), lte(shifts.day, addDays(s.day, 1)),
    ...(ignore.length ? [sql`${shifts.id} NOT IN (${sql.join(ignore.map((i) => sql`${i}`), sql`, `)})`] : []),
  ));
  const mine = shiftInterval(s);
  const clash = near.find((o) => overlaps(mine, shiftInterval({ day: o.day, start: o.startTime, end: o.endTime })));
  if (clash) throw E.conflict(`${person.name} already works ${hhmm(clash.startTime)}–${hhmm(clash.endTime)} on ${clash.day}`);
  const [off] = await ctx.db.select().from(timeOff).where(and(
    eq(timeOff.employeeId, s.employeeId), eq(timeOff.status, "approved"), lte(timeOff.startDate, s.day), gte(timeOff.endDate, s.day),
  ));
  if (off) throw E.conflict(`${person.name} has approved time off (${off.kind}) on ${s.day}`);
}
async function checkPosition(ctx: ModuleContext, id: string | null | undefined) {
  if (!id) return;
  const [p] = await ctx.db.select({ id: positions.id }).from(positions).where(and(eq(positions.id, id), eq(positions.archived, false)));
  if (!p) throw E.badRequest("That position does not exist");
}

export async function week(ctx: ModuleContext, startIn?: string) {
  const tz = tzOf(ctx);
  const start = weekStart(startIn ?? nowIn(tz).date);
  const end = addDays(start, 6);
  const manage = canManage(ctx);
  const uid = me(ctx);
  const rows = await ctx.db.select().from(shifts)
    .where(and(gte(shifts.day, start), lte(shifts.day, end), manage ? undefined : isNotNull(shifts.publishedAt)))
    .orderBy(asc(shifts.day), asc(shifts.startTime));
  const offs = await ctx.db.select().from(timeOff).where(and(
    lte(timeOff.startDate, end), gte(timeOff.endDate, start),
    manage ? inArray(timeOff.status, ["approved", "pending"]) : eq(timeOff.status, "approved"),
  ));
  const { people } = await peopleMap(ctx);
  const pendingSwaps = await ctx.db.select({ shiftId: swaps.shiftId, status: swaps.status }).from(swaps)
    .where(inArray(swaps.status, ["pending", "accepted"]));
  return {
    start, end, days: weekDays(start), today: nowIn(tz).date, timezone: tz,
    people: people.map((p) => ({ userId: p.userId, name: p.name })),
    positions: await listPositions(ctx),
    shifts: rows.map((s) => ({ ...shiftDto(s, uid), swapPending: pendingSwaps.some((w) => w.shiftId === s.id) })),
    timeOff: offs.map((t) => ({ id: t.id, employeeId: t.employeeId, kind: t.kind, startDate: t.startDate, endDate: t.endDate, status: t.status })),
    drafts: rows.filter((s) => !s.publishedAt).length,
  };
}

export async function createShift(ctx: ModuleContext, input: z.infer<typeof ShiftInput>) {
  await checkPosition(ctx, input.positionId);
  await checkShift(ctx, input);
  const [s] = await ctx.db.insert(shifts).values({
    id: uuidv7(), tenantId: ctx.tenantId, employeeId: input.employeeId, positionId: input.positionId ?? null, day: input.day,
    startTime: input.start, endTime: input.end, breakMinutes: input.breakMinutes, notes: input.notes || null,
  }).returning();
  await ctx.audit.log("shift.created", { type: "shift", id: s!.id }, { employeeId: s!.employeeId, day: s!.day });
  return shiftDto(s!, me(ctx));
}

export async function updateShift(ctx: ModuleContext, id: string, patch: z.infer<typeof ShiftPatch>) {
  const [cur] = await ctx.db.select().from(shifts).where(eq(shifts.id, id));
  if (!cur) throw E.notFound("Shift");
  const next = {
    employeeId: patch.employeeId ?? cur.employeeId, day: patch.day ?? cur.day, start: patch.start ?? hhmm(cur.startTime),
    end: patch.end ?? hhmm(cur.endTime), breakMinutes: patch.breakMinutes ?? cur.breakMinutes,
  };
  if (next.start === next.end) throw E.badRequest("Start and end can't be the same time");
  if (patch.positionId !== undefined) await checkPosition(ctx, patch.positionId);
  await checkShift(ctx, next, [id]);
  const [s] = await ctx.db.update(shifts).set({
    employeeId: next.employeeId, day: next.day, startTime: next.start, endTime: next.end, breakMinutes: next.breakMinutes,
    ...(patch.positionId !== undefined ? { positionId: patch.positionId ?? null } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes || null } : {}), updatedAt: new Date(),
  }).where(eq(shifts.id, id)).returning();
  // A reassigned shift cancels open swap requests for it.
  if (next.employeeId !== cur.employeeId) {
    await ctx.db.update(swaps).set({ status: "cancelled" }).where(and(eq(swaps.shiftId, id), inArray(swaps.status, ["pending", "accepted"])));
  }
  await ctx.audit.log("shift.updated", { type: "shift", id }, { changes: Object.keys(patch) });
  return shiftDto(s!, me(ctx));
}

export async function deleteShift(ctx: ModuleContext, id: string) {
  const r = await ctx.db.delete(shifts).where(eq(shifts.id, id)).returning();
  if (!r.length) throw E.notFound("Shift");
  await ctx.audit.log("shift.deleted", { type: "shift", id }, { employeeId: r[0]!.employeeId, day: r[0]!.day });
}

export async function publishWeek(ctx: ModuleContext, start: string) {
  const s = weekStart(start);
  const rows = await ctx.db.update(shifts).set({ publishedAt: new Date() })
    .where(and(gte(shifts.day, s), lte(shifts.day, addDays(s, 6)), isNull(shifts.publishedAt))).returning();
  if (rows.length) {
    await ctx.events.emit("scheduling.shifts.published", { weekStart: s, count: rows.length, employeeIds: [...new Set(rows.map((r) => r.employeeId))] });
    await ctx.audit.log("shifts.published", undefined, { weekStart: s, count: rows.length });
  }
  return { published: rows.length };
}

/** Copies a week's shifts as drafts, skipping any that would clash or fall on approved time off. */
export async function copyWeek(ctx: ModuleContext, fromIn: string, toIn: string) {
  const from = weekStart(fromIn), to = weekStart(toIn);
  if (from === to) throw E.badRequest("Choose a different week to copy into");
  const src = await ctx.db.select().from(shifts).where(and(gte(shifts.day, from), lte(shifts.day, addDays(from, 6))));
  const offset = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  let copied = 0;
  const skipped: string[] = [];
  const people = new Set((await ctx.people.list()).map((p) => p.userId));
  for (const s of src) {
    const next = { employeeId: s.employeeId, day: addDays(s.day, offset), start: hhmm(s.startTime), end: hhmm(s.endTime), breakMinutes: s.breakMinutes };
    if (!people.has(s.employeeId)) { skipped.push(`${next.day}: no longer a member`); continue; }
    try { await checkShift(ctx, next); }
    catch (e) { skipped.push(e instanceof Error ? e.message : String(e)); continue; }
    await ctx.db.insert(shifts).values({
      id: uuidv7(), tenantId: ctx.tenantId, employeeId: s.employeeId, positionId: s.positionId, day: next.day,
      startTime: next.start, endTime: next.end, breakMinutes: s.breakMinutes, notes: s.notes,
    });
    copied++;
  }
  return { copied, skipped };
}

export async function myShifts(ctx: ModuleContext, q: z.infer<typeof RangeQuery>) {
  const uid = requireMe(ctx);
  const today = nowIn(tzOf(ctx)).date;
  const from = q.from ?? today, to = q.to ?? addDays(from, 13);
  const rows = await ctx.db.select().from(shifts).where(and(
    eq(shifts.employeeId, uid), isNotNull(shifts.publishedAt), gte(shifts.day, from), lte(shifts.day, to),
  )).orderBy(asc(shifts.day), asc(shifts.startTime));
  const pos = await listPositions(ctx);
  return rows.map((s) => ({ ...shiftDto(s, uid), positionName: pos.find((p) => p.id === s.positionId)?.name ?? null }));
}

// ───────── Time off ─────────
type TimeOffRow = typeof timeOff.$inferSelect;
export async function listTimeOff(ctx: ModuleContext, q: z.infer<typeof TimeOffQuery>) {
  const own = !canManage(ctx) || q.mine === "true";
  const rows = await ctx.db.select().from(timeOff).where(and(
    own ? eq(timeOff.employeeId, me(ctx) ?? NONE) : undefined, q.status ? eq(timeOff.status, q.status) : undefined,
  )).orderBy(desc(timeOff.startDate)).limit(200);
  const { name } = await peopleMap(ctx);
  const out = [];
  for (const t of rows) out.push({ ...timeOffDto(t, name), conflicts: t.status === "pending" ? await shiftsDuring(ctx, t) : [] });
  return out;
}
const timeOffDto = (t: TimeOffRow, name: (id: string | null) => string | null) => ({
  id: t.id, employeeId: t.employeeId, employeeName: name(t.employeeId), kind: t.kind, startDate: t.startDate, endDate: t.endDate,
  reason: t.reason, status: t.status, decidedByName: name(t.decidedBy), decidedAt: t.decidedAt, decisionComment: t.decisionComment, createdAt: t.createdAt,
});
async function shiftsDuring(ctx: ModuleContext, t: { employeeId: string; startDate: string; endDate: string }) {
  const rows = await ctx.db.select().from(shifts).where(and(eq(shifts.employeeId, t.employeeId), gte(shifts.day, t.startDate), lte(shifts.day, t.endDate)));
  return rows.map((s) => ({ id: s.id, day: s.day, start: hhmm(s.startTime), end: hhmm(s.endTime) }));
}

export async function requestTimeOff(ctx: ModuleContext, input: z.infer<typeof TimeOffInput>) {
  const uid = requireMe(ctx);
  if (Date.parse(input.endDate) - Date.parse(input.startDate) > 365 * 86_400_000) throw E.badRequest("Time off can be at most a year at once");
  const [clash] = await ctx.db.select().from(timeOff).where(and(
    eq(timeOff.employeeId, uid), inArray(timeOff.status, ["pending", "approved"]), lte(timeOff.startDate, input.endDate), gte(timeOff.endDate, input.startDate),
  ));
  if (clash) throw E.conflict(`You already asked for ${clash.startDate} to ${clash.endDate} (${clash.status})`);
  const [t] = await ctx.db.insert(timeOff).values({
    id: uuidv7(), tenantId: ctx.tenantId, employeeId: uid, kind: input.kind as TimeOffKind, startDate: input.startDate, endDate: input.endDate,
    reason: input.reason || null, status: "pending",
  }).returning();
  await ctx.events.emit("scheduling.time_off.requested", { id: t!.id, employeeId: uid, kind: t!.kind, startDate: t!.startDate, endDate: t!.endDate });
  const { name } = await peopleMap(ctx);
  return timeOffDto(t!, name);
}

async function decideTimeOff(ctx: ModuleContext, id: string, to: "approved" | "rejected", comment?: string) {
  const [t] = await ctx.db.update(timeOff).set({ status: to, decidedBy: me(ctx), decidedAt: new Date(), decisionComment: comment || null })
    .where(and(eq(timeOff.id, id), eq(timeOff.status, "pending"))).returning();
  if (!t) {
    const [cur] = await ctx.db.select({ status: timeOff.status }).from(timeOff).where(eq(timeOff.id, id));
    throw cur ? E.conflict(`This request is already ${cur.status}`) : E.notFound("Time-off request");
  }
  await ctx.events.emit(`scheduling.time_off.${to}`, { id, employeeId: t.employeeId, kind: t.kind, startDate: t.startDate, endDate: t.endDate, comment: comment ?? null });
  await ctx.audit.log(`time_off.${to}`, { type: "time_off", id }, comment ? { comment } : undefined);
  const { name } = await peopleMap(ctx);
  return { ...timeOffDto(t, name), conflicts: to === "approved" ? await shiftsDuring(ctx, t) : [] };
}
export const approveTimeOff = (ctx: ModuleContext, id: string, comment?: string) => decideTimeOff(ctx, id, "approved", comment);
export const rejectTimeOff = (ctx: ModuleContext, id: string, comment: string) => decideTimeOff(ctx, id, "rejected", comment);

export async function cancelTimeOff(ctx: ModuleContext, id: string) {
  const uid = requireMe(ctx);
  const today = nowIn(tzOf(ctx)).date;
  const [t] = await ctx.db.select().from(timeOff).where(and(eq(timeOff.id, id), eq(timeOff.employeeId, uid)));
  if (!t) throw E.notFound("Time-off request");
  if (t.status !== "pending" && !(t.status === "approved" && t.startDate > today)) throw E.conflict("Only pending or upcoming time off can be cancelled");
  await ctx.db.update(timeOff).set({ status: "cancelled" }).where(eq(timeOff.id, id));
  const { name } = await peopleMap(ctx);
  return timeOffDto({ ...t, status: "cancelled" }, name);
}

// ───────── Swaps ─────────
type SwapRow = typeof swaps.$inferSelect;
async function swapDto(ctx: ModuleContext, rows: SwapRow[]) {
  const { name } = await peopleMap(ctx);
  const ids = [...new Set(rows.flatMap((r) => [r.shiftId, r.targetShiftId]).filter((x): x is string => !!x))];
  const ss = ids.length ? await ctx.db.select().from(shifts).where(inArray(shifts.id, ids)) : [];
  const brief = (id: string | null) => { const s = ss.find((x) => x.id === id); return s ? { id: s.id, day: s.day, start: hhmm(s.startTime), end: hhmm(s.endTime) } : null; };
  const uid = me(ctx);
  return rows.map((r) => ({
    id: r.id, status: r.status, message: r.message, decisionComment: r.decisionComment, createdAt: r.createdAt,
    from: { userId: r.fromEmployeeId, name: name(r.fromEmployeeId) }, to: { userId: r.toEmployeeId, name: name(r.toEmployeeId) },
    shift: brief(r.shiftId), targetShift: brief(r.targetShiftId), decidedByName: name(r.decidedBy),
    can: {
      respond: r.status === "pending" && r.toEmployeeId === uid,
      cancel: (r.status === "pending" || r.status === "accepted") && r.fromEmployeeId === uid,
      decide: r.status === "accepted" && canManage(ctx),
    },
  }));
}

export async function listSwaps(ctx: ModuleContext) {
  const uid = me(ctx) ?? NONE;
  const rows = await ctx.db.select().from(swaps).where(or(
    eq(swaps.fromEmployeeId, uid), eq(swaps.toEmployeeId, uid), canManage(ctx) ? eq(swaps.status, "accepted") : undefined,
  )).orderBy(desc(swaps.createdAt)).limit(200);
  return swapDto(ctx, rows);
}

export async function requestSwap(ctx: ModuleContext, input: z.infer<typeof SwapInput>) {
  const uid = requireMe(ctx);
  const today = nowIn(tzOf(ctx)).date;
  const [s] = await ctx.db.select().from(shifts).where(eq(shifts.id, input.shiftId));
  if (!s || s.employeeId !== uid || !s.publishedAt) throw E.notFound("Shift");
  if (s.day < today) throw E.conflict("This shift is in the past");
  if (input.toEmployeeId === uid) throw E.badRequest("Choose a colleague, not yourself");
  await requirePerson(ctx, input.toEmployeeId);
  if (input.targetShiftId) {
    const [t] = await ctx.db.select().from(shifts).where(eq(shifts.id, input.targetShiftId));
    if (!t || t.employeeId !== input.toEmployeeId || !t.publishedAt) throw E.badRequest("Pick one of your colleague's published shifts");
    if (t.day < today) throw E.conflict("Their shift is in the past");
  }
  const [open] = await ctx.db.select({ id: swaps.id }).from(swaps).where(and(eq(swaps.shiftId, s.id), inArray(swaps.status, ["pending", "accepted"])));
  if (open) throw E.conflict("There is already an open swap request for this shift");
  const [w] = await ctx.db.insert(swaps).values({
    id: uuidv7(), tenantId: ctx.tenantId, shiftId: s.id, fromEmployeeId: uid, toEmployeeId: input.toEmployeeId,
    targetShiftId: input.targetShiftId ?? null, message: input.message || null, status: "pending",
  }).returning();
  await ctx.events.emit("scheduling.swap.requested", { id: w!.id, shiftId: s.id, fromEmployeeId: uid, toEmployeeId: input.toEmployeeId, day: s.day });
  return (await swapDto(ctx, [w!]))[0];
}

async function loadSwap(ctx: ModuleContext, id: string) {
  const [w] = await ctx.db.select().from(swaps).where(eq(swaps.id, id));
  const uid = me(ctx);
  if (!w || (w.fromEmployeeId !== uid && w.toEmployeeId !== uid && !canManage(ctx))) throw E.notFound("Swap request");
  return w;
}
async function setSwap(ctx: ModuleContext, w: SwapRow, from: SwapRow["status"][], to: SwapRow["status"], extra: Partial<SwapRow> = {}) {
  if (!from.includes(w.status)) throw E.conflict(`This swap request is already ${w.status}`);
  const [u] = await ctx.db.update(swaps).set({ status: to, ...extra }).where(and(eq(swaps.id, w.id), eq(swaps.status, w.status))).returning();
  if (!u) throw E.conflict("Someone else just changed this request; reload and try again");
  return (await swapDto(ctx, [u]))[0];
}

export async function respondSwap(ctx: ModuleContext, id: string, accept: boolean) {
  const w = await loadSwap(ctx, id);
  if (w.toEmployeeId !== me(ctx)) throw E.forbidden("Only the colleague who was asked can answer");
  return setSwap(ctx, w, ["pending"], accept ? "accepted" : "declined");
}
export async function cancelSwap(ctx: ModuleContext, id: string) {
  const w = await loadSwap(ctx, id);
  if (w.fromEmployeeId !== me(ctx)) throw E.forbidden("Only the person who asked can cancel");
  return setSwap(ctx, w, ["pending", "accepted"], "cancelled");
}
export async function rejectSwap(ctx: ModuleContext, id: string, comment: string) {
  const w = await loadSwap(ctx, id);
  return setSwap(ctx, w, ["accepted"], "rejected", { decidedBy: me(ctx), decidedAt: new Date(), decisionComment: comment });
}
/** Manager approval moves the shift(s); the schedule must still work for both people. */
export async function approveSwap(ctx: ModuleContext, id: string, comment?: string) {
  const w = await loadSwap(ctx, id);
  if (w.status !== "accepted") throw E.conflict(w.status === "pending" ? "Waiting for the colleague to accept first" : `This swap request is already ${w.status}`);
  const [s] = await ctx.db.select().from(shifts).where(eq(shifts.id, w.shiftId));
  const [t] = w.targetShiftId ? await ctx.db.select().from(shifts).where(eq(shifts.id, w.targetShiftId)) : [];
  if (!s || s.employeeId !== w.fromEmployeeId || (w.targetShiftId && (!t || t.employeeId !== w.toEmployeeId))) {
    throw E.conflict("The shifts changed since this was asked; the request can no longer be approved");
  }
  const moving = [s.id, ...(t ? [t.id] : [])];
  await checkShift(ctx, { employeeId: w.toEmployeeId, day: s.day, start: hhmm(s.startTime), end: hhmm(s.endTime), breakMinutes: s.breakMinutes }, moving);
  if (t) await checkShift(ctx, { employeeId: w.fromEmployeeId, day: t.day, start: hhmm(t.startTime), end: hhmm(t.endTime), breakMinutes: t.breakMinutes }, moving);
  await ctx.db.update(shifts).set({ employeeId: w.toEmployeeId, updatedAt: new Date() }).where(eq(shifts.id, s.id));
  if (t) await ctx.db.update(shifts).set({ employeeId: w.fromEmployeeId, updatedAt: new Date() }).where(eq(shifts.id, t.id));
  const out = await setSwap(ctx, w, ["accepted"], "approved", { decidedBy: me(ctx), decidedAt: new Date(), decisionComment: comment || null });
  await ctx.events.emit("scheduling.swap.approved", { id: w.id, shiftId: s.id, targetShiftId: t?.id ?? null, fromEmployeeId: w.fromEmployeeId, toEmployeeId: w.toEmployeeId });
  await ctx.audit.log("swap.approved", { type: "swap", id: w.id });
  return out;
}

// ───────── Time clock ─────────
type EntryRow = typeof clockEntries.$inferSelect;
const local = (tz: string, col: SQL | typeof clockEntries.clockIn, fmt: string) => sql<string>`to_char(${col} AT TIME ZONE ${tz}, ${fmt})`;

async function entriesBetween(ctx: ModuleContext, from: string, to: string, employeeId?: string) {
  const tz = tzOf(ctx);
  return ctx.db.select({
    e: clockEntries,
    date: local(tz, clockEntries.clockIn, "YYYY-MM-DD"),
    inLocal: local(tz, clockEntries.clockIn, "HH24:MI"),
    outLocal: sql<string | null>`to_char(${clockEntries.clockOut} AT TIME ZONE ${tz}, 'HH24:MI')`,
    outDate: sql<string | null>`to_char(${clockEntries.clockOut} AT TIME ZONE ${tz}, 'YYYY-MM-DD')`,
    minutes: sql<number>`floor(extract(epoch from (coalesce(${clockEntries.clockOut}, now()) - ${clockEntries.clockIn})) / 60)::int`,
  }).from(clockEntries).where(and(
    sql`(${clockEntries.clockIn} AT TIME ZONE ${tz})::date BETWEEN ${from}::date AND ${to}::date`,
    employeeId ? eq(clockEntries.employeeId, employeeId) : undefined,
  )).orderBy(asc(clockEntries.clockIn));
}
const entryDto = (r: Awaited<ReturnType<typeof entriesBetween>>[number]) => ({
  id: r.e.id, employeeId: r.e.employeeId, shiftId: r.e.shiftId, clockIn: r.e.clockIn, clockOut: r.e.clockOut, date: r.date,
  in: r.inLocal, out: r.outLocal, overnight: !!r.outDate && r.outDate !== r.date, minutes: Number(r.minutes), open: !r.e.clockOut,
  note: r.e.note, source: r.e.source, edited: !!r.e.editedAt,
});

export async function clockStatus(ctx: ModuleContext) {
  const uid = requireMe(ctx);
  const tz = tzOf(ctx);
  const now = nowIn(tz);
  const ws = weekStart(now.date);
  const entries = (await entriesBetween(ctx, ws, addDays(ws, 6), uid)).map(entryDto);
  const [open] = await ctx.db.select().from(clockEntries).where(and(eq(clockEntries.employeeId, uid), isNull(clockEntries.clockOut)));
  const todays = await ctx.db.select().from(shifts).where(and(eq(shifts.employeeId, uid), eq(shifts.day, now.date), isNotNull(shifts.publishedAt)))
    .orderBy(asc(shifts.startTime));
  return {
    now: now.time, today: now.date, timezone: tz,
    open: open ? { id: open.id, since: open.clockIn } : null,
    todayShifts: todays.map((s) => shiftDto(s, uid)),
    week: { start: ws, minutes: entries.reduce((a, e) => a + e.minutes, 0), entries },
  };
}

export async function clockIn(ctx: ModuleContext, note?: string) {
  const uid = requireMe(ctx);
  const tz = tzOf(ctx);
  const [open] = await ctx.db.select().from(clockEntries).where(and(eq(clockEntries.employeeId, uid), isNull(clockEntries.clockOut)));
  if (open) throw E.conflict(`You're already clocked in since ${nowIn(tz, open.clockIn).time}`);
  const now = nowIn(tz);
  const todays = await ctx.db.select().from(shifts).where(and(eq(shifts.employeeId, uid), eq(shifts.day, now.date))).orderBy(asc(shifts.startTime));
  const shift = todays.find((s) => hhmm(s.endTime) > now.time || s.endTime <= s.startTime) ?? todays[0];
  const [e] = await ctx.db.insert(clockEntries).values({
    id: uuidv7(), tenantId: ctx.tenantId, employeeId: uid, shiftId: shift?.id ?? null, clockIn: new Date(), note: note || null, source: "clock",
  }).returning();
  await ctx.events.emit("scheduling.clock.in", { entryId: e!.id, employeeId: uid, at: e!.clockIn.toISOString(), shiftId: e!.shiftId });
  return clockStatus(ctx);
}

export async function clockOut(ctx: ModuleContext, note?: string) {
  const uid = requireMe(ctx);
  const [open] = await ctx.db.select().from(clockEntries).where(and(eq(clockEntries.employeeId, uid), isNull(clockEntries.clockOut)));
  if (!open) throw E.conflict("You're not clocked in");
  const out = new Date();
  if (out.getTime() - open.clockIn.getTime() > 24 * 3600_000) {
    throw E.conflict("You've been clocked in for over 24 hours. Ask a manager to fix this entry.");
  }
  await ctx.db.update(clockEntries).set({ clockOut: out, note: note ? [open.note, note].filter(Boolean).join(" · ") : open.note }).where(eq(clockEntries.id, open.id));
  await ctx.events.emit("scheduling.clock.out", { entryId: open.id, employeeId: uid, at: out.toISOString(), minutes: Math.floor((out.getTime() - open.clockIn.getTime()) / 60000) });
  return clockStatus(ctx);
}

/** Local date + times -> instants (an out at or before the in means the next day). */
async function toInstants(ctx: ModuleContext, date: string, inT: string, outT: string) {
  const tz = tzOf(ctx);
  const outDate = outT <= inT ? addDays(date, 1) : date;
  const [r] = await ctx.db.execute<{ i: string; o: string }>(sql`select (${date}::date + ${inT}::time) AT TIME ZONE ${tz} as i, (${outDate}::date + ${outT}::time) AT TIME ZONE ${tz} as o`) as unknown as { i: string; o: string }[];
  return { clockIn: new Date(r!.i), clockOut: new Date(r!.o) };
}
async function checkEntry(ctx: ModuleContext, employeeId: string, clockIn: Date, clockOut: Date, ignore?: string) {
  if (clockOut.getTime() - clockIn.getTime() > 24 * 3600_000) throw E.badRequest("An entry can be at most 24 hours");
  if (clockIn.getTime() > Date.now()) throw E.badRequest("Entries can't start in the future");
  const [clash] = await ctx.db.select({ id: clockEntries.id }).from(clockEntries).where(and(
    eq(clockEntries.employeeId, employeeId), ignore ? ne(clockEntries.id, ignore) : undefined,
    sql`${clockEntries.clockIn} < ${clockOut.toISOString()}::timestamptz`,
    sql`coalesce(${clockEntries.clockOut}, now()) > ${clockIn.toISOString()}::timestamptz`,
  ));
  if (clash) throw E.conflict("This overlaps another time entry for the same person");
}

export async function addEntry(ctx: ModuleContext, input: z.infer<typeof EntryInput>) {
  await requirePerson(ctx, input.employeeId);
  const { clockIn: ci, clockOut: co } = await toInstants(ctx, input.date, input.in, input.out);
  await checkEntry(ctx, input.employeeId, ci, co);
  const [e] = await ctx.db.insert(clockEntries).values({
    id: uuidv7(), tenantId: ctx.tenantId, employeeId: input.employeeId, clockIn: ci, clockOut: co, note: input.note || null,
    source: "manual", editedBy: me(ctx), editedAt: new Date(),
  }).returning();
  await ctx.audit.log("time_entry.added", { type: "time_entry", id: e!.id }, { employeeId: input.employeeId, date: input.date, in: input.in, out: input.out });
  return { id: e!.id };
}

export async function updateEntry(ctx: ModuleContext, id: string, patch: z.infer<typeof EntryPatch>) {
  const tz = tzOf(ctx);
  const [e] = await ctx.db.select().from(clockEntries).where(eq(clockEntries.id, id));
  if (!e) throw E.notFound("Time entry");
  const cur = nowIn(tz, e.clockIn);
  const date = patch.date ?? cur.date, inT = patch.in ?? cur.time;
  const outT = patch.out ?? (e.clockOut ? nowIn(tz, e.clockOut).time : undefined);
  if (!outT) throw E.badRequest("Enter the time they clocked out");
  const { clockIn: ci, clockOut: co } = await toInstants(ctx, date, inT, outT);
  await checkEntry(ctx, e.employeeId, ci, co, id);
  await ctx.db.update(clockEntries).set({
    clockIn: ci, clockOut: co, ...(patch.note !== undefined ? { note: patch.note || null } : {}), editedBy: me(ctx), editedAt: new Date(),
  }).where(eq(clockEntries.id, id));
  await ctx.audit.log("time_entry.edited", { type: "time_entry", id }, {
    before: { in: e.clockIn.toISOString(), out: e.clockOut?.toISOString() ?? null }, after: { in: ci.toISOString(), out: co.toISOString() },
  });
  return { id };
}

export async function deleteEntry(ctx: ModuleContext, id: string) {
  const r = await ctx.db.delete(clockEntries).where(eq(clockEntries.id, id)).returning();
  if (!r.length) throw E.notFound("Time entry");
  await ctx.audit.log("time_entry.deleted", { type: "time_entry", id }, { employeeId: r[0]!.employeeId, in: r[0]!.clockIn.toISOString() });
}

// ───────── Timesheet (manager) ─────────
function range(ctx: ModuleContext, q: z.infer<typeof RangeQuery>) {
  if (q.from && q.to) {
    if (q.to < q.from) throw E.badRequest("The end date is before the start date");
    if (Date.parse(q.to) - Date.parse(q.from) > 92 * 86_400_000) throw E.badRequest("Choose at most three months at once");
    return { from: q.from, to: q.to };
  }
  const s = weekStart(q.start ?? q.from ?? nowIn(tzOf(ctx)).date);
  return { from: s, to: addDays(s, 6) };
}

export async function timesheet(ctx: ModuleContext, q: z.infer<typeof RangeQuery>) {
  const { from, to } = range(ctx, q);
  const entries = (await entriesBetween(ctx, from, to, q.employeeId)).map(entryDto);
  const planned = await ctx.db.select().from(shifts).where(and(
    gte(shifts.day, from), lte(shifts.day, to), isNotNull(shifts.publishedAt), q.employeeId ? eq(shifts.employeeId, q.employeeId) : undefined,
  ));
  const { people, name } = await peopleMap(ctx);
  const ids = new Set([...people.map((p) => p.userId), ...entries.map((e) => e.employeeId), ...planned.map((s) => s.employeeId)]);
  const rows = [...ids].filter((id) => !q.employeeId || id === q.employeeId).map((id) => {
    const es = entries.filter((e) => e.employeeId === id);
    return {
      employeeId: id, name: name(id),
      scheduledMinutes: planned.filter((s) => s.employeeId === id).reduce((a, s) => a + paidMinutes(s.startTime, s.endTime, s.breakMinutes), 0),
      workedMinutes: es.reduce((a, e) => a + e.minutes, 0),
      clockedIn: es.some((e) => e.open),
      entries: es,
    };
  }).filter((r) => r.entries.length || r.scheduledMinutes || people.some((p) => p.userId === r.employeeId))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  return { from, to, timezone: tzOf(ctx), rows };
}

const csvCell = (v: unknown) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function timesheetCsv(ctx: ModuleContext, q: z.infer<typeof RangeQuery>) {
  const t = await timesheet(ctx, q);
  const lines = [["Employee", "Date", "Clock in", "Clock out", "Hours", "Decimal hours", "Note", "Edited by manager"].join(",")];
  for (const r of t.rows) {
    for (const e of r.entries) {
      lines.push([r.name, e.date, e.in, e.open ? "(still clocked in)" : `${e.out}${e.overnight ? " (+1 day)" : ""}`, fmtHours(e.minutes), (e.minutes / 60).toFixed(2), e.note, e.edited ? "yes" : ""].map(csvCell).join(","));
    }
    if (r.entries.length) lines.push([`${r.name} total`, `${t.from} to ${t.to}`, "", "", fmtHours(r.workedMinutes), (r.workedMinutes / 60).toFixed(2), `Scheduled ${fmtHours(r.scheduledMinutes)}`, ""].map(csvCell).join(","));
  }
  return { filename: `hours-${t.from}-to-${t.to}.csv`, rows: t.rows.reduce((a, r) => a + r.entries.length, 0), csv: `﻿${lines.join("\r\n")}\r\n` };
}

// ───────── Dashboard ─────────
export async function summary(ctx: ModuleContext) {
  const uid = me(ctx) ?? NONE;
  const tz = tzOf(ctx);
  const now = nowIn(tz);
  const [next] = await ctx.db.select().from(shifts).where(and(
    eq(shifts.employeeId, uid), isNotNull(shifts.publishedAt),
    or(sql`${shifts.day} > ${now.date}::date`, and(eq(shifts.day, now.date), sql`(${shifts.endTime} > ${now.time}::time OR ${shifts.endTime} <= ${shifts.startTime})`)),
  )).orderBy(asc(shifts.day), asc(shifts.startTime)).limit(1);
  const [open] = await ctx.db.select({ since: clockEntries.clockIn }).from(clockEntries).where(and(eq(clockEntries.employeeId, uid), isNull(clockEntries.clockOut)));
  const out: Record<string, unknown> = { nextShift: next ? shiftDto(next, uid) : null, clockedInSince: open?.since ?? null };
  if (canManage(ctx)) {
    const [{ n: pendingTimeOff }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(timeOff).where(eq(timeOff.status, "pending")) as [{ n: number }];
    const [{ n: pendingSwaps }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(swaps).where(eq(swaps.status, "accepted")) as [{ n: number }];
    const working = await ctx.db.select({ employeeId: clockEntries.employeeId }).from(clockEntries).where(isNull(clockEntries.clockOut));
    const { name } = await peopleMap(ctx);
    Object.assign(out, { pendingTimeOff, pendingSwaps, clockedInNow: working.map((w) => name(w.employeeId)) });
  }
  return out;
}

export type { EntryRow };
