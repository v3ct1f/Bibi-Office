import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lt, lte, or, sum, type SQL } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "@office/db";
import { moduleErrors as E, type ModuleContext } from "@office/sdk";
import { expenses, files, history, lines, type ExpenseStatus, type HistoryAction } from "./schema.ts";

export const P = {
  READ: "expenses:expense.read",       // own expenses (all of them with REVIEW)
  SUBMIT: "expenses:expense.submit",   // create, edit own drafts, submit
  REVIEW: "expenses:expense.review",   // see everyone's, approve / reject, mark paid
} as const;

export const DEFAULT_CATEGORIES = [
  "Food & drink supplies", "Equipment", "Repairs & maintenance", "Cleaning", "Office supplies", "Utilities",
  "Rent", "Software", "Marketing", "Travel", "Fuel", "Other",
];
export interface Settings { currency: string; categories: string[] }
export const settingsOf = (ctx: ModuleContext): Settings => {
  const s = ctx.settings.get<Partial<Settings>>();
  return { currency: s.currency ?? "EUR", categories: s.categories?.length ? s.categories : DEFAULT_CATEGORIES };
};

// ───────── Validation ─────────
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD").refine((d) => !Number.isNaN(Date.parse(d)), "Not a real date");
const cents = z.number().int("Amounts are in cents (whole numbers)").min(0, "Amounts cannot be negative").max(1e12);
const text = (max: number) => z.string().trim().max(max);

export const LineInput = z.object({
  description: text(200).min(1, "Each line needs a description"),
  quantity: z.number().positive("Quantity must be more than 0").max(1e6).default(1),
  amountCents: cents,
}).strict();

export const ExpenseInput = z.object({
  kind: z.enum(["receipt", "invoice"]).default("receipt"),
  vendor: text(200).min(1, "Who did you pay? Enter the vendor"),
  docDate: day,
  dueDate: day.nullish(),
  invoiceNumber: text(80).nullish(),
  category: text(80).nullish(),
  description: text(2000).nullish(),
  currency: z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code like EUR").optional(),
  taxCents: cents.default(0),
  totalCents: cents,
  lines: z.array(LineInput).max(100).default([]),
  fileId: z.uuid().nullish(),
  ocrText: z.string().max(20000).nullish(),
}).strict();
export const ExpensePatch = ExpenseInput.partial().strict();

