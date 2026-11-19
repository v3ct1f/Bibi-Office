import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "@office/db";
import { moduleErrors as E, type ModuleContext, type UploadedFile } from "@office/sdk";
import {
  employees, holidays, hrDocuments, leaveRequests, leaveTypes, type DocKind, type Employee, type LeaveRequest, type LeaveStatus, type LeaveType,
} from "./schema.ts";

export const P = {
  directory: "hr:directory.read", request: "hr:leave.request", approve: "hr:leave.approve", manage: "hr:employees.manage",
} as const;
const me = (ctx: ModuleContext) => ctx.actor.userId ?? null;
const isSystem = (ctx: ModuleContext) => ctx.actor.type === "system";
const pgCode = (e: unknown): string | undefined => (e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code;
const pgConstraint = (e: unknown): string | undefined => (e as { constraint_name?: string }).constraint_name ?? (e as { cause?: { constraint_name?: string } }).cause?.constraint_name;

// ───────────────────────── settings ─────────────────────────
export interface HrSettings { defaultAllowance: number; workDays: number[]; timezone: string; emailNotifications: boolean }
export const SETTINGS_SCHEMA = {
  type: "object",
  properties: {
    defaultAllowance: { type: "number", title: "Yearly time-off allowance (days)", default: 25, minimum: 0, maximum: 365, multipleOf: 0.5 },
    workDays: {
      type: "array", title: "Working days (1 = Monday … 7 = Sunday)", default: [1, 2, 3, 4, 5],
      items: { type: "integer", minimum: 1, maximum: 7 }, minItems: 1, maxItems: 7, uniqueItems: true,
    },
    timezone: { type: "string", title: "Time zone for 'today' (IANA)", default: "UTC", maxLength: 64 },
    emailNotifications: { type: "boolean", title: "Email managers about requests and people about decisions", default: true },
  },
  additionalProperties: false,
} as const;
const validTz = (tz: string) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } };
export const settingsOf = (ctx: ModuleContext): HrSettings => {
  const s = { defaultAllowance: 25, workDays: [1, 2, 3, 4, 5], timezone: "UTC", emailNotifications: true, ...ctx.settings.get<Partial<HrSettings>>() };
  if (!validTz(s.timezone)) s.timezone = "UTC";
  return s;
};
export const today = (ctx: ModuleContext) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: settingsOf(ctx).timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// ───────────────────────── dates ─────────────────────────
const DAY = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const isoWeekday = (d: string) => ((new Date(toMs(d)).getUTCDay() + 6) % 7) + 1;
const ymd = z.iso.date();

/** Working days between two dates (inclusive), minus company holidays. Half day counts 0.5. */
export async function countWorkingDays(ctx: ModuleContext, start: string, end: string, halfDay = false) {
  if (toMs(end) < toMs(start)) throw E.badRequest("The end date is before the start date");
  if ((toMs(end) - toMs(start)) / DAY > 366) throw E.badRequest("Requests can be at most a year long");
  const work = new Set(settingsOf(ctx).workDays);
  const hol = new Set((await ctx.db.select({ d: holidays.day }).from(holidays).where(and(gte(holidays.day, start), lte(holidays.day, end)))).map((h) => h.d));
  let n = 0;
  for (let t = toMs(start); t <= toMs(end); t += DAY) { const d = fromMs(t); if (work.has(isoWeekday(d)) && !hol.has(d)) n++; }
  return halfDay ? n * 0.5 : n;
}

