import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "@office/db";
import { moduleErrors as E, type ModuleContext, type Person } from "@office/sdk";
import {
  ALLOWANCE_KINDS, BASIS, CHECKLIST_KINDS, checklists, DOC_CATEGORIES, documents, EMPLOYMENT, employees, leave, LEAVE_KINDS, pay, tasks, TASK_OWNERS,
  templates, type LeaveKind, type TemplateItem,
} from "./schema.ts";

export const P = {
  READ: "hr:people.read",      // directory, org chart, own profile, own leave/documents/tasks
  MANAGE: "hr:people.manage",  // everyone's profiles, private details, leave, documents, checklists
  PAY: "hr:pay.manage",        // see and change pay
} as const;

// ───────── Helpers ─────────
const me = (ctx: ModuleContext) => ctx.actor.userId ?? null;
const canManage = (ctx: ModuleContext) => ctx.authz.can(P.MANAGE);
const canPay = (ctx: ModuleContext) => ctx.authz.can(P.PAY);
const isSelf = (ctx: ModuleContext, userId: string) => me(ctx) === userId;
export const todayIso = () => new Date().toISOString().slice(0, 10);
interface Settings { currency?: string; defaultAllowanceDays?: number; reminderDays?: number }
const settingsOf = (ctx: ModuleContext) => {
  const s = ctx.settings.get<Settings>();
  return { currency: s.currency ?? "EUR", defaultAllowanceDays: s.defaultAllowanceDays ?? 25, reminderDays: s.reminderDays ?? 30 };
};
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Working days (Mon–Fri) from start to end inclusive, split per calendar year. */
export function workingDaysByYear(start: string, end: string): Map<number, number> {
  const out = new Map<number, number>();
  const d = new Date(`${start}T00:00:00Z`), last = new Date(`${end}T00:00:00Z`);
  for (let i = 0; d <= last && i < 800; i++, d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const y = d.getUTCFullYear();
    out.set(y, (out.get(y) ?? 0) + 1);
  }
  return out;
}

async function peopleIndex(ctx: ModuleContext) {
  const people = await ctx.people.list();
  const byId = new Map(people.map((p) => [p.userId, p]));
  return { people, byId, name: (id: string | null | undefined) => (id ? byId.get(id)?.name ?? "Former member" : null) };
}
async function requireMember(ctx: ModuleContext, userId: string): Promise<Person> {
  const p = await ctx.people.get(userId);
  if (!p) throw E.notFound("Person");
  return p;
}
/** HR managers see everyone; others only themselves. */
function requireSelfOrManage(ctx: ModuleContext, userId: string) {
  if (!isSelf(ctx, userId) && !canManage(ctx)) throw E.forbidden("Only HR managers can see other people's details");
}

// ───────── Profiles & directory ─────────
type EmpRow = typeof employees.$inferSelect;
const EMPTY_ROW = (tenantId: string, userId: string): EmpRow => ({
  tenantId, userId, jobTitle: null, department: null, managerId: null, employmentType: null, weeklyHours: null, startDate: null, endDate: null,
  workPhone: null, birthDate: null, personalEmail: null, personalPhone: null, address: null, emergencyName: null, emergencyRelation: null,
  emergencyPhone: null, notes: null, allowanceDays: null, updatedAt: new Date(0),
});
const active = (e: EmpRow, today = todayIso()) => !e.endDate || e.endDate >= today;

function publicDto(p: Person, e: EmpRow, name: (id: string | null) => string | null) {
  return {
    userId: p.userId, name: p.name, email: p.email, roles: p.roles,
    jobTitle: e.jobTitle, department: e.department, managerId: e.managerId, managerName: name(e.managerId),
    employmentType: e.employmentType, startDate: e.startDate, endDate: e.endDate, workPhone: e.workPhone,
    birthday: e.birthDate ? e.birthDate.slice(5) : null, active: active(e),
  };
}