export const ListQuery = z.object({
  status: z.enum(["draft", "submitted", "approved", "rejected", "paid"]).optional(),
  from: day.optional(),
  to: day.optional(),
  vendor: text(200).optional(),
  employeeId: z.uuid().optional(),
  category: text(80).optional(),
  q: text(200).optional(),
  mine: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export const DecisionInput = z.object({ comment: text(1000).optional() }).strict();
export const RejectInput = z.object({ comment: text(1000).min(1, "Say why it is rejected so they can fix it") }).strict();

export const FileInput = z.object({
  name: text(200).min(1),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"], { message: "Upload a photo (JPG, PNG, WEBP) or a PDF" }),
  data: z.string().min(1).max(7_100_000, "Files can be at most 5 MB"),
}).strict();
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

// ───────── Helpers ─────────
type Row = typeof expenses.$inferSelect;
const me = (ctx: ModuleContext) => ctx.actor.userId ?? null;
const canReview = (ctx: ModuleContext) => ctx.authz.can(P.REVIEW);
const requireUser = (ctx: ModuleContext) => {
  const id = me(ctx);
  if (!id) throw E.badRequest("Expenses belong to a person: sign in as a user to do this");
  return id;
};

/** Lines may be the amounts before tax or including it; either way they must add up to something on the receipt. */
export function checkTotals(input: { taxCents: number; totalCents: number; lines: { amountCents: number }[] }) {
  if (input.taxCents > input.totalCents) throw E.badRequest("Tax cannot be more than the total");
  const subtotal = input.totalCents - input.taxCents;
  if (input.lines.length) {
    const s = input.lines.reduce((a, l) => a + l.amountCents, 0);
    if (s !== subtotal && s !== input.totalCents) {
      throw E.badRequest(`The line items add up to ${(s / 100).toFixed(2)}, which matches neither the total (${(input.totalCents / 100).toFixed(2)}) nor the amount before tax (${(subtotal / 100).toFixed(2)})`);
    }
  }
  return subtotal;
}

async function log(ctx: ModuleContext, expenseId: string, action: HistoryAction, comment?: string | null) {
  await ctx.db.insert(history).values({ id: uuidv7(), tenantId: ctx.tenantId, expenseId, action, actorId: me(ctx), comment: comment || null });
}

async function load(ctx: ModuleContext, id: string): Promise<Row> {
  const [r] = await ctx.db.select().from(expenses).where(eq(expenses.id, id));
  // Employees only see their own; a 404 does not reveal others' expenses.
  if (!r || (!canReview(ctx) && r.employeeId !== me(ctx))) throw E.notFound("Expense");
  return r;
}

async function names(ctx: ModuleContext) {
  const people = await ctx.people.list();
  const map = new Map(people.map((p) => [p.userId, p.name]));
  return (id: string | null) => (id ? map.get(id) ?? "Former member" : null);
}

const payload = (r: Row, extra: Record<string, unknown> = {}) => ({
  id: r.id, kind: r.kind, status: r.status, vendor: r.vendor, docDate: r.docDate, category: r.category,
  totalCents: r.totalCents, taxCents: r.taxCents, currency: r.currency, employeeId: r.employeeId, ...extra,
});

async function assertFile(ctx: ModuleContext, fileId: string | null | undefined) {
  if (!fileId) return;
  const [f] = await ctx.db.select({ id: files.id, uploadedBy: files.uploadedBy }).from(files).where(eq(files.id, fileId));
  if (!f) throw E.badRequest("The attached file was not found; upload it again");
}

async function writeLines(ctx: ModuleContext, expenseId: string, ls: z.infer<typeof LineInput>[]) {
  await ctx.db.delete(lines).where(eq(lines.expenseId, expenseId));
  if (ls.length) {
    await ctx.db.insert(lines).values(ls.map((l, i) => ({
      id: uuidv7(), tenantId: ctx.tenantId, expenseId, position: i, description: l.description,
      quantity: String(l.quantity), amountCents: l.amountCents,
    })));
  }
}

// ───────── Queries ─────────
function filters(ctx: ModuleContext, q: z.infer<typeof ListQuery>): SQL | undefined {
  const w: (SQL | undefined)[] = [];
  if (!canReview(ctx) || q.mine === "true") w.push(eq(expenses.employeeId, me(ctx) ?? "00000000-0000-0000-0000-000000000000"));
  else if (q.employeeId) w.push(eq(expenses.employeeId, q.employeeId));
  if (q.status) w.push(eq(expenses.status, q.status));
  if (q.from) w.push(gte(expenses.docDate, q.from));
  if (q.to) w.push(lte(expenses.docDate, q.to));
  if (q.vendor) w.push(ilike(expenses.vendor, `%${q.vendor.replace(/[%_\\]/g, "\\$&")}%`));
  if (q.category) w.push(eq(expenses.category, q.category));
  if (q.q) {
    const like = `%${q.q.replace(/[%_\\]/g, "\\$&")}%`;
    w.push(or(ilike(expenses.vendor, like), ilike(expenses.description, like), ilike(expenses.invoiceNumber, like)));
  }
  return and(...w);
}

export async function listExpenses(ctx: ModuleContext, q: z.infer<typeof ListQuery>) {
  const where = filters(ctx, q);
  const rows = await ctx.db.select().from(expenses).where(where)
    .orderBy(desc(expenses.docDate), desc(expenses.id)).limit(q.limit).offset(q.offset);
  const [{ n }] = await ctx.db.select({ n: count() }).from(expenses).where(where) as [{ n: number }];
  const totals = await ctx.db.select({ currency: expenses.currency, cents: sum(expenses.totalCents) }).from(expenses).where(where).groupBy(expenses.currency);
  const name = await names(ctx);
  return {
    data: rows.map((r) => ({ ...dto(r), employeeName: name(r.employeeId) })),
    total: Number(n),
    totals: totals.map((t) => ({ currency: t.currency, cents: Number(t.cents ?? 0) })),
  };
}

const dto = (r: Row) => ({
  id: r.id, kind: r.kind, status: r.status, employeeId: r.employeeId, vendor: r.vendor, docDate: r.docDate, dueDate: r.dueDate,
  invoiceNumber: r.invoiceNumber, category: r.category, description: r.description, currency: r.currency,
  subtotalCents: r.subtotalCents, taxCents: r.taxCents, totalCents: r.totalCents, fileId: r.fileId,
  submittedAt: r.submittedAt, decidedBy: r.decidedBy, decidedAt: r.decidedAt, decisionComment: r.decisionComment, paidAt: r.paidAt,
  createdAt: r.createdAt, updatedAt: r.updatedAt,
});

export async function getExpense(ctx: ModuleContext, id: string) {
  const r = await load(ctx, id);
  const ls = await ctx.db.select().from(lines).where(eq(lines.expenseId, id)).orderBy(asc(lines.position));
  const hs = await ctx.db.select().from(history).where(eq(history.expenseId, id)).orderBy(asc(history.createdAt), asc(history.id));
  const [file] = r.fileId
    ? await ctx.db.select({ id: files.id, name: files.name, contentType: files.contentType, sizeBytes: files.sizeBytes }).from(files).where(eq(files.id, r.fileId))
    : [];
  const name = await names(ctx);
  const mine = r.employeeId === me(ctx);
  const review = canReview(ctx);
  return {
    ...dto(r), employeeName: name(r.employeeId), decidedByName: name(r.decidedBy), ocrText: r.ocrText,
    lines: ls.map((l) => ({ description: l.description, quantity: Number(l.quantity), amountCents: l.amountCents })),
    history: hs.map((h) => ({ action: h.action, actorName: name(h.actorId), comment: h.comment, at: h.createdAt })),
    file: file ?? null,
    can: {
      edit: editable(ctx, r), delete: deletable(ctx, r),
      submit: mine && (r.status === "draft" || r.status === "rejected") && ctx.authz.can(P.SUBMIT),
      approve: review && r.status === "submitted", reject: review && r.status === "submitted",
      pay: review && r.status === "approved",
    },
  };
}

const editable = (ctx: ModuleContext, r: Row) =>
  (r.employeeId === me(ctx) && ctx.authz.can(P.SUBMIT) && (r.status === "draft" || r.status === "rejected"))
  || (canReview(ctx) && (r.status === "draft" || r.status === "submitted" || r.status === "rejected"));
const deletable = (ctx: ModuleContext, r: Row) =>
  (r.status === "draft" || r.status === "rejected") && (r.employeeId === me(ctx) || canReview(ctx));

// ───────── Commands ─────────
export async function createExpense(ctx: ModuleContext, input: z.infer<typeof ExpenseInput>) {
  const employeeId = requireUser(ctx);
  const subtotalCents = checkTotals(input);
  await assertFile(ctx, input.fileId);
  const id = uuidv7();
  const [r] = await ctx.db.insert(expenses).values({
    id, tenantId: ctx.tenantId, kind: input.kind, status: "draft", employeeId, vendor: input.vendor, docDate: input.docDate,
    dueDate: input.dueDate ?? null, invoiceNumber: input.invoiceNumber || null, category: input.category || null,
    description: input.description || null, currency: input.currency ?? settingsOf(ctx).currency,
    subtotalCents, taxCents: input.taxCents, totalCents: input.totalCents, fileId: input.fileId ?? null, ocrText: input.ocrText || null,
  }).returning();
  await writeLines(ctx, id, input.lines);
  await log(ctx, id, "created");
  await ctx.audit.log("expense.created", { type: "expense", id }, { vendor: r!.vendor, totalCents: r!.totalCents });
  await ctx.events.emit("expenses.expense.created", payload(r!));
  return getExpense(ctx, id);
}

export async function updateExpense(ctx: ModuleContext, id: string, patch: z.infer<typeof ExpensePatch>) {
  const r = await load(ctx, id);
  if (!editable(ctx, r)) {
    throw r.status === "approved" || r.status === "paid"
      ? E.conflict(`This expense is ${r.status} and can no longer be changed`)
      : E.forbidden("You can only change your own drafts and rejected expenses");
  }
  const curLines = patch.lines ?? (await ctx.db.select().from(lines).where(eq(lines.expenseId, id))).map((l) => ({ amountCents: l.amountCents }));
  const taxCents = patch.taxCents ?? r.taxCents;
  const totalCents = patch.totalCents ?? r.totalCents;
  const subtotalCents = checkTotals({ taxCents, totalCents, lines: curLines });
  if (patch.fileId !== undefined) await assertFile(ctx, patch.fileId);
  const set: Partial<Row> = { taxCents, totalCents, subtotalCents, updatedAt: new Date() };
  for (const k of ["kind", "vendor", "docDate", "dueDate", "invoiceNumber", "category", "description", "currency", "fileId", "ocrText"] as const) {
    if (patch[k] !== undefined) (set as Record<string, unknown>)[k] = patch[k] === "" ? null : patch[k];
  }
  await ctx.db.update(expenses).set(set).where(eq(expenses.id, id));
  if (patch.lines) await writeLines(ctx, id, patch.lines);
  if (patch.fileId !== undefined && r.fileId && r.fileId !== patch.fileId) await ctx.db.delete(files).where(eq(files.id, r.fileId));
  await log(ctx, id, "edited");
  await ctx.audit.log("expense.updated", { type: "expense", id }, { changes: Object.keys(patch) });
  return getExpense(ctx, id);
}

export async function deleteExpense(ctx: ModuleContext, id: string) {
  const r = await load(ctx, id);
  if (!deletable(ctx, r)) throw E.conflict("Only drafts and rejected expenses can be deleted");
  await ctx.db.delete(expenses).where(eq(expenses.id, id));
  if (r.fileId) await ctx.db.delete(files).where(eq(files.id, r.fileId));
  await ctx.audit.log("expense.deleted", { type: "expense", id }, { vendor: r.vendor, totalCents: r.totalCents });
}

async function transition(ctx: ModuleContext, id: string, from: ExpenseStatus[], to: ExpenseStatus, set: Partial<Row>, comment?: string | null) {
  const r = await load(ctx, id);
  if (!from.includes(r.status)) {
    throw E.conflict(`This expense is ${r.status}; it must be ${from.join(" or ")} to be ${to}`);
  }
  // Guard against two managers deciding at once.
  const [u] = await ctx.db.update(expenses).set({ ...set, status: to, updatedAt: new Date() })
    .where(and(eq(expenses.id, id), eq(expenses.status, r.status))).returning();
  if (!u) throw E.conflict("Someone else just changed this expense; reload and try again");
  await log(ctx, id, to as HistoryAction, comment);
  await ctx.audit.log(`expense.${to}`, { type: "expense", id }, comment ? { comment } : undefined);
  await ctx.events.emit(`expenses.expense.${to}`, payload(u, comment ? { comment } : {}));
  return getExpense(ctx, id);
}

export async function submitExpense(ctx: ModuleContext, id: string) {
  const r = await load(ctx, id);
  if (r.employeeId !== me(ctx)) throw E.forbidden("Only the person who paid can submit this expense");
  return transition(ctx, id, ["draft", "rejected"], "submitted", { submittedAt: new Date(), decidedBy: null, decidedAt: null, decisionComment: null });
}
export const approveExpense = (ctx: ModuleContext, id: string, comment?: string) =>
  transition(ctx, id, ["submitted"], "approved", { decidedBy: me(ctx), decidedAt: new Date(), decisionComment: comment || null }, comment);
export const rejectExpense = (ctx: ModuleContext, id: string, comment: string) =>
  transition(ctx, id, ["submitted"], "rejected", { decidedBy: me(ctx), decidedAt: new Date(), decisionComment: comment }, comment);
export const payExpense = (ctx: ModuleContext, id: string) =>
  transition(ctx, id, ["approved"], "paid", { paidAt: new Date() });

// ───────── Files ─────────
const MAGIC: Record<string, (b: Buffer) => boolean> = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  "application/pdf": (b) => b.subarray(0, 5).toString("latin1") === "%PDF-",
};

export async function uploadFile(ctx: ModuleContext, input: z.infer<typeof FileInput>) {
  const uploadedBy = requireUser(ctx);
  const data = Buffer.from(input.data, "base64");
  if (!data.length) throw E.badRequest("The file is empty");
  if (data.length > MAX_FILE_BYTES) throw E.badRequest("Files can be at most 5 MB");
  if (!MAGIC[input.contentType]!(data)) throw E.badRequest("The file content does not match its type");
  const id = uuidv7();
  await ctx.db.insert(files).values({ id, tenantId: ctx.tenantId, name: input.name, contentType: input.contentType, sizeBytes: data.length, data, uploadedBy });
  return { id, name: input.name, contentType: input.contentType, sizeBytes: data.length };
}

export async function getFile(ctx: ModuleContext, id: string) {
  const [f] = await ctx.db.select().from(files).where(eq(files.id, id));
  if (!f) throw E.notFound("File");
  if (f.uploadedBy !== me(ctx) && !canReview(ctx)) {
    // Employees may open files of expenses they can see (their own).
    const [owner] = await ctx.db.select({ id: expenses.id }).from(expenses).where(and(eq(expenses.fileId, id), eq(expenses.employeeId, me(ctx) ?? "")));
    if (!owner) throw E.notFound("File");
  }
  return { id: f.id, name: f.name, contentType: f.contentType, data: f.data.toString("base64") };
}

/** Uploads never attached to an expense (abandoned forms) are removed after a day. */
export async function purgeOrphanFiles(ctx: ModuleContext) {
  const cutoff = new Date(Date.now() - 24 * 3600_000);
  const orphans = await ctx.db.select({ id: files.id }).from(files)
    .leftJoin(expenses, eq(expenses.fileId, files.id))
    .where(and(isNull(expenses.id), lt(files.createdAt, cutoff)));
  if (orphans.length) await ctx.db.delete(files).where(inArray(files.id, orphans.map((o) => o.id)));
}

// ───────── Summary + export ─────────
export async function summary(ctx: ModuleContext) {
  const uid = me(ctx) ?? "00000000-0000-0000-0000-000000000000";
  const byStatus = async (where: SQL | undefined) => ctx.db.select({ status: expenses.status, currency: expenses.currency, n: count(), cents: sum(expenses.totalCents) })
    .from(expenses).where(where).groupBy(expenses.status, expenses.currency);
  const mine = await byStatus(eq(expenses.employeeId, uid));
  const pick = (rows: Awaited<ReturnType<typeof byStatus>>, s: ExpenseStatus) => ({
    count: rows.filter((r) => r.status === s).reduce((a, r) => a + Number(r.n), 0),
    totals: rows.filter((r) => r.status === s).map((r) => ({ currency: r.currency, cents: Number(r.cents ?? 0) })),
  });
  const out: Record<string, unknown> = { mine: { draft: pick(mine, "draft"), rejected: pick(mine, "rejected"), submitted: pick(mine, "submitted") } };
  if (canReview(ctx)) {
    const all = await byStatus(inArray(expenses.status, ["submitted", "approved"]));
    out.toReview = pick(all, "submitted");
    out.toPay = pick(all, "approved");
  }
  return out;
}

const STATUS_LABEL: Record<ExpenseStatus, string> = { draft: "Draft", submitted: "Waiting for approval", approved: "Approved", rejected: "Rejected", paid: "Paid" };
const csvCell = (v: unknown) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // no formulas when opened in a spreadsheet
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const money = (c: number) => (c / 100).toFixed(2);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export async function exportCsv(ctx: ModuleContext, q: z.infer<typeof ListQuery>) {
  const rows = await ctx.db.select().from(expenses).where(filters(ctx, q)).orderBy(desc(expenses.docDate), desc(expenses.id)).limit(10_000);
  const name = await names(ctx);
  const header = ["Date", "Vendor", "Type", "Invoice number", "Category", "Employee", "Status", "Currency", "Before tax", "Tax", "Total",
    "Submitted", "Decided by", "Decided", "Comment", "Paid", "Description"];
  const body = rows.map((r) => [
    r.docDate, r.vendor, r.kind === "invoice" ? "Supplier invoice" : "Receipt", r.invoiceNumber, r.category, name(r.employeeId), STATUS_LABEL[r.status],
    r.currency, money(r.subtotalCents), money(r.taxCents), money(r.totalCents), isoDay(r.submittedAt), name(r.decidedBy), isoDay(r.decidedAt),
    r.decisionComment, isoDay(r.paidAt), r.description,
  ].map(csvCell).join(","));
  return { filename: `expenses-${new Date().toISOString().slice(0, 10)}.csv`, rows: rows.length, csv: `﻿${[header.join(","), ...body].join("\r\n")}\r\n` };
}