// ───────────────────────── input schemas ─────────────────────────
const opt = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v === "" ? null : v));
const EmployeeFields = {
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100).default(""),
  workEmail: z.email().max(320).nullable().optional().transform((v) => v?.toLowerCase() ?? v),
  jobTitle: opt(120), department: opt(120),
  managerId: z.uuid().nullable().optional(),
  userId: z.uuid().nullable().optional(),
  employmentType: z.enum(["full_time", "part_time", "contractor", "intern"]).default("full_time"),
  startDate: ymd,
  endDate: ymd.nullable().optional(),
  annualAllowance: z.number().min(0).max(365).multipleOf(0.5).nullable().optional(),
  birthDate: ymd.nullable().optional(),
  phone: opt(50), address: opt(500), emergencyContact: opt(300), notes: opt(5000),
};
export const EmployeeIn = z.object(EmployeeFields);
export const EmployeePatch = z.object({
  ...EmployeeFields, lastName: z.string().trim().max(100).optional(), employmentType: EmployeeFields.employmentType.unwrap().optional(), startDate: ymd.optional(),
  firstName: EmployeeFields.firstName.optional(),
}).refine((x) => Object.keys(x).length > 0, "Nothing to change");
export const SelfPatch = z.object({ phone: opt(50), address: opt(500), emergencyContact: opt(300) }).refine((x) => Object.keys(x).length > 0, "Nothing to change");
export const DirectoryQuery = z.object({ q: z.string().trim().max(100).optional(), department: z.string().max(120).optional(), includeLeft: z.stringbool().default(false) });
export const LeaveIn = z.object({
  employeeId: z.uuid().optional(),
  typeId: z.uuid(),
  startDate: ymd, endDate: ymd,
  halfDay: z.boolean().default(false),
  note: z.string().trim().max(1000).optional(),
});
export const DecideIn = z.object({ note: z.string().trim().max(1000).optional() });
export const LeaveQuery = z.object({
  scope: z.enum(["mine", "approvals", "all"]).default("mine"),
  employeeId: z.uuid().optional(),
  status: z.enum(["requested", "approved", "rejected", "cancelled"]).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
export const RangeQuery = z.object({ from: ymd, to: ymd });
export const LeaveTypeIn = z.object({
  name: z.string().trim().min(1).max(60), usesAllowance: z.boolean().default(true), needsApproval: z.boolean().default(true),
  paid: z.boolean().default(true), position: z.number().int().min(0).max(1000).default(0),
});
export const LeaveTypePatch = z.object({
  name: z.string().trim().min(1).max(60).optional(), usesAllowance: z.boolean().optional(), needsApproval: z.boolean().optional(),
  paid: z.boolean().optional(), position: z.number().int().min(0).max(1000).optional(), archived: z.boolean().optional(),
});
export const HolidayIn = z.object({ day: ymd, name: z.string().trim().min(1).max(100) });
export const DocQuery = z.object({
  filename: z.string().min(1).max(255), title: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(["contract", "identity", "certificate", "review", "other"]).default("other"),
});

// ───────────────────────── people & access ─────────────────────────
const fullName = (e: Pick<Employee, "firstName" | "lastName">) => [e.firstName, e.lastName].filter(Boolean).join(" ");
export async function myEmployee(ctx: ModuleContext) {
  const uid = me(ctx);
  if (!uid) return null;
  const [e] = await ctx.db.select().from(employees).where(eq(employees.userId, uid));
  return e ?? null;
}
async function loadEmployee(ctx: ModuleContext, id: string) {
  const [e] = await ctx.db.select().from(employees).where(eq(employees.id, id));
  if (!e) throw E.notFound("Employee");
  return e;
}
interface Access { manage: boolean; approve: boolean; mine: Employee | null }
const access = async (ctx: ModuleContext): Promise<Access> => ({ manage: ctx.authz.can(P.manage), approve: ctx.authz.can(P.approve), mine: await myEmployee(ctx) });
const isSelf = (a: Access, e: Employee) => !!a.mine && a.mine.id === e.id;
const isManagerOf = (a: Access, e: Employee) => !!a.mine && e.managerId === a.mine.id;
/** Private profile fields and documents: HR managers and the person themself. */
const seesPrivate = (a: Access, e: Employee) => a.manage || isSelf(a, e);
/** Leave details (type, notes, balance): HR, approvers, the person, and their manager. */
const seesLeave = (a: Access, e: Employee) => a.manage || a.approve || isSelf(a, e) || isManagerOf(a, e);
/** Approve/reject: the direct manager or an approver, never for oneself (workflows act as system). */
const canDecide = (ctx: ModuleContext, a: Access, e: Employee) => isSystem(ctx) || ((a.approve || isManagerOf(a, e)) && !isSelf(a, e));

const statusOf = (e: Employee, now: string) => (e.endDate && e.endDate < now ? "left" : e.startDate > now ? "upcoming" : "active");
async function present(ctx: ModuleContext, a: Access, rows: Employee[]) {
  const mgrIds = [...new Set(rows.map((r) => r.managerId).filter((x): x is string => !!x))];
  const mgrs = mgrIds.length ? await ctx.db.select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName }).from(employees).where(inArray(employees.id, mgrIds)) : [];
  const mName = new Map(mgrs.map((m) => [m.id, fullName(m)]));
  const now = today(ctx);
  return rows.map((e) => {
    const base = {
      id: e.id, name: fullName(e), firstName: e.firstName, lastName: e.lastName, workEmail: e.workEmail, jobTitle: e.jobTitle, department: e.department,
      managerId: e.managerId, managerName: e.managerId ? mName.get(e.managerId) ?? null : null, userId: e.userId, employmentType: e.employmentType,
      startDate: e.startDate, endDate: e.endDate, status: statusOf(e, now), isMe: isSelf(a, e),
    };
    return seesPrivate(a, e)
      ? { ...base, private: true as const, birthDate: e.birthDate, phone: e.phone, address: e.address, emergencyContact: e.emergencyContact, annualAllowance: e.annualAllowance, ...(a.manage ? { notes: e.notes } : {}) }
      : { ...base, private: false as const };
  });
}
const payload = (e: Employee) => ({ id: e.id, name: fullName(e), userId: e.userId, managerId: e.managerId, department: e.department, jobTitle: e.jobTitle, startDate: e.startDate, endDate: e.endDate });

