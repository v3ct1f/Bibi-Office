import { and, asc, desc, eq, gte, inArray, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "@office/db";
import { moduleErrors as E, type ModuleContext } from "@office/sdk";
import { categories, expenses, type ExpenseStatus } from "./schema.ts";

export const P = {
  submit: "expenses:expense.submit", readAll: "expenses:expense.read_all", approve: "expenses:expense.approve",
  reimburse: "expenses:expense.reimburse", categories: "expenses:category.manage",
} as const;

// ───────────────────────── settings ─────────────────────────
export interface ExpenseSettings { currency: string; receiptRequiredOver: number; allowSelfApproval: boolean }
export const SETTINGS_SCHEMA = {
  type: "object",
  properties: {
    currency: { type: "string", title: "Default currency", default: "EUR", pattern: "^[A-Z]{3}$" },
    receiptRequiredOver: {
      type: "integer", title: "Receipt required above (minor units, e.g. 2500 = 25.00; 0 = always)", default: 2500, minimum: 0,
    },
    allowSelfApproval: { type: "boolean", title: "Allow approvers to approve their own expenses (one-person teams)", default: false },
  },
  additionalProperties: false,
} as const;
export const settingsOf = (ctx: ModuleContext): ExpenseSettings =>
  ({ currency: "EUR", receiptRequiredOver: 2500, allowSelfApproval: false, ...ctx.settings.get<Partial<ExpenseSettings>>() });

export const DEFAULT_CATEGORIES = ["Travel", "Lodging", "Meals", "Office supplies", "Software", "Other"];

// ───────────────────────── input schemas ─────────────────────────
const money = z.number().int().min(0).max(1e12).describe("minor units, e.g. cents");
export const CategoryIn = z.object({ name: z.string().trim().min(1).max(80), code: z.string().trim().max(40).nullish() });
export const CategoryPatch = CategoryIn.partial().extend({ archived: z.boolean().optional(), position: z.number().int().min(0).max(1000).optional() });
export const ExpenseIn = z.object({
  spentOn: z.iso.date(),
  merchant: z.string().trim().min(1).max(200),
  categoryId: z.uuid().nullish(),
  amount: money,
  tax: money.default(0),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  description: z.string().max(2000).nullish(),
}).refine((x) => x.tax <= x.amount, { message: "Tax cannot exceed the amount", path: ["tax"] });
export const ExpensePatch = z.object({
  spentOn: z.iso.date().optional(), merchant: z.string().trim().min(1).max(200).optional(), categoryId: z.uuid().nullish(),
  amount: money.optional(), tax: money.optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(), description: z.string().max(2000).nullish(),
});
export const ExpenseQuery = z.object({
  status: z.enum(["draft", "submitted", "approved", "rejected", "reimbursed"]).optional(),
  mine: z.enum(["true", "false"]).optional(),
  submitterId: z.uuid().optional(), categoryId: z.uuid().optional(),
  from: z.iso.date().optional(), to: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
});
export const ExportQuery = z.object({
  from: z.iso.date().optional(), to: z.iso.date().optional(),
  status: z.enum(["approved", "reimbursed", "all_decided"]).default("all_decided"),
});

type Row = typeof expenses.$inferSelect;

// ───────────────────────── access ─────────────────────────
const me = (ctx: ModuleContext) => ctx.actor.userId;
/** Approvers and finance see everyone's expenses; everyone else only their own. */
export const seesAll = (ctx: ModuleContext) => ctx.authz.can(P.readAll) || ctx.authz.can(P.approve) || ctx.authz.can(P.reimburse);
const visible = (ctx: ModuleContext): SQL | undefined => (seesAll(ctx) ? undefined : eq(expenses.submitterId, me(ctx) ?? "00000000-0000-0000-0000-000000000000"));

async function load(ctx: ModuleContext, id: string, forUpdate = false) {
  const q = ctx.db.select().from(expenses).where(and(eq(expenses.id, id), visible(ctx)));
  const [r] = forUpdate ? await q.for("update") : await q;
  if (!r) throw E.notFound("Expense");
  return r;
}
/** Only the submitter edits, and only while the expense is a draft or was rejected. */
async function loadOwnEditable(ctx: ModuleContext, id: string) {
  const r = await load(ctx, id, true);
  if (r.submitterId !== me(ctx)) throw E.forbidden("Only the person who created this expense can change it");
  if (r.status !== "draft" && r.status !== "rejected") throw E.conflict(`Expense is ${r.status}; it can no longer be changed`);
  return r;
}

// ───────────────────────── categories ─────────────────────────
export async function seedCategories(ctx: ModuleContext) {
  const [one] = await ctx.db.select({ id: categories.id }).from(categories).limit(1);
  if (one) return;
  await ctx.db.insert(categories).values(DEFAULT_CATEGORIES.map((name, i) => ({ id: uuidv7(), tenantId: ctx.tenantId, name, position: i, archived: false })));
}
export const listCategories = (ctx: ModuleContext, includeArchived = false) =>
  ctx.db.select().from(categories).where(includeArchived ? undefined : eq(categories.archived, false)).orderBy(asc(categories.position), asc(categories.name));

const uniqueName = async <T,>(fn: () => Promise<T>) => {
  try { return await fn(); } catch (e) {
    if ((e as { code?: string; cause?: { code?: string } }).code === "23505" || (e as { cause?: { code?: string } }).cause?.code === "23505") throw E.conflict("A category with this name exists");
    throw e;
  }
};
export async function createCategory(ctx: ModuleContext, i: z.infer<typeof CategoryIn>) {
  const [{ n }] = await ctx.db.select({ n: sql<number>`coalesce(max(${categories.position}) + 1, 0)::int` }).from(categories) as [{ n: number }];
  const [r] = await uniqueName(() => ctx.db.insert(categories).values({ id: uuidv7(), tenantId: ctx.tenantId, name: i.name, code: i.code ?? null, position: n, archived: false }).returning());
  await ctx.audit.log("category.created", { type: "expenses.category", id: r!.id }, { name: i.name });
  return r!;
}
export async function updateCategory(ctx: ModuleContext, id: string, i: z.infer<typeof CategoryPatch>) {
  const [r] = await uniqueName(() => ctx.db.update(categories).set({
    ...(i.name !== undefined ? { name: i.name } : {}), ...(i.code !== undefined ? { code: i.code ?? null } : {}),
    ...(i.archived !== undefined ? { archived: i.archived } : {}), ...(i.position !== undefined ? { position: i.position } : {}),
  }).where(eq(categories.id, id)).returning());
  if (!r) throw E.notFound("Category");
  await ctx.audit.log("category.updated", { type: "expenses.category", id }, i);
  return r;
}
async function activeCategory(ctx: ModuleContext, id: string | null | undefined) {
  if (!id) return null;
  const [c] = await ctx.db.select().from(categories).where(and(eq(categories.id, id), eq(categories.archived, false)));
  if (!c) throw E.unprocessable("Unknown or archived category");
  return c.id;
}

// ───────────────────────── DTO ─────────────────────────
export async function toDtos(ctx: ModuleContext, rows: Row[]) {
  const [names, cats] = await Promise.all([
    ctx.people.names(rows.map((r) => r.submitterId)),
    rows.some((r) => r.categoryId) ? ctx.db.select({ id: categories.id, name: categories.name }).from(categories) : Promise.resolve([]),
  ]);
  const cat = new Map(cats.map((c) => [c.id, c.name]));
  const uid = me(ctx);
  const approver = ctx.authz.can(P.approve), self = settingsOf(ctx).allowSelfApproval;
  return rows.map((r) => ({
    id: r.id, status: r.status, spentOn: r.spentOn, merchant: r.merchant,
    categoryId: r.categoryId, categoryName: r.categoryId ? cat.get(r.categoryId) ?? null : null,
    amount: r.amount, tax: r.tax, currency: r.currency, description: r.description,
    submitterId: r.submitterId, submitterName: names[r.submitterId] ?? null, mine: r.submitterId === uid,
    /** The viewer may approve/reject it now (submitted, approver, and not their own unless self-approval is on). */
    canDecide: approver && r.status === "submitted" && (r.submitterId !== uid || self),
    receipt: r.receiptId ? { id: r.receiptId, filename: r.receiptName, mime: r.receiptMime } : null,
    submittedAt: r.submittedAt, decidedBy: r.decidedBy, decidedAt: r.decidedAt, decisionNote: r.decisionNote,
    reimbursedAt: r.reimbursedAt, reimbursementRef: r.reimbursementRef, createdAt: r.createdAt, updatedAt: r.updatedAt,
  }));
}
export const getExpense = async (ctx: ModuleContext, id: string) => (await toDtos(ctx, [await load(ctx, id)]))[0]!;

const eventPayload = (r: Row) => ({
  id: r.id, submitterId: r.submitterId, spentOn: r.spentOn, merchant: r.merchant, categoryId: r.categoryId,
  amount: r.amount, tax: r.tax, currency: r.currency,
});

// ───────────────────────── expenses ─────────────────────────
export async function listExpenses(ctx: ModuleContext, q: z.infer<typeof ExpenseQuery>) {
  const w: SQL[] = [];
  const v = visible(ctx); if (v) w.push(v);
  if (q.mine === "true") w.push(eq(expenses.submitterId, me(ctx) ?? "00000000-0000-0000-0000-000000000000"));
  if (q.status) w.push(eq(expenses.status, q.status));
  if (q.submitterId) w.push(eq(expenses.submitterId, q.submitterId));
  if (q.categoryId) w.push(eq(expenses.categoryId, q.categoryId));
  if (q.from) w.push(gte(expenses.spentOn, q.from));
  if (q.to) w.push(lte(expenses.spentOn, q.to));
  if (q.cursor) w.push(lt(expenses.id, q.cursor));
  const rows = await ctx.db.select().from(expenses).where(w.length ? and(...w) : undefined).orderBy(desc(expenses.id)).limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  return { data: await toDtos(ctx, page), nextCursor: rows.length > q.limit ? page.at(-1)!.id : null };
}

export async function createExpense(ctx: ModuleContext, i: z.infer<typeof ExpenseIn>) {
  const uid = me(ctx);
  if (!uid) throw E.badRequest("Expenses are created by a signed-in member, not an API key without a user");
  const [r] = await ctx.db.insert(expenses).values({
    id: uuidv7(), tenantId: ctx.tenantId, submitterId: uid, status: "draft", spentOn: i.spentOn, merchant: i.merchant,
    categoryId: await activeCategory(ctx, i.categoryId), amount: i.amount, tax: i.tax, currency: i.currency ?? settingsOf(ctx).currency,
    description: i.description ?? null,
  }).returning();
  await ctx.audit.log("expense.created", { type: "expenses.expense", id: r!.id }, { amount: r!.amount, currency: r!.currency });
  return r!;
}

export async function updateExpense(ctx: ModuleContext, id: string, i: z.infer<typeof ExpensePatch>) {
  const cur = await loadOwnEditable(ctx, id);
  const amount = i.amount ?? cur.amount, tax = i.tax ?? cur.tax;
  if (tax > amount) throw E.unprocessable("Tax cannot exceed the amount");
  const [r] = await ctx.db.update(expenses).set({
    ...(i.spentOn !== undefined ? { spentOn: i.spentOn } : {}), ...(i.merchant !== undefined ? { merchant: i.merchant } : {}),
    ...(i.categoryId !== undefined ? { categoryId: await activeCategory(ctx, i.categoryId) } : {}),
    amount, tax, ...(i.currency !== undefined ? { currency: i.currency } : {}),
    ...(i.description !== undefined ? { description: i.description ?? null } : {}),
    // Editing a rejected expense turns it back into a draft to resubmit.
    status: "draft", decidedAt: null, decidedBy: null,
  }).where(eq(expenses.id, id)).returning();
  await ctx.audit.log("expense.updated", { type: "expenses.expense", id }, i);
  return r!;
}

export async function deleteExpense(ctx: ModuleContext, id: string) {
  const cur = await loadOwnEditable(ctx, id);
  await ctx.db.delete(expenses).where(eq(expenses.id, id));
  if (cur.receiptId) await ctx.files.remove(cur.receiptId);
  await ctx.audit.log("expense.deleted", { type: "expenses.expense", id }, { amount: cur.amount, currency: cur.currency });
}

export async function attachReceipt(ctx: ModuleContext, id: string, f: { filename: string; bytes: Uint8Array; contentType?: string | undefined }) {
  const cur = await loadOwnEditable(ctx, id);
  const stored = await ctx.files.put({ filename: f.filename, bytes: f.bytes, ...(f.contentType ? { contentType: f.contentType } : {}), title: `Receipt: ${cur.merchant}` });
  await ctx.db.update(expenses).set({ receiptId: stored.id, receiptName: stored.filename, receiptMime: stored.mime }).where(eq(expenses.id, id));
  if (cur.receiptId) await ctx.files.remove(cur.receiptId);
  return stored;
}
export async function removeReceipt(ctx: ModuleContext, id: string) {
  const cur = await loadOwnEditable(ctx, id);
  if (!cur.receiptId) return;
  await ctx.db.update(expenses).set({ receiptId: null, receiptName: null, receiptMime: null }).where(eq(expenses.id, id));
  await ctx.files.remove(cur.receiptId);
}
export async function readReceipt(ctx: ModuleContext, id: string) {
  const cur = await load(ctx, id);
  if (!cur.receiptId) throw E.notFound("Receipt");
  return ctx.files.get(cur.receiptId);
}

export async function submitExpense(ctx: ModuleContext, id: string) {
  const cur = await loadOwnEditable(ctx, id);
  const s = settingsOf(ctx);
  const problems: string[] = [];
  if (cur.amount <= 0) problems.push("Amount must be more than zero");
  if (!cur.categoryId) problems.push("Choose a category");
  if (!cur.receiptId && cur.amount > s.receiptRequiredOver) problems.push("Attach a receipt");
  if (problems.length) throw E.unprocessable(problems.join(". "), { problems });
  const [r] = await ctx.db.update(expenses).set({ status: "submitted", submittedAt: new Date(), decidedAt: null, decidedBy: null, decisionNote: null })
    .where(eq(expenses.id, id)).returning();
  await ctx.audit.log("expense.submitted", { type: "expenses.expense", id });
  await ctx.events.emit("expenses.expense.submitted", eventPayload(r!));
  return r!;
}

/** Approve or reject a submitted expense. Approvers cannot decide their own unless allowSelfApproval. */
export async function decide(ctx: ModuleContext, id: string, decision: "approved" | "rejected", note?: string) {
  const cur = await load(ctx, id, true);
  if (cur.status !== "submitted") throw E.conflict(`Expense is ${cur.status}; only submitted expenses can be ${decision}`);
  if (cur.submitterId === me(ctx) && !settingsOf(ctx).allowSelfApproval) throw E.forbidden("You cannot approve or reject your own expense");
  if (decision === "rejected" && !note?.trim()) throw E.unprocessable("Give a reason so the submitter can fix it");
  const [r] = await ctx.db.update(expenses).set({ status: decision, decidedAt: new Date(), decidedBy: ctx.actor.id, decisionNote: note?.trim() || null })
    .where(eq(expenses.id, id)).returning();
  await ctx.audit.log(`expense.${decision}`, { type: "expenses.expense", id }, { note: note ?? null });
  await ctx.events.emit(`expenses.expense.${decision}`, { ...eventPayload(r!), note: r!.decisionNote });
  return r!;
}

/** Mark approved expenses as paid back (e.g. one payroll or bank run). All-or-nothing. */
export async function reimburse(ctx: ModuleContext, ids: string[], reference?: string) {
  const rows = await ctx.db.select().from(expenses).where(inArray(expenses.id, ids)).for("update");
  const bad = ids.filter((id) => rows.find((r) => r.id === id)?.status !== "approved");
  if (bad.length) throw E.conflict(`Only approved expenses can be reimbursed (${bad.length} not approved)`);
  const out = await ctx.db.update(expenses).set({ status: "reimbursed", reimbursedAt: new Date(), reimbursedBy: ctx.actor.id, reimbursementRef: reference?.trim() || null })
    .where(inArray(expenses.id, ids)).returning();
  for (const r of out) {
    await ctx.audit.log("expense.reimbursed", { type: "expenses.expense", id: r.id }, { reference: r.reimbursementRef });
    await ctx.events.emit("expenses.expense.reimbursed", { ...eventPayload(r), reference: r.reimbursementRef });
  }
  return out;
}

// ───────────────────────── reporting ─────────────────────────
export async function summary(ctx: ModuleContext) {
  const uid = me(ctx) ?? "00000000-0000-0000-0000-000000000000";
  const all = seesAll(ctx);
  const sum = (cond: SQL) => sql<string>`coalesce(sum(${expenses.amount}) filter (where ${cond}), 0)`;
  const cnt = (cond: SQL) => sql<number>`(count(*) filter (where ${cond}))::int`;
  const mine = eq(expenses.submitterId, uid);
  const monthStart = sql`date_trunc('month', now())::date`;
  const rows = await ctx.db.select({
    currency: expenses.currency,
    myDraft: cnt(and(mine, or(eq(expenses.status, "draft"), eq(expenses.status, "rejected")))!),
    myPending: sum(and(mine, eq(expenses.status, "submitted"))!),
    myToBePaid: sum(and(mine, eq(expenses.status, "approved"))!),
    toApproveCount: cnt(and(eq(expenses.status, "submitted"), ne(expenses.submitterId, uid))!),
    toApprove: sum(and(eq(expenses.status, "submitted"), ne(expenses.submitterId, uid))!),
    toReimburseCount: cnt(eq(expenses.status, "approved")),
    toReimburse: sum(eq(expenses.status, "approved")),
    approvedThisMonth: sum(and(inArray(expenses.status, ["approved", "reimbursed"]), gte(expenses.spentOn, monthStart))!),
  }).from(expenses).where(all ? undefined : mine).groupBy(expenses.currency).orderBy(expenses.currency);
  const n = (x: string) => Number(x);
  return {
    seesAll: all,
    data: rows.map((r) => ({
      currency: r.currency, myDraft: r.myDraft, myPending: n(r.myPending), myToBePaid: n(r.myToBePaid),
      ...(all ? { toApproveCount: r.toApproveCount, toApprove: n(r.toApprove), toReimburseCount: r.toReimburseCount, toReimburse: n(r.toReimburse), approvedThisMonth: n(r.approvedThisMonth) } : {}),
    })),
  };
}

const digits = (cur: string) => new Intl.NumberFormat("en", { style: "currency", currency: cur }).resolvedOptions().maximumFractionDigits ?? 2;
export const major = (minor: number, cur: string) => (minor / 10 ** digits(cur)).toFixed(digits(cur));
/** Neutralize spreadsheet formulas (CSV injection) and quote. */
const cell = (v: unknown) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) || s.startsWith("'") ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Decided expenses as CSV for accounting (UTF-8 with BOM so spreadsheet apps detect it). */
export async function exportCsv(ctx: ModuleContext, q: z.infer<typeof ExportQuery>) {
  const statuses: ExpenseStatus[] = q.status === "all_decided" ? ["approved", "reimbursed"] : [q.status];
  const w: SQL[] = [inArray(expenses.status, statuses)];
  if (q.from) w.push(gte(expenses.spentOn, q.from));
  if (q.to) w.push(lte(expenses.spentOn, q.to));
  const rows = await ctx.db.select().from(expenses).where(and(...w)).orderBy(asc(expenses.spentOn), asc(expenses.id)).limit(50_000);
  const [names, cats] = await Promise.all([ctx.people.names(rows.map((r) => r.submitterId)), listCategories(ctx, true)]);
  const cat = new Map(cats.map((c) => [c.id, c]));
  const head = ["Date", "Submitted by", "Merchant", "Category", "Account code", "Amount", "Tax", "Currency", "Status", "Description", "Reimbursement ref", "Expense id"];
  const lines = rows.map((r) => [
    r.spentOn, names[r.submitterId] ?? r.submitterId, r.merchant, r.categoryId ? cat.get(r.categoryId)?.name : "", r.categoryId ? cat.get(r.categoryId)?.code : "",
    major(r.amount, r.currency), major(r.tax, r.currency), r.currency, r.status, r.description, r.reimbursementRef, r.id,
  ].map(cell).join(","));
  await ctx.audit.log("expense.exported", undefined, { rows: rows.length, from: q.from ?? null, to: q.to ?? null, status: q.status });
  return "﻿" + [head.join(","), ...lines].join("\r\n") + "\r\n";
}
