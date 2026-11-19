import { and, desc, eq, ilike, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "@office/db";
import { moduleErrors as E, type ModuleContext } from "@office/sdk";
import { addDays, computeLine, computeTotals, numberFormat, todayUtc } from "./money.ts";
import { invoices, lines, payments, type PartySnapshot } from "./schema.ts";

// ───────────────────────── settings ─────────────────────────
export interface InvoicingSettings {
  currency: string; numberFormat: string; paymentTermDays: number;
  sellerName?: string; sellerAddress?: string; sellerTaxId?: string; sellerEmail?: string;
  paymentInstructions?: string; footer?: string; draftOnDealWon: boolean; reminderIntervalDays: number;
}
export const SETTINGS_SCHEMA = {
  type: "object",
  properties: {
    currency: { type: "string", title: "Default currency", default: "EUR", pattern: "^[A-Z]{3}$" },
    numberFormat: { type: "string", title: "Number format", default: "INV-{YYYY}-{seq:5}", pattern: "\\{seq(:[1-9])?\\}", maxLength: 40,
      description: "Tokens: {YYYY} {YY} {MM} {seq} {seq:N}. The counter restarts when the text around {seq} changes (e.g. each year)." },
    paymentTermDays: { type: "integer", title: "Payment terms (days)", default: 30, minimum: 0, maximum: 365 },
    sellerName: { type: "string", title: "Your company name", maxLength: 200 },
    sellerAddress: { type: "string", title: "Your address", maxLength: 500 },
    sellerTaxId: { type: "string", title: "Your VAT / tax ID", maxLength: 50 },
    sellerEmail: { type: "string", title: "Billing email", maxLength: 200 },
    paymentInstructions: { type: "string", title: "Payment instructions (e.g. IBAN)", maxLength: 500 },
    footer: { type: "string", title: "Invoice footer", maxLength: 500 },
    draftOnDealWon: { type: "boolean", title: "Draft an invoice when a CRM deal is won", default: true },
    reminderIntervalDays: { type: "integer", title: "Minimum days between reminders", default: 7, minimum: 1, maximum: 90 },
  },
  additionalProperties: false,
} as const;
const DEFAULTS: InvoicingSettings = { currency: "EUR", numberFormat: "INV-{YYYY}-{seq:5}", paymentTermDays: 30, draftOnDealWon: true, reminderIntervalDays: 7 };
export const settingsOf = (ctx: ModuleContext): InvoicingSettings => ({ ...DEFAULTS, ...ctx.settings.get<Partial<InvoicingSettings>>() });

// ───────────────────────── input schemas ─────────────────────────
const decimals = (n: number) => (v: number) => Math.abs(Math.round(v * 10 ** n) - v * 10 ** n) < 1e-6;
export const LineIn = z.object({
  description: z.string().trim().min(1).max(1000),
  quantity: z.number().positive().max(100_000).refine(decimals(3), "at most 3 decimals"),
  unitPrice: z.number().int().min(-10_000_000_000).max(10_000_000_000).describe("minor units, e.g. cents"),
  taxRate: z.number().min(0).max(100).refine(decimals(2), "at most 2 decimals").default(0).describe("percent, e.g. 19"),
});
export const DraftIn = z.object({
  contactId: z.uuid().nullish(),
  companyId: z.uuid().nullish(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  issueDate: z.iso.date().nullish(),
  dueDate: z.iso.date().nullish(),
  notes: z.string().max(4000).nullish(),
  lines: z.array(LineIn).max(200).default([]),
});
export type DraftInput = z.input<typeof DraftIn>;
export const PaymentIn = z.object({
  amount: z.number().int().positive().max(1e15).describe("minor units"),
  paidOn: z.iso.date().optional(),
  method: z.enum(["bank_transfer", "card", "cash", "other"]).default("bank_transfer"),
  reference: z.string().max(200).optional(),
});
export const ListQuery = z.object({
  status: z.enum(["draft", "open", "paid", "void", "overdue"]).optional(),
  contactId: z.uuid().optional(),
  companyId: z.uuid().optional(),
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
});

const MAX_SAFE_TOTAL = 1e15;

// ───────────────────────── DTOs ─────────────────────────
type InvoiceRow = typeof invoices.$inferSelect;
export function toDto(r: InvoiceRow, today = todayUtc()) {
  return {
    id: r.id, number: r.number, status: r.status,
    overdue: r.status === "open" && !!r.dueDate && r.dueDate < today,
    contactId: r.contactId, companyId: r.companyId, currency: r.currency,
    issueDate: r.issueDate, dueDate: r.dueDate, notes: r.notes, customer: r.customer, seller: r.seller,
    subtotal: r.subtotal, taxTotal: r.taxTotal, total: r.total, amountPaid: r.amountPaid,
    balance: r.status === "void" ? 0 : r.total - r.amountPaid,
    sentAt: r.sentAt, paidAt: r.paidAt, voidedAt: r.voidedAt, voidReason: r.voidReason,
    reminderCount: r.reminderCount, lastRemindedAt: r.lastRemindedAt, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}
export type InvoiceDto = ReturnType<typeof toDto>;

/** Versioned event payload (v1) shared by all invoicing.invoice.* events. */
const eventPayload = (r: InvoiceRow) => ({
  v: 1, id: r.id, number: r.number, status: r.status, currency: r.currency,
  total: r.total, amountPaid: r.amountPaid, balance: r.total - r.amountPaid,
  issueDate: r.issueDate, dueDate: r.dueDate, contactId: r.contactId, companyId: r.companyId,
  customer: r.customer ? { name: r.customer.name, email: r.customer.email ?? null } : null,
  source: r.source,   // e.g. "crm.deal:<id>" when drafted from a won deal (added in 1.1.0, additive)
});

// ───────────────────────── reads ─────────────────────────
async function load(ctx: ModuleContext, id: string, lock = false) {
  const q = ctx.db.select().from(invoices).where(eq(invoices.id, id));
  const [r] = lock ? await q.for("update") : await q;
  if (!r) throw E.notFound("Invoice");
  return r;
}

export async function getInvoice(ctx: ModuleContext, id: string) {
  const r = await load(ctx, id);
  const [ls, ps] = await Promise.all([
    ctx.db.select().from(lines).where(eq(lines.invoiceId, id)).orderBy(lines.position),
    ctx.db.select().from(payments).where(eq(payments.invoiceId, id)).orderBy(payments.paidOn, payments.id),
  ]);
  return {
    ...toDto(r),
    lines: ls.map((l) => ({
      id: l.id, description: l.description, quantity: l.quantityMilli / 1000, unitPrice: l.unitPrice,
      taxRate: l.taxRateBp / 100, net: l.net, tax: l.tax,
    })),
    payments: ps.map((p) => ({ id: p.id, amount: p.amount, paidOn: p.paidOn, method: p.method, reference: p.reference, createdAt: p.createdAt })),
  };
}

export async function listInvoices(ctx: ModuleContext, q: z.infer<typeof ListQuery>) {
  const today = todayUtc();
  const w: SQL[] = [];
  if (q.status === "overdue") w.push(eq(invoices.status, "open"), lt(invoices.dueDate, today));
  else if (q.status) w.push(eq(invoices.status, q.status));
  if (q.contactId) w.push(eq(invoices.contactId, q.contactId));
  if (q.companyId) w.push(eq(invoices.companyId, q.companyId));
  if (q.cursor) w.push(lt(invoices.id, q.cursor));
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    w.push(or(ilike(invoices.number, like), sql`${invoices.customer}->>'name' ilike ${like}`)!);
  }
  const rows = await ctx.db.select().from(invoices).where(w.length ? and(...w) : undefined).orderBy(desc(invoices.id)).limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  return { data: page.map((r) => toDto(r, today)), nextCursor: rows.length > q.limit ? page.at(-1)!.id : null };
}

/** Outstanding / overdue / paid-in-30-days per currency, for the dashboard widget. */
export async function summary(ctx: ModuleContext) {
  const today = todayUtc(), since = addDays(today, -30);
  const rows = await ctx.db.select({
    currency: invoices.currency,
    outstanding: sql<string>`coalesce(sum(${invoices.total} - ${invoices.amountPaid}) filter (where ${invoices.status} = 'open'), 0)`,
    openCount: sql<number>`count(*) filter (where ${invoices.status} = 'open')::int`,
    overdue: sql<string>`coalesce(sum(${invoices.total} - ${invoices.amountPaid}) filter (where ${invoices.status} = 'open' and ${invoices.dueDate} < ${today}), 0)`,
    overdueCount: sql<number>`count(*) filter (where ${invoices.status} = 'open' and ${invoices.dueDate} < ${today})::int`,
    paid30d: sql<string>`coalesce(sum(${invoices.total}) filter (where ${invoices.status} = 'paid' and ${invoices.paidAt} >= ${since}::date), 0)`,
    drafts: sql<number>`count(*) filter (where ${invoices.status} = 'draft')::int`,
  }).from(invoices).groupBy(invoices.currency).orderBy(invoices.currency);
  return {
    data: rows.map((r) => ({ ...r, outstanding: Number(r.outstanding), overdue: Number(r.overdue), paid30d: Number(r.paid30d) })),
  };
}

// ───────────────────────── drafts ─────────────────────────
async function checkCustomer(ctx: ModuleContext, contactId?: string | null, companyId?: string | null) {
  // Goes through core repos: permission check + existence + not soft-deleted, same tenant (RLS).
  if (contactId) await ctx.data.contacts.get(contactId);
  if (companyId) await ctx.data.companies.get(companyId);
}

async function writeLines(ctx: ModuleContext, invoiceId: string, input: z.infer<typeof LineIn>[]) {
  const computed = input.map(computeLine);
  const totals = computeTotals(computed);
  if (Math.abs(totals.total) > MAX_SAFE_TOTAL) throw E.badRequest("Invoice total is too large");
  await ctx.db.delete(lines).where(eq(lines.invoiceId, invoiceId));
  if (computed.length) {
    await ctx.db.insert(lines).values(computed.map((l, i) => ({
      id: uuidv7(), tenantId: ctx.tenantId, invoiceId, position: i, description: l.description,
      quantityMilli: l.quantityMilli, unitPrice: l.unitPrice, taxRateBp: l.taxRateBp, net: l.net, tax: l.tax,
    })));
  }
  return totals;
}

export async function createDraft(ctx: ModuleContext, raw: DraftInput, source?: string) {
  const input = DraftIn.parse(raw);
  const s = settingsOf(ctx);
  await checkCustomer(ctx, input.contactId, input.companyId);
  const id = uuidv7();
  await ctx.db.insert(invoices).values({
    id, tenantId: ctx.tenantId, status: "draft", contactId: input.contactId ?? null, companyId: input.companyId ?? null,
    currency: input.currency ?? s.currency, issueDate: input.issueDate ?? null, dueDate: input.dueDate ?? null,
    notes: input.notes ?? null, subtotal: 0, taxTotal: 0, total: 0, amountPaid: 0, reminderCount: 0,
    source: source ?? null, createdBy: ctx.actor.id,
  });
  const totals = await writeLines(ctx, id, input.lines);
  const [row] = await ctx.db.update(invoices).set(totals).where(eq(invoices.id, id)).returning();
  await ctx.audit.log("invoice.created", { type: "invoice", id }, { total: totals.total, currency: row!.currency, source });
  await ctx.events.emit("invoicing.invoice.created", eventPayload(row!));
  return row!;
}

export async function updateDraft(ctx: ModuleContext, id: string, raw: DraftInput) {
  const input = DraftIn.parse(raw);
  const r = await load(ctx, id, true);
  if (r.status !== "draft") throw E.conflict("Only draft invoices can be edited. Void it and create a new one.");
  await checkCustomer(ctx, input.contactId, input.companyId);
  const totals = await writeLines(ctx, id, input.lines);
  const [row] = await ctx.db.update(invoices).set({
    contactId: input.contactId ?? null, companyId: input.companyId ?? null, currency: input.currency ?? r.currency,
    issueDate: input.issueDate ?? null, dueDate: input.dueDate ?? null, notes: input.notes ?? null, ...totals, updatedAt: new Date(),
  }).where(eq(invoices.id, id)).returning();
  await ctx.audit.log("invoice.updated", { type: "invoice", id }, { total: totals.total });
  return row!;
}

export async function deleteDraft(ctx: ModuleContext, id: string) {
  const r = await load(ctx, id, true);
  if (r.status !== "draft") throw E.conflict("Issued invoices cannot be deleted. Void it instead.");
  await ctx.db.delete(invoices).where(eq(invoices.id, id));
  await ctx.audit.log("invoice.deleted", { type: "invoice", id }, { total: r.total });
}

// ───────────────────────── lifecycle ─────────────────────────
function addressText(a: unknown): string | null {
  if (!a) return null;
  if (typeof a === "string") return a;
  if (typeof a !== "object") return null;
  const o = a as Record<string, unknown>;
  const keys = ["line1", "line2", "street", "postalCode", "zip", "city", "region", "state", "country"];
  const parts = (keys.some((k) => o[k]) ? keys.map((k) => o[k]) : Object.values(o)).filter((v) => typeof v === "string" && v.trim());
  return parts.length ? (parts as string[]).join(", ") : null;
}

async function customerSnapshot(ctx: ModuleContext, r: InvoiceRow): Promise<PartySnapshot> {
  const contact = r.contactId ? await ctx.data.contacts.get(r.contactId) : null;
  const company = r.companyId ? await ctx.data.companies.get(r.companyId) : null;
  const person = contact ? [contact.firstName, contact.lastName].filter(Boolean).join(" ") || String(contact.email ?? "") : "";
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    name: company ? String(company.name) : person,
    email: str(contact?.email),
    address: addressText(company?.address),
    taxId: str(company?.taxId),
  };
}

const sellerSnapshot = (s: InvoicingSettings): PartySnapshot => ({
  name: s.sellerName ?? "", email: s.sellerEmail ?? null, address: s.sellerAddress ?? null, taxId: s.sellerTaxId ?? null,
  paymentInstructions: s.paymentInstructions ?? null, footer: s.footer ?? null,
});

async function nextNumber(ctx: ModuleContext, format: string, issueDate: string) {
  const f = numberFormat(format, new Date(`${issueDate}T00:00:00Z`));
  // Row lock on the sequence row serializes issuers; rolled-back issues don't burn numbers (gapless).
  const res = await ctx.db.execute(sql`
    insert into invoicing_sequences (tenant_id, scope, last_value) values (${ctx.tenantId}, ${f.scope}, 1)
    on conflict (tenant_id, scope) do update set last_value = invoicing_sequences.last_value + 1
    returning last_value`);
  const rows = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as { last_value: string | number }[];
  return f.render(Number(rows[0]!.last_value));
}

/** Finalize a draft: number, dates, customer + seller snapshots. Immutable afterwards (DB-enforced). */
export async function issue(ctx: ModuleContext, id: string, opts: { issueDate?: string | undefined } = {}) {
  const r = await load(ctx, id, true);
  if (r.status !== "draft") throw E.conflict("Invoice is already issued");
  if (!r.contactId && !r.companyId) throw E.unprocessable("Add a customer (contact or company) before issuing");
  const [{ n }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(lines).where(eq(lines.invoiceId, id)) as [{ n: number }];
  if (!n) throw E.unprocessable("Add at least one line before issuing");
  if (r.total < 0) throw E.unprocessable("Invoice total cannot be negative (credit notes are not supported yet)");
  const s = settingsOf(ctx);
  const customer = await customerSnapshot(ctx, r);
  if (!customer.name) throw E.unprocessable("Customer has no name");
  const issueDate = opts.issueDate ?? r.issueDate ?? todayUtc();
  const dueDate = r.dueDate && r.dueDate >= issueDate ? r.dueDate : addDays(issueDate, s.paymentTermDays);
  const number = await nextNumber(ctx, s.numberFormat, issueDate);
  const zero = r.total === 0;
  const [row] = await ctx.db.update(invoices).set({
    status: zero ? "paid" : "open", number, issueDate, dueDate, customer, seller: sellerSnapshot(s),
    ...(zero ? { paidAt: new Date() } : {}),
  }).where(eq(invoices.id, id)).returning();
  await ctx.audit.log("invoice.issued", { type: "invoice", id }, { number, total: r.total, currency: r.currency });
  await ctx.events.emit("invoicing.invoice.issued", eventPayload(row!));
  if (zero) await ctx.events.emit("invoicing.invoice.paid", eventPayload(row!));
  return row!;
}

/**
 * Mark as sent (issues a draft first). Emits invoicing.invoice.sent with the recipient so a workflow
 * or a future email action delivers it; the module itself does not send email yet.
 */
export async function markSent(ctx: ModuleContext, id: string, opts: { to?: string | undefined } = {}) {
  let r = await load(ctx, id, true);
  if (r.status === "draft") r = await issue(ctx, id);
  if (r.status === "void") throw E.conflict("Invoice is void");
  const to = opts.to ?? r.customer?.email ?? null;
  const [row] = await ctx.db.update(invoices).set({ sentAt: new Date() }).where(eq(invoices.id, id)).returning();
  await ctx.audit.log("invoice.sent", { type: "invoice", id }, { to });
  await ctx.events.emit("invoicing.invoice.sent", { ...eventPayload(row!), to });
  return row!;
}

export async function recordPayment(ctx: ModuleContext, id: string, raw: z.input<typeof PaymentIn>) {
  const p = PaymentIn.parse(raw);
  const r = await load(ctx, id, true);
  if (r.status !== "open") throw E.conflict(r.status === "paid" ? "Invoice is already paid" : `Cannot record a payment on a ${r.status} invoice`);
  const balance = r.total - r.amountPaid;
  if (p.amount > balance) throw E.unprocessable(`Payment exceeds the balance due (${balance})`, { balance });
  const paymentId = uuidv7();
  await ctx.db.insert(payments).values({
    id: paymentId, tenantId: ctx.tenantId, invoiceId: id, amount: p.amount, paidOn: p.paidOn ?? todayUtc(),
    method: p.method, reference: p.reference ?? null, createdBy: ctx.actor.id,
  });
  const amountPaid = r.amountPaid + p.amount, paid = amountPaid === r.total;
  const [row] = await ctx.db.update(invoices).set({ amountPaid, ...(paid ? { status: "paid" as const, paidAt: new Date() } : {}) })
    .where(eq(invoices.id, id)).returning();
  await ctx.audit.log("payment.recorded", { type: "invoice", id }, { paymentId, amount: p.amount, method: p.method });
  await ctx.events.emit("invoicing.payment.recorded", { ...eventPayload(row!), payment: { id: paymentId, amount: p.amount, method: p.method } });
  if (paid) await ctx.events.emit("invoicing.invoice.paid", eventPayload(row!));
  return row!;
}

export async function voidInvoice(ctx: ModuleContext, id: string, reason: string) {
  const r = await load(ctx, id, true);
  if (r.status === "draft") throw E.conflict("Drafts are deleted, not voided");
  if (r.status === "void") throw E.conflict("Invoice is already void");
  if (r.amountPaid > 0) throw E.conflict("Invoices with payments cannot be voided (refunds / credit notes come later)");
  const [row] = await ctx.db.update(invoices).set({ status: "void", voidedAt: new Date(), voidReason: reason })
    .where(eq(invoices.id, id)).returning();
  await ctx.audit.log("invoice.voided", { type: "invoice", id }, { reason });
  await ctx.events.emit("invoicing.invoice.voided", { ...eventPayload(row!), reason });
  return row!;
}

/** Records a reminder and emits invoicing.invoice.reminder_requested (delivery via workflow/email). Throttled. */
export async function remind(ctx: ModuleContext, id: string) {
  const r = await load(ctx, id, true);
  if (r.status !== "open") throw E.conflict("Only unpaid invoices can be reminded");
  const s = settingsOf(ctx);
  if (r.lastRemindedAt && Date.now() - r.lastRemindedAt.getTime() < s.reminderIntervalDays * 86_400_000) {
    throw E.conflict(`A reminder was sent less than ${s.reminderIntervalDays} days ago`);
  }
  const [row] = await ctx.db.update(invoices).set({ reminderCount: r.reminderCount + 1, lastRemindedAt: new Date() })
    .where(eq(invoices.id, id)).returning();
  await ctx.audit.log("invoice.reminded", { type: "invoice", id }, { count: row!.reminderCount });
  await ctx.events.emit("invoicing.invoice.reminder_requested", { ...eventPayload(row!), reminderCount: row!.reminderCount });
  return row!;
}

/** Job: flag open invoices past due once and emit invoicing.invoice.overdue. Idempotent. */
export async function markOverdue(ctx: ModuleContext, limit = 500) {
  const today = todayUtc();
  const rows = await ctx.db.update(invoices).set({ overdueAt: new Date() })
    .where(and(eq(invoices.status, "open"), lt(invoices.dueDate, today), isNull(invoices.overdueAt),
      sql`${invoices.id} in (select id from invoicing_invoices where status = 'open' and due_date < ${today} and overdue_at is null limit ${limit})`))
    .returning();
  for (const r of rows) {
    await ctx.events.emit("invoicing.invoice.overdue", { ...eventPayload(r), daysOverdue: daysBetween(r.dueDate!, today) });
  }
  return rows.length;
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