// ───────────────────────── employees ─────────────────────────
export async function listEmployees(ctx: ModuleContext, q: z.infer<typeof DirectoryQuery>) {
  const a = await access(ctx);
  const conds: (SQL | undefined)[] = [];
  if (!q.includeLeft) conds.push(or(isNull(employees.endDate), gte(employees.endDate, today(ctx))));
  if (q.department) conds.push(eq(employees.department, q.department));
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(employees.firstName, like), ilike(employees.lastName, like), ilike(employees.jobTitle, like), ilike(employees.department, like), ilike(employees.workEmail, like)));
  }
  const rows = await ctx.db.select().from(employees).where(and(...conds)).orderBy(asc(sql`lower(${employees.firstName})`), asc(sql`lower(${employees.lastName})`)).limit(1000);
  const departments = (await ctx.db.selectDistinct({ d: employees.department }).from(employees).where(sql`${employees.department} is not null`)).map((r) => r.d!).sort();
  return { data: await present(ctx, a, rows), departments };
}

export async function getEmployee(ctx: ModuleContext, id: string) {
  const a = await access(ctx);
  const e = await loadEmployee(ctx, id);
  const [p] = await present(ctx, a, [e]);
  const reports = await present(ctx, a, await ctx.db.select().from(employees).where(and(eq(employees.managerId, id), or(isNull(employees.endDate), gte(employees.endDate, today(ctx))))).orderBy(asc(employees.firstName)));
  return {
    ...p!, reports: reports.map(({ id: rid, name, jobTitle }) => ({ id: rid, name, jobTitle })),
    canSeeLeave: seesLeave(a, e), canManage: a.manage,
    balance: seesLeave(a, e) ? await balance(ctx, e, Number(today(ctx).slice(0, 4))) : null,
  };
}

async function checkRefs(ctx: ModuleContext, i: { userId?: string | null | undefined }) {
  if (i.userId && !(await ctx.people.names([i.userId]))[i.userId]) throw E.unprocessable("That account is not a member of this organization");
}
const saveErr = (e: unknown): never => {
  const c = pgCode(e), k = pgConstraint(e);
  if (c === "23505" && k === "hr_employees_user") throw E.conflict("That member is already linked to another employee");
  if (c === "23505" && k === "hr_employees_email") throw E.conflict("Another employee has this work email");
  if (c === "23514" && k === "hr_manager_cycle") throw E.unprocessable("That would make a management loop");
  if (c === "23514" && k === "hr_employees_dates") throw E.unprocessable("End date must be on or after the start date");
  if (c === "23514") throw E.unprocessable("Invalid values");
  if (c === "23503") throw E.unprocessable("Manager not found");
  throw e;
};

export async function createEmployee(ctx: ModuleContext, i: z.infer<typeof EmployeeIn>) {
  await checkRefs(ctx, i);
  let row: Employee;
  try {
    [row] = await ctx.db.insert(employees).values({ id: uuidv7(), tenantId: ctx.tenantId, ...i }).returning() as [Employee];
  } catch (e) { return saveErr(e); }
  await ctx.audit.log("employee.created", { type: "hr.employee", id: row.id }, { name: fullName(row) });
  await ctx.events.emit("hr.employee.created", payload(row));
  return getEmployee(ctx, row.id);
}