export const DirectoryQuery = z.object({
  q: z.string().trim().max(100).optional(), department: z.string().trim().max(80).optional(),
  includeFormer: z.enum(["true", "false"]).optional(),
});
export async function directory(ctx: ModuleContext, q: z.infer<typeof DirectoryQuery> = {}) {
  const { people, name } = await peopleIndex(ctx);
  const rows = await ctx.db.select().from(employees);
  const byUser = new Map(rows.map((r) => [r.userId, r]));
  const needle = q.q?.toLowerCase();
  return people
    .map((p) => publicDto(p, byUser.get(p.userId) ?? EMPTY_ROW(ctx.tenantId, p.userId), name))
    .filter((d) => q.includeFormer === "true" || d.active)
    .filter((d) => !q.department || d.department === q.department)
    .filter((d) => !needle || [d.name, d.email, d.jobTitle, d.department].some((v) => v?.toLowerCase().includes(needle)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getProfile(ctx: ModuleContext, userId: string) {
  const p = await requireMember(ctx, userId);
  const { name } = await peopleIndex(ctx);
  const [row] = await ctx.db.select().from(employees).where(eq(employees.userId, userId));
  const e = row ?? EMPTY_ROW(ctx.tenantId, userId);
  const priv = canManage(ctx) || isSelf(ctx, userId);
  const reports = await ctx.db.select({ userId: employees.userId }).from(employees).where(eq(employees.managerId, userId));
  const s = settingsOf(ctx);
  return {
    ...publicDto(p, e, name),
    directReports: reports.map((r) => ({ userId: r.userId, name: name(r.userId) })).filter((r) => r.name !== "Former member"),
    private: priv ? {
      birthDate: e.birthDate, personalEmail: e.personalEmail, personalPhone: e.personalPhone, address: e.address,
      emergencyName: e.emergencyName, emergencyRelation: e.emergencyRelation, emergencyPhone: e.emergencyPhone,
      weeklyHours: e.weeklyHours, allowanceDays: e.allowanceDays, effectiveAllowance: e.allowanceDays ?? s.defaultAllowanceDays,
      notes: canManage(ctx) ? e.notes : null,
    } : null,
    can: { edit: canManage(ctx), editOwn: isSelf(ctx, userId), seePay: canPay(ctx) || isSelf(ctx, userId), editPay: canPay(ctx), seePrivate: priv },
  };
}

const opt = (max: number) => z.string().trim().max(max).nullish();
const day = z.iso.date("Use a date like 2026-03-31").nullish();
const SELF_FIELDS = ["personalEmail", "personalPhone", "address", "emergencyName", "emergencyRelation", "emergencyPhone"] as const;
export const ProfilePatch = z.object({
  jobTitle: opt(120), department: opt(80), managerId: z.uuid().nullish(), employmentType: z.enum(EMPLOYMENT).nullish(),
  weeklyHours: z.number().min(0).max(168).nullish(), startDate: day, endDate: day, workPhone: opt(40), birthDate: day,
  personalEmail: z.union([z.literal(""), z.string().trim().max(320).email("Use a valid email address")]).nullish(),
  personalPhone: opt(40), address: opt(500), emergencyName: opt(200), emergencyRelation: opt(80), emergencyPhone: opt(40),
  notes: opt(5000), allowanceDays: z.number().min(0, "At least 0 days").max(366).multipleOf(0.5, "Use whole or half days").nullish(),
}).strict();

export async function updateProfile(ctx: ModuleContext, userId: string, patch: z.infer<typeof ProfilePatch>) {
  await requireMember(ctx, userId);
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!canManage(ctx)) {
    if (!isSelf(ctx, userId)) throw E.forbidden("Only HR managers can change other people's profiles");
    const bad = keys.filter((k) => !(SELF_FIELDS as readonly string[]).includes(k));
    if (bad.length) throw E.forbidden("You can change your own contact details and emergency contact; ask HR for the rest");
  }
  if (patch.managerId) {
    if (patch.managerId === userId) throw E.badRequest("Someone can't be their own manager");
    await requireMember(ctx, patch.managerId).catch(() => { throw E.badRequest("The manager must be a member of this workspace"); });
    // No loops: walk up from the new manager.
    const all = await ctx.db.select({ userId: employees.userId, managerId: employees.managerId }).from(employees);
    const up = new Map(all.map((r) => [r.userId, r.managerId]));
    let cur: string | null | undefined = patch.managerId;
    for (let i = 0; cur && i < 500; i++) {
      if (cur === userId) throw E.badRequest("That would make a loop: this person is already above the new manager");
      cur = up.get(cur);
    }
  }
  const [existing] = await ctx.db.select().from(employees).where(eq(employees.userId, userId));
  const merged = { ...(existing ?? EMPTY_ROW(ctx.tenantId, userId)), ...Object.fromEntries(keys.map((k) => [k, patch[k] === "" ? null : patch[k] ?? null])) } as EmpRow;
  if (merged.startDate && merged.endDate && merged.endDate < merged.startDate) throw E.badRequest("The last day can't be before the start date");
  const values = { ...merged, tenantId: ctx.tenantId, userId, updatedAt: new Date() };
  await ctx.db.insert(employees).values(values).onConflictDoUpdate({ target: [employees.tenantId, employees.userId], set: values });
  const changed = keys.filter((k) => (existing?.[k] ?? null) !== (merged[k] ?? null));
  if (changed.length) {
    await ctx.events.emit("hr.employee.updated", { userId, changes: changed });
    await ctx.audit.log("employee.updated", { type: "employee", id: userId }, { changes: changed });
  }
  return getProfile(ctx, userId);
}

export async function departments(ctx: ModuleContext) {
  const rows = await ctx.db.selectDistinct({ d: employees.department }).from(employees).where(sql`${employees.department} IS NOT NULL`).orderBy(asc(employees.department));
  return rows.map((r) => r.d!);
}

// ───────── Pay ─────────
export const PayInput = z.object({
  effectiveFrom: z.iso.date("Use a date like 2026-03-31"), basis: z.enum(BASIS),
  amountCents: z.number().int("Whole cents").min(1, "Enter an amount above 0").max(99_999_999_999),
  currency: z.string().regex(/^[A-Z]{3}$/, "Use a three-letter currency like EUR").optional(),
  note: opt(500),
}).strict();
const payDto = (r: typeof pay.$inferSelect, name: (id: string | null) => string | null) => ({
  id: r.id, effectiveFrom: r.effectiveFrom, basis: r.basis, amountCents: r.amountCents, currency: r.currency, note: r.note, createdByName: name(r.createdBy), createdAt: r.createdAt,
});
export async function listPay(ctx: ModuleContext, userId: string) {
  if (!canPay(ctx) && !isSelf(ctx, userId)) throw E.forbidden("Only people with the HR pay permission can see pay");
  await requireMember(ctx, userId);
  const { name } = await peopleIndex(ctx);
  const rows = await ctx.db.select().from(pay).where(eq(pay.userId, userId)).orderBy(desc(pay.effectiveFrom));
  const today = todayIso();
  const current = rows.find((r) => r.effectiveFrom <= today) ?? null;
  return { current: current ? payDto(current, name) : null, history: rows.map((r) => payDto(r, name)) };
}
export async function addPay(ctx: ModuleContext, userId: string, input: z.infer<typeof PayInput>) {
  await requireMember(ctx, userId);
  const [dup] = await ctx.db.select({ id: pay.id }).from(pay).where(and(eq(pay.userId, userId), eq(pay.effectiveFrom, input.effectiveFrom)));
  if (dup) throw E.conflict("There is already a pay change on that date. Delete it first or pick another date.");
  await ctx.db.insert(pay).values({ id: uuidv7(), tenantId: ctx.tenantId, userId, ...input, currency: input.currency ?? settingsOf(ctx).currency, createdBy: me(ctx) });
  // Workflows and webhooks only learn that pay changed, never the amount.
  await ctx.events.emit("hr.pay.changed", { userId, effectiveFrom: input.effectiveFrom });
  await ctx.audit.log("pay.added", { type: "employee", id: userId }, { effectiveFrom: input.effectiveFrom, basis: input.basis });
  return listPay(ctx, userId);
}
export async function deletePay(ctx: ModuleContext, id: string) {
  const [r] = await ctx.db.delete(pay).where(eq(pay.id, id)).returning();
  if (!r) throw E.notFound("Pay change");
  await ctx.audit.log("pay.deleted", { type: "employee", id: r.userId }, { effectiveFrom: r.effectiveFrom });
}

// ───────── Leave ─────────
type LeaveRow = typeof leave.$inferSelect;
function summarize(rows: LeaveRow[], allowance: number, today = todayIso()) {
  const sum = (f: (r: LeaveRow) => boolean) => round1(rows.filter(f).reduce((a, r) => a + r.days, 0));
  const adjustments = sum((r) => (ALLOWANCE_KINDS as readonly string[]).includes(r.kind));
  const vacation = sum((r) => r.kind === "vacation");
  const upcoming = sum((r) => r.kind === "vacation" && !!r.startDate && r.startDate > today);
  return {
    allowance, adjustments, total: round1(allowance + adjustments), vacationTaken: round1(vacation - upcoming), vacationBooked: upcoming,
    remaining: round1(allowance + adjustments - vacation), sick: sum((r) => r.kind === "sick"), other: sum((r) => r.kind === "personal" || r.kind === "other"),
  };
}
const leaveDto = (r: LeaveRow, name: (id: string | null) => string | null) => ({
  id: r.id, year: r.year, kind: r.kind, days: r.days, startDate: r.startDate, endDate: r.endDate, source: r.source, note: r.note,
  createdByName: name(r.createdBy), createdAt: r.createdAt,
});
const yearOf = (y?: number) => y ?? new Date().getUTCFullYear();

export async function personLeave(ctx: ModuleContext, userId: string, year?: number) {
  requireSelfOrManage(ctx, userId);
  await requireMember(ctx, userId);
  const y = yearOf(year);
  const [e] = await ctx.db.select({ allowanceDays: employees.allowanceDays }).from(employees).where(eq(employees.userId, userId));
  const rows = await ctx.db.select().from(leave).where(and(eq(leave.userId, userId), eq(leave.year, y))).orderBy(desc(leave.startDate), desc(leave.createdAt));
  const { name } = await peopleIndex(ctx);
  return { year: y, ...summarize(rows, e?.allowanceDays ?? settingsOf(ctx).defaultAllowanceDays), entries: rows.map((r) => leaveDto(r, name)) };
}

export async function leaveOverview(ctx: ModuleContext, year?: number) {
  const y = yearOf(year);
  const { people } = await peopleIndex(ctx);
  const visible = canManage(ctx) ? people : people.filter((p) => p.userId === me(ctx));
  const emps = await ctx.db.select({ userId: employees.userId, allowanceDays: employees.allowanceDays, endDate: employees.endDate, department: employees.department }).from(employees);
  const rows = await ctx.db.select().from(leave).where(eq(leave.year, y));
  const def = settingsOf(ctx).defaultAllowanceDays;
  return {
    year: y,
    data: visible
      .map((p) => {
        const e = emps.find((x) => x.userId === p.userId);
        return { userId: p.userId, name: p.name, department: e?.department ?? null, ...summarize(rows.filter((r) => r.userId === p.userId), e?.allowanceDays ?? def) };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export const LeaveInput = z.object({
  kind: z.enum([...LEAVE_KINDS, ...ALLOWANCE_KINDS]),
  days: z.number().min(-366).max(366).multipleOf(0.5, "Use whole or half days").refine((d) => d !== 0, "Enter a number of days"),
  year: z.number().int().min(2000).max(2100).optional(),
  startDate: day, endDate: day, note: opt(500),
}).strict();
export async function addLeave(ctx: ModuleContext, userId: string, input: z.infer<typeof LeaveInput>) {
  await requireMember(ctx, userId);
  const away = (LEAVE_KINDS as readonly string[]).includes(input.kind);
  if (away && input.days < 0) throw E.badRequest("Days away must be a positive number; use an adjustment to take days off the allowance");
  if (input.startDate && input.endDate && input.endDate < input.startDate) throw E.badRequest("The last day can't be before the first day");
  const year = input.year ?? (input.startDate ? Number(input.startDate.slice(0, 4)) : yearOf());
  await ctx.db.insert(leave).values({
    id: uuidv7(), tenantId: ctx.tenantId, userId, year, kind: input.kind, days: input.days,
    startDate: input.startDate ?? null, endDate: input.endDate ?? input.startDate ?? null, source: "manual", note: input.note ?? null, createdBy: me(ctx),
  });
  await ctx.audit.log("leave.added", { type: "employee", id: userId }, { kind: input.kind, days: input.days, year });
  return personLeave(ctx, userId, year);
}
export async function deleteLeave(ctx: ModuleContext, id: string) {
  const [r] = await ctx.db.select().from(leave).where(eq(leave.id, id));
  if (!r) throw E.notFound("Leave entry");
  if (r.source === "schedule") throw E.conflict("This comes from approved time off in Schedule. Cancel it there instead.");
  await ctx.db.delete(leave).where(eq(leave.id, id));
  await ctx.audit.log("leave.deleted", { type: "employee", id: r.userId }, { kind: r.kind, days: r.days, year: r.year });
}

/** Approved time off in the Schedule module becomes leave entries (working days, split per year). */
interface TimeOffPayload { id: string; employeeId: string; kind: LeaveKind; startDate: string; endDate: string }
export async function onTimeOffApproved(ctx: ModuleContext, p: TimeOffPayload) {
  if (!(LEAVE_KINDS as readonly string[]).includes(p.kind)) return;
  for (const [year, days] of workingDaysByYear(p.startDate, p.endDate)) {
    const startDate = p.startDate.slice(0, 4) === String(year) ? p.startDate : `${year}-01-01`;
    const endDate = p.endDate.slice(0, 4) === String(year) ? p.endDate : `${year}-12-31`;
    await ctx.db.insert(leave).values({ id: uuidv7(), tenantId: ctx.tenantId, userId: p.employeeId, year, kind: p.kind, days, startDate, endDate, source: "schedule", refId: p.id })
      .onConflictDoNothing();
  }
}
export async function onTimeOffCancelled(ctx: ModuleContext, p: { id: string }) {
  await ctx.db.delete(leave).where(and(eq(leave.refId, p.id), eq(leave.source, "schedule")));
}

// ───────── Documents ─────────
const MAX_DOC = 7 * 1024 * 1024;
const TYPES = {
  "application/pdf": (b: Buffer) => b.subarray(0, 5).toString("latin1") === "%PDF-",
  "image/jpeg": (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (b: Buffer) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (b: Buffer) => b[0] === 0x50 && b[1] === 0x4b,
} as const;
export const DocumentInput = z.object({
  name: z.string().trim().min(1, "Name the document").max(200), category: z.enum(DOC_CATEGORIES),
  contentType: z.enum(Object.keys(TYPES) as [keyof typeof TYPES], { message: "Upload a PDF, a photo (JPG, PNG, WEBP) or a Word file" }),
  data: z.string().min(1).max(9_800_000, "Files can be at most 7 MB"), expiresOn: day,
}).strict();
export const DocumentPatch = z.object({ name: z.string().trim().min(1).max(200).optional(), category: z.enum(DOC_CATEGORIES).optional(), expiresOn: day }).strict();

const docDto = (d: Omit<typeof documents.$inferSelect, "data">, name: (id: string | null) => string | null, today = todayIso(), soon = addDays(today, 30)) => ({
  id: d.id, userId: d.userId, name: d.name, category: d.category, contentType: d.contentType, sizeBytes: d.sizeBytes, expiresOn: d.expiresOn,
  expired: !!d.expiresOn && d.expiresOn < today, expiringSoon: !!d.expiresOn && d.expiresOn >= today && d.expiresOn <= soon,
  uploadedByName: name(d.uploadedBy), createdAt: d.createdAt, source: d.source, refId: d.refId,
});
const DOC_COLS = {
  id: documents.id, tenantId: documents.tenantId, userId: documents.userId, name: documents.name, category: documents.category, contentType: documents.contentType,
  sizeBytes: documents.sizeBytes, expiresOn: documents.expiresOn, remindedAt: documents.remindedAt, uploadedBy: documents.uploadedBy, createdAt: documents.createdAt,
  source: documents.source, refId: documents.refId,
};
export async function listDocuments(ctx: ModuleContext, userId: string) {
  requireSelfOrManage(ctx, userId);
  const { name } = await peopleIndex(ctx);
  const rows = await ctx.db.select(DOC_COLS).from(documents).where(eq(documents.userId, userId)).orderBy(asc(documents.category), asc(documents.name));
  return rows.map((d) => docDto(d, name, todayIso(), addDays(todayIso(), settingsOf(ctx).reminderDays)));
}
export async function uploadDocument(ctx: ModuleContext, userId: string, input: z.infer<typeof DocumentInput>) {
  await requireMember(ctx, userId);
  const data = Buffer.from(input.data, "base64");
  if (!data.length) throw E.badRequest("The file is empty");
  if (data.length > MAX_DOC) throw E.badRequest("Files can be at most 7 MB");
  if (!TYPES[input.contentType](data)) throw E.badRequest("The file content does not match its type");
  const id = uuidv7();
  await ctx.db.insert(documents).values({ id, tenantId: ctx.tenantId, userId, name: input.name, category: input.category, contentType: input.contentType, sizeBytes: data.length, data, expiresOn: input.expiresOn ?? null, uploadedBy: me(ctx) });
  await ctx.audit.log("document.uploaded", { type: "employee", id: userId }, { name: input.name, category: input.category });
  return (await listDocuments(ctx, userId)).find((d) => d.id === id)!;
}
async function loadDoc(ctx: ModuleContext, id: string) {
  const [d] = await ctx.db.select(DOC_COLS).from(documents).where(eq(documents.id, id));
  if (!d) throw E.notFound("Document");
  return d;
}
export async function downloadDocument(ctx: ModuleContext, id: string) {
  const d = await loadDoc(ctx, id);
  if (!canManage(ctx) && !isSelf(ctx, d.userId)) throw E.notFound("Document");
  if (d.source === "docs") return { id, name: d.name, contentType: d.contentType, data: null, docsId: d.refId };
  const [f] = await ctx.db.select({ data: documents.data }).from(documents).where(eq(documents.id, id));
  return { id, name: d.name, contentType: d.contentType, data: f!.data!.toString("base64"), docsId: null };
}

/** Docs & e-sign finished a document about a team member: list it with their documents (as a link to Docs). */
export async function onDocsCompleted(ctx: ModuleContext, e: { documentId: string; title: string; sizeBytes: number; employeeId?: string | null }) {
  if (!e.employeeId || !(await ctx.people.get(e.employeeId))) return;
  await ctx.db.insert(documents).values({
    id: uuidv7(), tenantId: ctx.tenantId, userId: e.employeeId, name: `${e.title} (signed)`.slice(0, 200), category: "contract",
    contentType: "application/pdf", sizeBytes: Math.max(1, Math.min(e.sizeBytes || 1, 10485760)), data: null, source: "docs", refId: e.documentId,
  }).onConflictDoNothing();
  await ctx.audit.log("document.linked", { type: "employee", id: e.employeeId }, { name: e.title, from: "docs" });
}
export async function updateDocument(ctx: ModuleContext, id: string, patch: z.infer<typeof DocumentPatch>) {
  const d = await loadDoc(ctx, id);
  await ctx.db.update(documents).set({
    ...(patch.name ? { name: patch.name } : {}), ...(patch.category ? { category: patch.category } : {}),
    ...(patch.expiresOn !== undefined ? { expiresOn: patch.expiresOn ?? null, remindedAt: null } : {}),
  }).where(eq(documents.id, id));
  return (await listDocuments(ctx, d.userId)).find((x) => x.id === id)!;
}
export async function deleteDocument(ctx: ModuleContext, id: string) {
  const d = await loadDoc(ctx, id);
  await ctx.db.delete(documents).where(eq(documents.id, id));
  await ctx.audit.log("document.deleted", { type: "employee", id: d.userId }, { name: d.name });
}
export async function expiringDocuments(ctx: ModuleContext) {
  const limit = addDays(todayIso(), settingsOf(ctx).reminderDays);
  const rows = await ctx.db.select(DOC_COLS).from(documents).where(lte(documents.expiresOn, limit)).orderBy(asc(documents.expiresOn));
  const { name } = await peopleIndex(ctx);
  return rows.map((d) => ({ ...docDto(d, name, todayIso(), limit), personName: name(d.userId) }));
}
/** Daily-ish job: one reminder event per document as its expiry comes close (again after the date changes). */
export async function remindExpiring(ctx: ModuleContext) {
  const limit = addDays(todayIso(), settingsOf(ctx).reminderDays);
  const due = await ctx.db.select(DOC_COLS).from(documents).where(and(lte(documents.expiresOn, limit), isNull(documents.remindedAt))).limit(200);
  if (!due.length) return;
  const { name } = await peopleIndex(ctx);
  for (const d of due) {
    await ctx.events.emit("hr.document.expiring", { documentId: d.id, userId: d.userId, personName: name(d.userId), name: d.name, category: d.category, expiresOn: d.expiresOn });
  }
  await ctx.db.update(documents).set({ remindedAt: new Date() }).where(inArray(documents.id, due.map((d) => d.id)));
}

// ───────── Checklist templates ─────────
const ItemSchema = z.object({
  title: z.string().trim().min(1, "Every task needs a title").max(200), owner: z.enum(TASK_OWNERS), dueDays: z.number().int().min(-365).max(365),
}).strict();
export const TemplateInput = z.object({
  name: z.string().trim().min(1, "Name the checklist").max(80), kind: z.enum(CHECKLIST_KINDS),
  items: z.array(ItemSchema).min(1, "Add at least one task").max(100),
}).strict();
const templateDto = (t: typeof templates.$inferSelect) => ({ id: t.id, name: t.name, kind: t.kind, items: t.items, updatedAt: t.updatedAt });
export const listTemplates = async (ctx: ModuleContext) =>
  (await ctx.db.select().from(templates).orderBy(asc(templates.kind), asc(sql`lower(${templates.name})`))).map(templateDto);
async function uniqueTemplate(ctx: ModuleContext, name: string, ignore?: string) {
  const [d] = await ctx.db.select({ id: templates.id }).from(templates).where(sql`lower(${templates.name}) = lower(${name})`);
  if (d && d.id !== ignore) throw E.conflict(`There is already a checklist called “${name}”`);
}
export async function createTemplate(ctx: ModuleContext, input: z.infer<typeof TemplateInput>) {
  await uniqueTemplate(ctx, input.name);
  const [t] = await ctx.db.insert(templates).values({ id: uuidv7(), tenantId: ctx.tenantId, ...input }).returning();
  return templateDto(t!);
}
export async function updateTemplate(ctx: ModuleContext, id: string, input: z.infer<typeof TemplateInput>) {
  await uniqueTemplate(ctx, input.name, id);
  const [t] = await ctx.db.update(templates).set({ ...input, updatedAt: new Date() }).where(eq(templates.id, id)).returning();
  if (!t) throw E.notFound("Checklist template");
  return templateDto(t);
}
export async function deleteTemplate(ctx: ModuleContext, id: string) {
  const r = await ctx.db.delete(templates).where(eq(templates.id, id)).returning({ id: templates.id });
  if (!r.length) throw E.notFound("Checklist template");
}

// ───────── Checklists ─────────
export const ChecklistInput = z.object({
  templateId: z.uuid().optional(), name: z.string().trim().min(1).max(80).optional(), kind: z.enum(CHECKLIST_KINDS).optional(),
  startDate: z.iso.date("Use a date like 2026-03-31"), items: z.array(ItemSchema).max(100).optional(),
}).strict();
type ChecklistRow = typeof checklists.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;
function checklistDto(c: ChecklistRow, ts: TaskRow[], name: (id: string | null) => string | null, today = todayIso()) {
  const mine = ts.filter((t) => t.checklistId === c.id).sort((a, b) => a.position - b.position);
  return {
    id: c.id, userId: c.userId, personName: name(c.userId), name: c.name, kind: c.kind, startDate: c.startDate, completedAt: c.completedAt, createdAt: c.createdAt,
    done: mine.filter((t) => t.doneAt).length, total: mine.length,
    tasks: mine.map((t) => ({
      id: t.id, title: t.title, ownerId: t.ownerId, ownerName: name(t.ownerId), dueDate: t.dueDate, doneAt: t.doneAt, doneByName: name(t.doneBy),
      overdue: !t.doneAt && !!t.dueDate && t.dueDate < today,
    })),
  };
}
export async function assignChecklist(ctx: ModuleContext, userId: string, input: z.infer<typeof ChecklistInput>) {
  await requireMember(ctx, userId);
  let name = input.name, kind = input.kind, items: TemplateItem[] | undefined = input.items;
  if (input.templateId) {
    const [t] = await ctx.db.select().from(templates).where(eq(templates.id, input.templateId));
    if (!t) throw E.notFound("Checklist template");
    name ??= t.name; kind ??= t.kind; items ??= t.items;
  }
  if (!name || !kind || !items?.length) throw E.badRequest("Choose a checklist template, or give a name, kind and tasks");
  const [emp] = await ctx.db.select({ managerId: employees.managerId }).from(employees).where(eq(employees.userId, userId));
  const owner = (o: TemplateItem["owner"]) => (o === "employee" ? userId : o === "manager" ? emp?.managerId ?? me(ctx) : me(ctx));
  const id = uuidv7();
  await ctx.db.insert(checklists).values({ id, tenantId: ctx.tenantId, userId, name, kind, startDate: input.startDate, createdBy: me(ctx) });
  await ctx.db.insert(tasks).values(items.map((it, i) => ({
    id: uuidv7(), tenantId: ctx.tenantId, checklistId: id, position: i, title: it.title, ownerId: owner(it.owner), dueDate: addDays(input.startDate, it.dueDays),
  })));
  await ctx.events.emit("hr.checklist.assigned", { checklistId: id, userId, name, kind, startDate: input.startDate });
  await ctx.audit.log("checklist.assigned", { type: "employee", id: userId }, { name, kind });
  return getChecklist(ctx, id);
}
async function loadChecklist(ctx: ModuleContext, id: string) {
  const [c] = await ctx.db.select().from(checklists).where(eq(checklists.id, id));
  if (!c) throw E.notFound("Checklist");
  return c;
}
async function canSeeChecklist(ctx: ModuleContext, c: ChecklistRow) {
  if (canManage(ctx) || isSelf(ctx, c.userId)) return true;
  const uid = me(ctx);
  if (!uid) return false;
  const [t] = await ctx.db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.checklistId, c.id), eq(tasks.ownerId, uid))).limit(1);
  return !!t;
}
export async function getChecklist(ctx: ModuleContext, id: string) {
  const c = await loadChecklist(ctx, id);
  if (!(await canSeeChecklist(ctx, c))) throw E.notFound("Checklist");
  const ts = await ctx.db.select().from(tasks).where(eq(tasks.checklistId, id));
  return checklistDto(c, ts, (await peopleIndex(ctx)).name);
}
export const ChecklistQuery = z.object({ status: z.enum(["active", "done", "all"]).default("active"), userId: z.uuid().optional() });
export async function listChecklists(ctx: ModuleContext, q: z.infer<typeof ChecklistQuery>) {
  const uid = me(ctx);
  const conds = [
    q.status === "active" ? isNull(checklists.completedAt) : q.status === "done" ? sql`${checklists.completedAt} IS NOT NULL` : undefined,
    q.userId ? eq(checklists.userId, q.userId) : undefined,
    canManage(ctx) ? undefined
      : sql`(${checklists.userId} = ${uid} OR EXISTS (SELECT 1 FROM hr_tasks t WHERE t.checklist_id = ${checklists.id} AND t.owner_id = ${uid}))`,
  ];
  const cs = await ctx.db.select().from(checklists).where(and(...conds)).orderBy(desc(checklists.startDate)).limit(200);
  const ts = cs.length ? await ctx.db.select().from(tasks).where(inArray(tasks.checklistId, cs.map((c) => c.id))) : [];
  const { name } = await peopleIndex(ctx);
  return cs.map((c) => checklistDto(c, ts, name));
}
export async function deleteChecklist(ctx: ModuleContext, id: string) {
  const c = await loadChecklist(ctx, id);
  await ctx.db.delete(checklists).where(eq(checklists.id, id));
  await ctx.audit.log("checklist.deleted", { type: "employee", id: c.userId }, { name: c.name });
}
export const TaskPatch = z.object({ done: z.boolean().optional(), ownerId: z.uuid().nullable().optional(), dueDate: day.optional() }).strict();
export async function updateTask(ctx: ModuleContext, id: string, patch: z.infer<typeof TaskPatch>) {
  const [t] = await ctx.db.select().from(tasks).where(eq(tasks.id, id));
  if (!t) throw E.notFound("Task");
  const c = await loadChecklist(ctx, t.checklistId);
  const manage = canManage(ctx);
  if (!manage) {
    if (!(await canSeeChecklist(ctx, c))) throw E.notFound("Task");
    if (patch.ownerId !== undefined || patch.dueDate !== undefined) throw E.forbidden("Only HR managers can reassign tasks or change due dates");
    if (t.ownerId !== me(ctx)) throw E.forbidden("Only the person this task is for (or HR) can tick it off");
  }
  if (patch.ownerId) await requireMember(ctx, patch.ownerId).catch(() => { throw E.badRequest("That person isn't a member of this workspace"); });
  await ctx.db.update(tasks).set({
    ...(patch.done !== undefined ? { doneAt: patch.done ? (t.doneAt ?? new Date()) : null, doneBy: patch.done ? (t.doneBy ?? me(ctx)) : null } : {}),
    ...(patch.ownerId !== undefined ? { ownerId: patch.ownerId } : {}),
    ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate ?? null } : {}),
  }).where(eq(tasks.id, id));
  // Complete (or reopen) the checklist with its last task.
  const all = await ctx.db.select({ doneAt: tasks.doneAt }).from(tasks).where(eq(tasks.checklistId, c.id));
  const finished = all.every((x) => x.doneAt);
  if (finished && !c.completedAt) {
    await ctx.db.update(checklists).set({ completedAt: new Date() }).where(eq(checklists.id, c.id));
    await ctx.events.emit("hr.checklist.completed", { checklistId: c.id, userId: c.userId, name: c.name, kind: c.kind });
  } else if (!finished && c.completedAt) {
    await ctx.db.update(checklists).set({ completedAt: null }).where(eq(checklists.id, c.id));
  }
  return getChecklist(ctx, c.id);
}
export async function myTasks(ctx: ModuleContext) {
  const uid = me(ctx);
  if (!uid) return [];
  const rows = await ctx.db.select({ t: tasks, c: checklists }).from(tasks).innerJoin(checklists, eq(checklists.id, tasks.checklistId))
    .where(and(eq(tasks.ownerId, uid), isNull(tasks.doneAt))).orderBy(asc(tasks.dueDate)).limit(100);
  const { name } = await peopleIndex(ctx);
  const today = todayIso();
  return rows.map(({ t, c }) => ({
    id: t.id, title: t.title, dueDate: t.dueDate, overdue: !!t.dueDate && t.dueDate < today,
    checklistId: c.id, checklistName: c.name, personId: c.userId, personName: name(c.userId),
  }));
}

// ───────── Config & dashboard ─────────
export async function config(ctx: ModuleContext) {
  const s = settingsOf(ctx);
  return { me: me(ctx), canManage: canManage(ctx), canPay: canPay(ctx), currency: s.currency, defaultAllowanceDays: s.defaultAllowanceDays, departments: await departments(ctx) };
}

/** Next occurrence of a month-day on or after `from` (Feb 29 falls on Mar 1 in other years). */
function nextOccurrence(md: string, from: string) {
  const y = Number(from.slice(0, 4));
  for (const year of [y, y + 1]) {
    let d = `${year}-${md}`;
    if (md === "02-29" && new Date(`${year}-02-29T00:00:00Z`).getUTCMonth() !== 1) d = `${year}-03-01`;
    if (d >= from) return d;
  }
  return `${y + 1}-${md}`;
}
export async function summary(ctx: ModuleContext) {
  const today = todayIso(), until = addDays(today, 14);
  const { people } = await peopleIndex(ctx);
  const emps = await ctx.db.select().from(employees);
  const celebrations: { userId: string; name: string; kind: "birthday" | "anniversary"; date: string; years?: number }[] = [];
  for (const p of people) {
    const e = emps.find((x) => x.userId === p.userId);
    if (!e || !active(e, today)) continue;
    if (e.birthDate) {
      const d = nextOccurrence(e.birthDate.slice(5), today);
      if (d <= until) celebrations.push({ userId: p.userId, name: p.name, kind: "birthday", date: d });
    }
    if (e.startDate && e.startDate < today) {
      const d = nextOccurrence(e.startDate.slice(5), today);
      const years = Number(d.slice(0, 4)) - Number(e.startDate.slice(0, 4));
      if (d <= until && years > 0) celebrations.push({ userId: p.userId, name: p.name, kind: "anniversary", date: d, years });
    }
  }
  celebrations.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const away = await ctx.db.select({ userId: leave.userId, kind: leave.kind, endDate: leave.endDate }).from(leave)
    .where(and(inArray(leave.kind, [...LEAVE_KINDS]), lte(leave.startDate, today), sql`${leave.endDate} >= ${today}`));
  const awayToday = [...new Map(away.map((a) => [a.userId, a])).values()]
    .map((a) => ({ userId: a.userId, name: people.find((p) => p.userId === a.userId)?.name ?? "Former member", kind: a.kind, until: a.endDate }));
  return {
    celebrations, awayToday,
    myOpenTasks: (await myTasks(ctx)).length,
    expiringDocuments: canManage(ctx) ? (await expiringDocuments(ctx)).length : null,
    activeChecklists: canManage(ctx) ? (await ctx.db.select({ n: sql<number>`count(*)::int` }).from(checklists).where(isNull(checklists.completedAt)))[0]!.n : null,
  };
}