const PRIVATE = ["birthDate", "phone", "address", "emergencyContact", "notes"] as const;
export async function updateEmployee(ctx: ModuleContext, id: string, p: z.infer<typeof EmployeePatch>) {
  const cur = await loadEmployee(ctx, id);
  await checkRefs(ctx, p);
  let row: Employee;
  try {
    [row] = await ctx.db.update(employees).set({ ...p, updatedAt: new Date() }).where(eq(employees.id, id)).returning() as [Employee];
  } catch (e) { return saveErr(e); }
  // audit names changed fields; values only for non-private ones
  const diff = Object.fromEntries(Object.keys(p).filter((k) => (cur as Record<string, unknown>)[k] !== (row as Record<string, unknown>)[k])
    .map((k) => [k, (PRIVATE as readonly string[]).includes(k) ? "(changed)" : { from: (cur as Record<string, unknown>)[k], to: (row as Record<string, unknown>)[k] }]));
  await ctx.audit.log("employee.updated", { type: "hr.employee", id }, diff);
  await ctx.events.emit("hr.employee.updated", { ...payload(row), changed: Object.keys(diff) });
  if (row.endDate && row.endDate !== cur.endDate) await ctx.events.emit("hr.employee.left", payload(row));
  return getEmployee(ctx, id);
}

/** People update their own contact details. */
export async function updateSelf(ctx: ModuleContext, p: z.infer<typeof SelfPatch>) {
  const mine = await myEmployee(ctx);
  if (!mine) throw E.notFound("Employee record");
  await ctx.db.update(employees).set({ ...p, updatedAt: new Date() }).where(eq(employees.id, mine.id));
  await ctx.audit.log("employee.self_updated", { type: "hr.employee", id: mine.id }, { changed: Object.keys(p) });
  return getEmployee(ctx, mine.id);
}

// ───────────────────────── leave types & holidays ─────────────────────────
export const DEFAULT_TYPES = [
  { name: "Vacation", usesAllowance: true, needsApproval: true, paid: true, position: 0 },
  { name: "Sick leave", usesAllowance: false, needsApproval: false, paid: true, position: 1 },
  { name: "Unpaid leave", usesAllowance: false, needsApproval: true, paid: false, position: 2 },
];
export async function seedTypes(ctx: ModuleContext) {
  const [any] = await ctx.db.select({ id: leaveTypes.id }).from(leaveTypes).limit(1);
  if (!any) await ctx.db.insert(leaveTypes).values(DEFAULT_TYPES.map((t) => ({ ...t, id: uuidv7(), tenantId: ctx.tenantId, archived: false })));
}
export const listTypes = (ctx: ModuleContext) => ctx.db.select().from(leaveTypes).orderBy(asc(leaveTypes.position), asc(leaveTypes.name));
export async function createType(ctx: ModuleContext, i: z.infer<typeof LeaveTypeIn>) {
  try {
    const [t] = await ctx.db.insert(leaveTypes).values({ id: uuidv7(), tenantId: ctx.tenantId, archived: false, ...i }).returning();
    await ctx.audit.log("leave_type.created", { type: "hr.leave_type", id: t!.id }, i);
    return t!;
  } catch (e) { if (pgCode(e) === "23505") throw E.conflict("A leave type with this name exists"); throw e; }
}
export async function updateType(ctx: ModuleContext, id: string, p: z.infer<typeof LeaveTypePatch>) {
  try {
    const [t] = await ctx.db.update(leaveTypes).set(p).where(eq(leaveTypes.id, id)).returning();
    if (!t) throw E.notFound("Leave type");
    await ctx.audit.log("leave_type.updated", { type: "hr.leave_type", id }, p);
    return t;
  } catch (e) { if (pgCode(e) === "23505") throw E.conflict("A leave type with this name exists"); throw e; }
}
export const listHolidays = (ctx: ModuleContext, year: number) =>
  ctx.db.select().from(holidays).where(and(gte(holidays.day, `${year}-01-01`), lte(holidays.day, `${year}-12-31`))).orderBy(asc(holidays.day));
export async function addHoliday(ctx: ModuleContext, i: z.infer<typeof HolidayIn>) {
  try {
    const [h] = await ctx.db.insert(holidays).values({ id: uuidv7(), tenantId: ctx.tenantId, ...i }).returning();
    await ctx.audit.log("holiday.added", { type: "hr.holiday", id: h!.id }, i);
    return h!;
  } catch (e) { if (pgCode(e) === "23505") throw E.conflict("There is already a holiday on that day"); throw e; }
}
export async function removeHoliday(ctx: ModuleContext, id: string) {
  const r = await ctx.db.delete(holidays).where(eq(holidays.id, id)).returning();
  if (!r.length) throw E.notFound("Holiday");
  await ctx.audit.log("holiday.removed", { type: "hr.holiday", id }, { day: r[0]!.day });
}

// ───────────────────────── balance ─────────────────────────
/** Yearly allowance, prorated for people who start or leave during the year (rounded to half days). */
export function allowanceFor(e: Employee, s: HrSettings, year: number) {
  const full = e.annualAllowance ?? s.defaultAllowance;
  const ys = toMs(`${year}-01-01`), ye = toMs(`${year}-12-31`);
  const from = Math.max(ys, toMs(e.startDate)), to = Math.min(ye, e.endDate ? toMs(e.endDate) : ye);
  if (to < from) return 0;
  const share = ((to - from) / DAY + 1) / ((ye - ys) / DAY + 1);
  return Math.round(full * share * 2) / 2;
}
export async function balance(ctx: ModuleContext, e: Employee, year: number) {
  const rows = await ctx.db.select({ status: leaveRequests.status, days: sql<string>`sum(${leaveRequests.days})` }).from(leaveRequests)
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.typeId))
    .where(and(eq(leaveRequests.employeeId, e.id), eq(leaveTypes.usesAllowance, true), inArray(leaveRequests.status, ["requested", "approved"]),
      gte(leaveRequests.startDate, `${year}-01-01`), lte(leaveRequests.startDate, `${year}-12-31`)))
    .groupBy(leaveRequests.status);
  const sum = (st: LeaveStatus) => Number(rows.find((r) => r.status === st)?.days ?? 0);
  const allowance = allowanceFor(e, settingsOf(ctx), year);
  const used = sum("approved"), pending = sum("requested");
  return { year, allowance, used, pending, remaining: allowance - used - pending };
}

// ───────────────────────── leave requests ─────────────────────────
type Row = LeaveRequest & { typeName: string; usesAllowance: boolean; employeeName: string };
async function presentLeave(ctx: ModuleContext, a: Access, rows: Row[], emps: Map<string, Employee>) {
  return rows.map((r) => {
    const e = emps.get(r.employeeId)!;
    return { ...r, canDecide: r.status === "requested" && canDecide(ctx, a, e), canCancel: canCancel(ctx, a, e, r), mine: isSelf(a, e) };
  });
}
const canCancel = (ctx: ModuleContext, a: Access, e: Employee, r: LeaveRequest) =>
  (r.status === "requested" || r.status === "approved") && (a.manage || isSystem(ctx) || (isSelf(a, e) && (r.status === "requested" || r.startDate > today(ctx))));

const leaveSelect = (ctx: ModuleContext) => ctx.db.select({
  r: leaveRequests, typeName: leaveTypes.name, usesAllowance: leaveTypes.usesAllowance, firstName: employees.firstName, lastName: employees.lastName,
}).from(leaveRequests).innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.typeId)).innerJoin(employees, eq(employees.id, leaveRequests.employeeId));

export async function listLeave(ctx: ModuleContext, q: z.infer<typeof LeaveQuery>) {
  const a = await access(ctx);
  const conds: (SQL | undefined)[] = [];
  if (q.scope === "mine") { if (!a.mine) return { data: [] }; conds.push(eq(leaveRequests.employeeId, a.mine.id)); }
  if (q.scope === "approvals") {
    conds.push(eq(leaveRequests.status, "requested"));
    if (!a.approve) { if (!a.mine) return { data: [] }; conds.push(eq(employees.managerId, a.mine.id)); }
  }
  if (q.scope === "all") {
    if (q.employeeId) {
      const e = await loadEmployee(ctx, q.employeeId);
      if (!seesLeave(a, e)) throw E.forbidden("You can't see this person's time off");
      conds.push(eq(leaveRequests.employeeId, q.employeeId));
    } else if (!a.manage && !a.approve) throw E.forbidden("Missing permission to see everyone's time off");
  }
  if (q.status && q.scope !== "approvals") conds.push(eq(leaveRequests.status, q.status));
  if (q.year) conds.push(gte(leaveRequests.startDate, `${q.year}-01-01`), lte(leaveRequests.startDate, `${q.year}-12-31`));
  const rows = await leaveSelect(ctx).where(and(...conds)).orderBy(desc(leaveRequests.startDate), desc(leaveRequests.id)).limit(500);
  const emps = await employeeMap(ctx, rows.map((x) => x.r.employeeId));
  const data = await presentLeave(ctx, a, rows.map((x) => ({ ...x.r, typeName: x.typeName, usesAllowance: x.usesAllowance, employeeName: fullName(x) })), emps);
  return { data: q.scope === "approvals" ? data.filter((d) => d.canDecide) : data };
}
async function employeeMap(ctx: ModuleContext, ids: string[]) {
  const u = [...new Set(ids)];
  return new Map((u.length ? await ctx.db.select().from(employees).where(inArray(employees.id, u)) : []).map((e) => [e.id, e]));
}
async function getLeave(ctx: ModuleContext, id: string, lock = false) {
  const q = leaveSelect(ctx).where(eq(leaveRequests.id, id));
  const [x] = lock ? await q.for("update", { of: leaveRequests }) : await q;
  if (!x) throw E.notFound("Leave request");
  return { r: { ...x.r, typeName: x.typeName, usesAllowance: x.usesAllowance, employeeName: fullName(x) } as Row, e: await loadEmployee(ctx, x.r.employeeId) };
}
async function oneLeave(ctx: ModuleContext, id: string) {
  const a = await access(ctx);
  const { r, e } = await getLeave(ctx, id);
  if (!seesLeave(a, e)) throw E.notFound("Leave request");
  return (await presentLeave(ctx, a, [r], new Map([[e.id, e]])))[0]!;
}
const leavePayload = (r: Row, e: Employee) => ({
  id: r.id, employeeId: e.id, employeeName: fullName(e), userId: e.userId, managerId: e.managerId, type: r.typeName,
  startDate: r.startDate, endDate: r.endDate, days: r.days, status: r.status,
});
const fmtRange = (r: Pick<LeaveRequest, "startDate" | "endDate" | "halfDay">) => (r.startDate === r.endDate ? `${r.startDate}${r.halfDay ? " (half day)" : ""}` : `${r.startDate} to ${r.endDate}`);

async function notify(ctx: ModuleContext, to: string | null | undefined, subject: string, lines: string[]) {
  if (!to || !settingsOf(ctx).emailNotifications) return;
  await ctx.mail.send({ to, subject, text: [...lines, `${ctx.mail.appUrl}/m/hr/people`].join("\n") });
}

export async function requestLeave(ctx: ModuleContext, i: z.infer<typeof LeaveIn>) {
  const a = await access(ctx);
  let e: Employee;
  if (i.employeeId && i.employeeId !== a.mine?.id) {
    if (!a.manage) throw E.forbidden("You can only request time off for yourself");
    e = await loadEmployee(ctx, i.employeeId);
  } else {
    if (!a.mine) throw E.unprocessable("Your account is not linked to an employee record. Ask HR to link it.");
    e = a.mine;
  }
  const [type] = await ctx.db.select().from(leaveTypes).where(eq(leaveTypes.id, i.typeId));
  if (!type || type.archived) throw E.unprocessable("Choose a leave type");
  if (i.startDate.slice(0, 4) !== i.endDate.slice(0, 4)) throw E.badRequest("Split requests at the new year");
  if (i.halfDay && i.startDate !== i.endDate) throw E.badRequest("A half day must be a single day");
  if (i.startDate < e.startDate || (e.endDate && i.endDate > e.endDate)) throw E.unprocessable("Those dates are outside this person's employment");
  const days = await countWorkingDays(ctx, i.startDate, i.endDate, i.halfDay);
  if (!days) throw E.unprocessable("There are no working days in that range");
  if (type.usesAllowance) {
    const b = await balance(ctx, e, Number(i.startDate.slice(0, 4)));
    if (days > b.remaining) throw E.unprocessable(`Not enough time off left: ${b.remaining} day${b.remaining === 1 ? "" : "s"} available, ${days} requested`);
  }
  const auto = !type.needsApproval;
  let row: LeaveRequest;
  try {
    [row] = await ctx.db.insert(leaveRequests).values({
      id: uuidv7(), tenantId: ctx.tenantId, employeeId: e.id, typeId: type.id, startDate: i.startDate, endDate: i.endDate, halfDay: i.halfDay,
      days, status: auto ? "approved" : "requested", note: i.note || null, requestedBy: ctx.actor.id,
      ...(auto ? { decidedBy: "auto", decidedAt: new Date() } : {}),
    }).returning() as [LeaveRequest];
  } catch (err) {
    if (pgCode(err) === "23P01") throw E.conflict("This overlaps time off that is already requested or approved");
    throw err;
  }
  const r: Row = { ...row, typeName: type.name, usesAllowance: type.usesAllowance, employeeName: fullName(e) };
  await ctx.audit.log("leave.requested", { type: "hr.leave", id: row.id }, { employeeId: e.id, type: type.name, startDate: i.startDate, endDate: i.endDate, days });
  await ctx.events.emit("hr.leave.requested", leavePayload(r, e));
  if (auto) await ctx.events.emit("hr.leave.approved", leavePayload(r, e));
  else if (e.managerId) {
    const [mgr] = await ctx.db.select().from(employees).where(eq(employees.id, e.managerId));
    await notify(ctx, mgr?.workEmail, `Time off request: ${fullName(e)}`, [
      `${fullName(e)} asked for ${type.name.toLowerCase()}: ${fmtRange(row)} (${days} working day${days === 1 ? "" : "s"}).`,
      ...(row.note ? [`Note: ${row.note}`] : []), "", "Approve or reject it in Office:",
    ]);
  }
  return oneLeave(ctx, row.id);
}

export async function decideLeave(ctx: ModuleContext, id: string, decision: "approved" | "rejected", note?: string) {
  const a = await access(ctx);
  const { r, e } = await getLeave(ctx, id, true);
  if (!seesLeave(a, e) && !isSystem(ctx)) throw E.notFound("Leave request");
  if (r.status !== "requested") throw E.conflict(`This request is already ${r.status}`);
  if (!canDecide(ctx, a, e)) throw E.forbidden(isSelf(a, e) ? "You can't decide on your own request" : "Only their manager or an approver can decide");
  if (decision === "rejected" && !note?.trim()) throw E.badRequest("Say why you are rejecting it");
  await ctx.db.update(leaveRequests).set({ status: decision, decidedBy: ctx.actor.id, decidedAt: new Date(), decisionNote: note?.trim() || null }).where(eq(leaveRequests.id, id));
  const after: Row = { ...r, status: decision };
  await ctx.audit.log(`leave.${decision}`, { type: "hr.leave", id }, { note: note ?? null });
  await ctx.events.emit(`hr.leave.${decision}`, { ...leavePayload(after, e), note: note ?? null });
  await notify(ctx, e.workEmail, `Time off ${decision}: ${fmtRange(r)}`, [
    `Your ${r.typeName.toLowerCase()} request for ${fmtRange(r)} was ${decision}.`, ...(note ? [`Note: ${note}`] : []), "", "See it in Office:",
  ]);
  return oneLeave(ctx, id);
}

export async function cancelLeave(ctx: ModuleContext, id: string) {
  const a = await access(ctx);
  const { r, e } = await getLeave(ctx, id, true);
  if (!seesLeave(a, e)) throw E.notFound("Leave request");
  if (r.status !== "requested" && r.status !== "approved") throw E.conflict(`This request is already ${r.status}`);
  if (!canCancel(ctx, a, e, r)) throw E.forbidden("Approved time off that has started can only be cancelled by HR");
  await ctx.db.update(leaveRequests).set({ status: "cancelled" }).where(eq(leaveRequests.id, id));
  await ctx.audit.log("leave.cancelled", { type: "hr.leave", id });
  await ctx.events.emit("hr.leave.cancelled", leavePayload({ ...r, status: "cancelled" }, e));
  return oneLeave(ctx, id);
}

/** Who is away between two dates. The reason is shown only to people allowed to see that person's leave. */
export async function whosOff(ctx: ModuleContext, from: string, to: string) {
  if (toMs(to) < toMs(from) || (toMs(to) - toMs(from)) / DAY > 92) throw E.badRequest("Pick a range of up to 3 months");
  const a = await access(ctx);
  const rows = await leaveSelect(ctx).where(and(inArray(leaveRequests.status, ["requested", "approved"]), lte(leaveRequests.startDate, to), gte(leaveRequests.endDate, from)))
    .orderBy(asc(leaveRequests.startDate));
  const emps = await employeeMap(ctx, rows.map((x) => x.r.employeeId));
  return {
    holidays: await ctx.db.select({ day: holidays.day, name: holidays.name }).from(holidays).where(and(gte(holidays.day, from), lte(holidays.day, to))).orderBy(asc(holidays.day)),
    data: rows.map((x) => {
      const e = emps.get(x.r.employeeId)!, show = seesLeave(a, e);
      return {
        id: x.r.id, employeeId: e.id, employeeName: fullName(x), startDate: x.r.startDate, endDate: x.r.endDate, halfDay: x.r.halfDay,
        status: x.r.status, type: show ? x.typeName : null,
      };
    }),
  };
}

// ───────────────────────── documents ─────────────────────────
async function docAccess(ctx: ModuleContext, employeeId: string, write: boolean) {
  const a = await access(ctx);
  const e = await loadEmployee(ctx, employeeId);
  if (write ? !a.manage : !seesPrivate(a, e)) throw a.manage || seesLeave(a, e) || ctx.authz.can(P.directory) ? E.forbidden("Only HR and the person can see their documents") : E.notFound("Employee");
  return e;
}
export async function listDocs(ctx: ModuleContext, employeeId: string) {
  await docAccess(ctx, employeeId, false);
  const rows = await ctx.db.select().from(hrDocuments).where(eq(hrDocuments.employeeId, employeeId)).orderBy(desc(hrDocuments.createdAt));
  return { data: rows.map(({ tenantId: _t, ...d }) => d) };
}
export async function uploadDoc(ctx: ModuleContext, employeeId: string, q: z.infer<typeof DocQuery>, f: UploadedFile | undefined) {
  const e = await docAccess(ctx, employeeId, true);
  if (!f) throw E.badRequest("Send the file as the request body");
  const title = q.title || q.filename.replace(/\.[^.]+$/, "");
  const stored = await ctx.files.put({ filename: q.filename, bytes: f.bytes, ...(f.contentType ? { contentType: f.contentType } : {}), title: `${fullName(e)}: ${title}` });
  const [d] = await ctx.db.insert(hrDocuments).values({ id: uuidv7(), tenantId: ctx.tenantId, employeeId, documentId: stored.id, kind: q.kind as DocKind, title, uploadedBy: ctx.actor.id }).returning();
  await ctx.audit.log("document.added", { type: "hr.employee", id: employeeId }, { kind: q.kind, title });
  const { tenantId: _t, ...out } = d!;
  return { ...out, mime: stored.mime, size: stored.size };
}
export async function readDoc(ctx: ModuleContext, employeeId: string, docId: string) {
  await docAccess(ctx, employeeId, false);
  const [d] = await ctx.db.select().from(hrDocuments).where(and(eq(hrDocuments.id, docId), eq(hrDocuments.employeeId, employeeId)));
  if (!d) throw E.notFound("Document");
  const f = await ctx.files.get(d.documentId);
  await ctx.audit.log("document.viewed", { type: "hr.employee", id: employeeId }, { documentId: d.id });
  return f;
}
export async function removeDoc(ctx: ModuleContext, employeeId: string, docId: string) {
  await docAccess(ctx, employeeId, true);
  const [d] = await ctx.db.delete(hrDocuments).where(and(eq(hrDocuments.id, docId), eq(hrDocuments.employeeId, employeeId))).returning();
  if (!d) throw E.notFound("Document");
  await ctx.files.remove(d.documentId);
  await ctx.audit.log("document.removed", { type: "hr.employee", id: employeeId }, { title: d.title });
}

// ───────────────────────── me & dashboard ─────────────────────────
export async function mine(ctx: ModuleContext) {
  const e = await myEmployee(ctx);
  if (!e) return { employee: null, balance: null };
  return { employee: await getEmployee(ctx, e.id), balance: await balance(ctx, e, Number(today(ctx).slice(0, 4))) };
}
export async function summary(ctx: ModuleContext) {
  const d = today(ctx);
  const off = await whosOff(ctx, d, d);
  const approvals = (await listLeave(ctx, { scope: "approvals" })).data.length;
  const m = await mine(ctx);
  return { today: d, offToday: off.data.filter((x) => x.status === "approved"), holidayToday: off.holidays[0] ?? null, approvals, balance: m.balance };
}

export type { LeaveType };
