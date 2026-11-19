import { and, asc, desc, eq, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "@office/db";
import { moduleErrors as E, type ModuleContext } from "@office/sdk";
import {
  addDays, formatNumber, invoiceTotals, lineTotals, numberPeriod, today, validateNumberFormat, type LineInput,
} from "./money.ts";
import { invoices, lines, payments, sequences, type Address, type BillTo, type Seller } from "./schema.ts";

// ── Settings ─────────────────────────────────────────────────────────────────
export interface Settings {
  currency: string; numberFormat: string; paymentTermDays: number; defaultTaxRate: number;
  logo?: string;
  sellerName?: string; sellerEmail?: string; sellerPhone?: string; sellerWebsite?: string;
  sellerRegistrationNumber?: string; sellerTaxId?: string;
  sellerAddressLine1?: string; sellerAddressLine2?: string; sellerPostalCode?: string; sellerCity?: string; sellerCountry?: string;
  /** Legacy free-text address (before structured fields); still printed when line fields are empty. */
  sellerAddress?: string;
  bankName?: string; iban?: string; bic?: string; paymentInstructions?: string; footer?: string;
}
export const DEFAULTS: Settings = { currency: "EUR", numberFormat: "INV-{YYYY}-{seq:5}", paymentTermDays: 30, defaultTaxRate: 0 };
export const settingsOf = (ctx: ModuleContext): Settings => ({ ...DEFAULTS, ...ctx.settings.get<Partial<Settings>>() });

const clean = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "")) as T;

/** Seller profile from settings, frozen onto the invoice when it is finalized. */
export function sellerOf(s: Settings): Seller {
  const address = clean<Address>({
    line1: s.sellerAddressLine1 || (!s.sellerAddressLine2 && !s.sellerCity ? s.sellerAddress : undefined),
    line2: s.sellerAddressLine2, postalCode: s.sellerPostalCode, city: s.sellerCity, country: s.sellerCountry,
  });
  return clean<Seller>({
    name: s.sellerName, email: s.sellerEmail, phone: s.sellerPhone, website: s.sellerWebsite,
    registrationNumber: s.sellerRegistrationNumber, taxId: s.sellerTaxId,
    ...(Object.keys(address).length ? { address } : {}),
    bankName: s.bankName, iban: s.iban, bic: s.bic, paymentInstructions: s.paymentInstructions, footer: s.footer,
  });
}

// ── Input schemas ────────────────────────────────────────────────────────────
const isoDate = z.iso.date();
export const LineSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().positive().max(1_000_000),
  unitPriceCents: z.number().int().min(-1e12).max(1e12),
  taxRate: z.number().min(0).max(100),
});
const text = (max: number) => z.string().trim().max(max).optional();
export const AddressInput = z.object({
  line1: text(200), line2: text(200), postalCode: text(20), city: text(100), region: text(100), country: text(100),
});
/** Billing details printed on the invoice; empty fields fall back to the company/contact record. */
export const BillToInput = z.object({
  name: text(200), contactName: text(200), email: z.union([z.email().max(200), z.literal("")]).optional(),
  phone: text(50), taxId: text(50), address: AddressInput.optional(),
});
export const InvoiceInput = z.object({
  companyId: z.uuid().nullish(),
  contactId: z.uuid().nullish(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  issueDate: isoDate.optional(),
  dueDate: isoDate.optional(),
  notes: z.string().max(4000).nullish(),
  reference: z.string().trim().max(100).nullish(),
  serviceDate: isoDate.nullish(),
  billTo: BillToInput.optional(),
  lines: z.array(LineSchema).max(200).default([]),
});
export const InvoicePatch = InvoiceInput.partial().extend({ lines: z.array(LineSchema).max(200).optional() });
export const PaymentInput = z.object({
  amountCents: z.number().int().positive().max(1e14),
  paidOn: isoDate.optional(),
  method: z.string().trim().max(50).nullish(),
  reference: z.string().trim().max(200).nullish(),
});
export const ListQuery = z.object({
  status: z.enum(["draft", "sent", "outstanding", "overdue", "paid", "void"]).optional(),
  companyId: z.uuid().optional(),
  contactId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});

// ── DTOs ─────────────────────────────────────────────────────────────────────
type Row = typeof invoices.$inferSelect;
export type DisplayStatus = "draft" | "sent" | "partially_paid" | "overdue" | "paid" | "void";

export function displayStatus(r: Pick<Row, "status" | "dueDate" | "paidCents">, on = today()): DisplayStatus {
  if (r.status !== "sent") return r.status;
  if (r.dueDate < on) return "overdue";
  return r.paidCents > 0 ? "partially_paid" : "sent";
}

const dto = (r: Row) => ({
  id: r.id, number: r.number, status: r.status, displayStatus: displayStatus(r),
  companyId: r.companyId, contactId: r.contactId, billTo: r.billTo, currency: r.currency,
  issueDate: r.issueDate, dueDate: r.dueDate, notes: r.notes, reference: r.reference, serviceDate: r.serviceDate, seller: r.seller,
  subtotalCents: r.subtotalCents, taxCents: r.taxCents, totalCents: r.totalCents, paidCents: r.paidCents,
  balanceCents: r.status === "void" ? 0 : r.totalCents - r.paidCents,
  source: r.source, sentAt: r.sentAt, paidAt: r.paidAt, voidedAt: r.voidedAt, voidReason: r.voidReason,
  reminderCount: r.reminderCount, lastRemindedAt: r.lastRemindedAt, createdAt: r.createdAt, updatedAt: r.updatedAt,
});
export type InvoiceDto = ReturnType<typeof dto>;

/** Event payload v1 (stable contract for workflows and webhooks). */
const eventPayload = (r: Row) => ({
  id: r.id, number: r.number, status: displayStatus(r), currency: r.currency,
  totalCents: r.totalCents, paidCents: r.paidCents, balanceCents: r.totalCents - r.paidCents,
  dueDate: r.dueDate, companyId: r.companyId, contactId: r.contactId, customerName: r.billTo.name,
});

// ── Helpers ──────────────────────────────────────────────────────────────────
async function load(ctx: ModuleContext, id: string, lock = false): Promise<Row> {
  const q = ctx.db.select().from(invoices).where(eq(invoices.id, id));
  const [r] = lock ? await q.for("update") : await q;
  if (!r) throw E.notFound("Invoice");
  return r;
}

const ADDRESS_KEYS = ["line1", "line2", "postalCode", "city", "region", "country"] as const;
/** Core company addresses are free-form JSON; keep the fields we know (plus common aliases). */
function toAddress(a: unknown): Address {
  if (!a || typeof a !== "object") return {};
  const o = a as Record<string, unknown>;
  const pick = (...k: string[]) => k.map((x) => o[x]).find((v): v is string => typeof v === "string" && !!v.trim());
  return clean<Address>({
    line1: pick("line1", "street", "address1"), line2: pick("line2", "address2"), postalCode: pick("postalCode", "zip", "postcode"),
    city: pick("city", "town"), region: pick("region", "state"), country: pick("country"),
  });
}

/** Overlay user-entered billing details on the resolved record (blank fields keep the record's value). */
function mergeBillTo(base: BillTo, over?: z.infer<typeof BillToInput>): BillTo {
  if (!over) return base;
  const { address, ...rest } = over;
  const merged = { ...base, ...clean(rest) } as BillTo;
  if (address) {
    const a = { ...(base.address ?? {}) } as Record<string, string | undefined>;
    for (const k of ADDRESS_KEYS) if (address[k] !== undefined) a[k] = address[k] || undefined;
    merged.address = clean(a) as Address;
  }
  return merged;
}

async function resolveCustomer(ctx: ModuleContext, companyId?: string | null, contactId?: string | null) {
  const contact = contactId ? await ctx.data.contacts.get(contactId) : null;
  const cid = companyId ?? (contact?.companyId as string | null | undefined) ?? null;
  const company = cid ? await ctx.data.companies.get(cid) : null;
  if (!company && !contact) throw E.badRequest("Choose a company or a contact to bill");
  const contactName = contact ? [contact.firstName, contact.lastName].filter(Boolean).join(" ") || undefined : undefined;
  const billTo: BillTo = {
    name: (company?.name as string | undefined) ?? contactName ?? (contact?.email as string | undefined) ?? "Customer",
    ...(contactName && company ? { contactName } : {}),
    ...(contact?.email ? { email: contact.email as string } : {}),
    ...(contact?.phone ? { phone: contact.phone as string } : {}),
    ...(company?.taxId ? { taxId: company.taxId as string } : {}),
    ...(company?.address ? { address: toAddress(company.address) } : {}),
  };
  return { companyId: (company?.id as string | undefined) ?? null, contactId: (contact?.id as string | undefined) ?? null, billTo };
}

function priceLines(input: LineInput[]) {
  try {
    const priced = input.map((l, i) => ({ ...l, position: i + 1, ...lineTotals(l) }));
    return { priced, totals: invoiceTotals(priced) };
  } catch (e) {
    throw E.badRequest(`Invalid line: ${(e as Error).message}`);
  }
}

async function writeLines(ctx: ModuleContext, invoiceId: string, priced: ReturnType<typeof priceLines>["priced"]) {
  await ctx.db.delete(lines).where(eq(lines.invoiceId, invoiceId));
  if (!priced.length) return;
  await ctx.db.insert(lines).values(priced.map((l) => ({
    id: uuidv7(), tenantId: ctx.tenantId, invoiceId, position: l.position, description: l.description,
    quantity: String(l.quantity), unitPriceCents: l.unitPriceCents, taxRate: String(l.taxRate),
    netCents: l.netCents, taxCents: l.taxCents,
  })));
}

const actorRef = (ctx: ModuleContext) => `${ctx.actor.type}:${ctx.actor.id}`;

// ── Queries ──────────────────────────────────────────────────────────────────
export async function listInvoices(ctx: ModuleContext, q: z.infer<typeof ListQuery>) {
  const on = today();
  const where: (SQL | undefined)[] = [];
  if (q.status === "outstanding") where.push(eq(invoices.status, "sent"));
  else if (q.status === "overdue") where.push(eq(invoices.status, "sent"), lt(invoices.dueDate, on));
  else if (q.status) where.push(eq(invoices.status, q.status));
  if (q.companyId) where.push(eq(invoices.companyId, q.companyId));
  if (q.contactId) where.push(eq(invoices.contactId, q.contactId));
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push(or(ilike(invoices.number, like), sql`${invoices.billTo}->>'name' ilike ${like}`));
  }
  if (q.cursor) where.push(lt(invoices.id, q.cursor));
  const rows = await ctx.db.select().from(invoices).where(and(...where)).orderBy(desc(invoices.id)).limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  return { data: page.map(dto), nextCursor: rows.length > q.limit ? page.at(-1)!.id : null };
}

export async function getInvoice(ctx: ModuleContext, id: string) {
  const r = await load(ctx, id);
  const ls = await ctx.db.select().from(lines).where(eq(lines.invoiceId, id)).orderBy(asc(lines.position));
  const ps = await ctx.db.select().from(payments).where(eq(payments.invoiceId, id)).orderBy(asc(payments.paidOn), asc(payments.id));
  return {
    ...dto(r),
    lines: ls.map((l) => ({
      id: l.id, position: l.position, description: l.description, quantity: Number(l.quantity),
      unitPriceCents: l.unitPriceCents, taxRate: Number(l.taxRate), netCents: l.netCents, taxCents: l.taxCents,
    })),
    payments: ps.map((p) => ({ id: p.id, amountCents: p.amountCents, paidOn: p.paidOn, method: p.method, reference: p.reference, createdAt: p.createdAt })),
  };
}

export async function summary(ctx: ModuleContext) {
  const on = today();
  const since = addDays(on, -30);
  const open = await ctx.db.select({
    currency: invoices.currency,
    outstandingCents: sql<string>`coalesce(sum(${invoices.totalCents} - ${invoices.paidCents}) filter (where ${invoices.status} = 'sent'), 0)`,
    overdueCents: sql<string>`coalesce(sum(${invoices.totalCents} - ${invoices.paidCents}) filter (where ${invoices.status} = 'sent' and ${invoices.dueDate} < ${on}), 0)`,
    openCount: sql<number>`count(*) filter (where ${invoices.status} = 'sent')::int`,
    overdueCount: sql<number>`count(*) filter (where ${invoices.status} = 'sent' and ${invoices.dueDate} < ${on})::int`,
    draftCount: sql<number>`count(*) filter (where ${invoices.status} = 'draft')::int`,
  }).from(invoices).groupBy(invoices.currency);
  const paid = await ctx.db.select({ currency: invoices.currency, cents: sql<string>`sum(${payments.amountCents})` })
    .from(payments).innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .where(sql`${payments.paidOn} >= ${since}`).groupBy(invoices.currency);
  const currencies = new Set([...open.map((r) => r.currency), ...paid.map((r) => r.currency)]);
  return {
    today: on,
    currencies: [...currencies].sort().map((c) => {
      const o = open.find((r) => r.currency === c);
      return {
        currency: c,
        outstandingCents: Number(o?.outstandingCents ?? 0), overdueCents: Number(o?.overdueCents ?? 0),
        openCount: o?.openCount ?? 0, overdueCount: o?.overdueCount ?? 0, draftCount: o?.draftCount ?? 0,
        paidLast30Cents: Number(paid.find((r) => r.currency === c)?.cents ?? 0),
      };
    }),
  };
}

// ── Commands ─────────────────────────────────────────────────────────────────
export async function createInvoice(
  ctx: ModuleContext, input: z.infer<typeof InvoiceInput>, source: { source: string; ref?: string } = { source: "manual" },
) {
  const s = settingsOf(ctx);
  const resolved = await resolveCustomer(ctx, input.companyId, input.contactId);
  const customer = { ...resolved, billTo: mergeBillTo(resolved.billTo, input.billTo) };
  const issueDate = input.issueDate ?? today();
  const dueDate = input.dueDate ?? addDays(issueDate, s.paymentTermDays);
  if (dueDate < issueDate) throw E.badRequest("Due date cannot be before the issue date");
  const { priced, totals } = priceLines(input.lines);
  const id = uuidv7();
  const [row] = await ctx.db.insert(invoices).values({
    id, tenantId: ctx.tenantId, status: "draft", ...customer, currency: input.currency ?? s.currency,
    issueDate, dueDate, notes: input.notes ?? null, reference: input.reference ?? null, serviceDate: input.serviceDate ?? null, ...totals, paidCents: 0, reminderCount: 0,
    source: source.source, sourceRef: source.ref ?? null, createdBy: actorRef(ctx),
  }).returning();
  await writeLines(ctx, id, priced);
  await ctx.audit.log("invoice.created", { type: "invoice", id }, { totalCents: totals.totalCents, currency: row!.currency });
  await ctx.events.emit("invoicing.invoice.created", eventPayload(row!));
  return getInvoice(ctx, id);
}

export async function updateInvoice(ctx: ModuleContext, id: string, patch: z.infer<typeof InvoicePatch>) {
  const r = await load(ctx, id, true);
  if (r.status !== "draft") throw E.conflict("Only draft invoices can be edited");
  const set: Partial<typeof invoices.$inferInsert> = { updatedAt: new Date() };
  if (patch.companyId !== undefined || patch.contactId !== undefined) {
    const c = await resolveCustomer(ctx,
      patch.companyId !== undefined ? patch.companyId : r.companyId,
      patch.contactId !== undefined ? patch.contactId : r.contactId);
    Object.assign(set, c, { billTo: mergeBillTo(c.billTo, patch.billTo) });
  } else if (patch.billTo) {
    set.billTo = mergeBillTo(r.billTo, patch.billTo);
  }
  if (patch.reference !== undefined) set.reference = patch.reference || null;
  if (patch.serviceDate !== undefined) set.serviceDate = patch.serviceDate ?? null;
  if (patch.currency) set.currency = patch.currency;
  if (patch.issueDate) set.issueDate = patch.issueDate;
  if (patch.dueDate) set.dueDate = patch.dueDate;
  if (patch.notes !== undefined) set.notes = patch.notes;
  if ((set.dueDate ?? r.dueDate) < (set.issueDate ?? r.issueDate)) throw E.badRequest("Due date cannot be before the issue date");
  if (patch.lines) {
    const { priced, totals } = priceLines(patch.lines);
    Object.assign(set, totals);
    await writeLines(ctx, id, priced);
  }
  await ctx.db.update(invoices).set(set).where(eq(invoices.id, id));
  await ctx.audit.log("invoice.updated", { type: "invoice", id }, { fields: Object.keys(patch) });
  return getInvoice(ctx, id);
}

export async function deleteDraft(ctx: ModuleContext, id: string) {
  const r = await load(ctx, id, true);
  if (r.status !== "draft") throw E.conflict("Only drafts can be deleted; void a sent invoice instead");
  await ctx.db.delete(invoices).where(eq(invoices.id, id));
  await ctx.audit.log("invoice.deleted", { type: "invoice", id });
}

/** Issue the invoice: assign the next gapless number for its period and lock it against edits. */
export async function sendInvoice(ctx: ModuleContext, id: string) {
  const r = await load(ctx, id, true);
  if (r.status !== "draft") throw E.conflict("Invoice was already sent");
  const [{ n }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(lines).where(eq(lines.invoiceId, id)) as [{ n: number }];
  if (!n) throw E.badRequest("Add at least one line before sending");
  if (r.totalCents <= 0) throw E.badRequest("Invoice total must be greater than zero");
  const fmt = settingsOf(ctx).numberFormat;
  const bad = validateNumberFormat(fmt);
  if (bad) throw E.badRequest(`${bad}. Fix it in Invoicing settings.`);
  const issued = new Date(`${r.issueDate}T00:00:00Z`);
  const period = numberPeriod(fmt, issued);
  const [seq] = await ctx.db.insert(sequences).values({ tenantId: ctx.tenantId, period, lastValue: 1 })
    .onConflictDoUpdate({ target: [sequences.tenantId, sequences.period], set: { lastValue: sql`${sequences.lastValue} + 1` } })
    .returning({ v: sequences.lastValue });
  const number = formatNumber(fmt, issued, seq!.v);
  const [row] = await ctx.db.update(invoices).set({ status: "sent", number, seller: sellerOf(settingsOf(ctx)), sentAt: new Date(), updatedAt: new Date() })
    .where(eq(invoices.id, id)).returning();
  await ctx.audit.log("invoice.sent", { type: "invoice", id }, { number });
  await ctx.events.emit("invoicing.invoice.sent", eventPayload(row!));
  return getInvoice(ctx, id);
}

export async function recordPayment(ctx: ModuleContext, id: string, p: z.infer<typeof PaymentInput>) {
  const r = await load(ctx, id, true);
  if (r.status !== "sent") throw E.conflict(r.status === "draft" ? "Send the invoice before recording payments" : `Invoice is ${r.status}`);
  const balance = r.totalCents - r.paidCents;
  if (p.amountCents > balance) throw E.badRequest(`Payment is more than the open balance (${balance} cents)`);
  const pid = uuidv7();
  await ctx.db.insert(payments).values({
    id: pid, tenantId: ctx.tenantId, invoiceId: id, amountCents: p.amountCents, paidOn: p.paidOn ?? today(),
    method: p.method ?? null, reference: p.reference ?? null, createdBy: actorRef(ctx),
  });
  const paidCents = r.paidCents + p.amountCents;
  const full = paidCents === r.totalCents;
  const [row] = await ctx.db.update(invoices).set({
    paidCents, updatedAt: new Date(), ...(full ? { status: "paid" as const, paidAt: new Date() } : {}),
  }).where(eq(invoices.id, id)).returning();
  await ctx.audit.log("payment.recorded", { type: "invoice", id }, { paymentId: pid, amountCents: p.amountCents });
  await ctx.events.emit("invoicing.payment.recorded", { ...eventPayload(row!), paymentId: pid, amountCents: p.amountCents });
  if (full) await ctx.events.emit("invoicing.invoice.paid", eventPayload(row!));
  return getInvoice(ctx, id);
}

export async function voidInvoice(ctx: ModuleContext, id: string, reason?: string | null) {
  const r = await load(ctx, id, true);
  if (r.status === "draft") throw E.conflict("Drafts are deleted, not voided");
  if (r.status !== "sent") throw E.conflict(`Invoice is already ${r.status}`);
  if (r.paidCents > 0) throw E.conflict("Invoices with payments cannot be voided");
  const [row] = await ctx.db.update(invoices).set({ status: "void", voidedAt: new Date(), voidReason: reason ?? null, updatedAt: new Date() })
    .where(eq(invoices.id, id)).returning();
  await ctx.audit.log("invoice.voided", { type: "invoice", id }, { reason: reason ?? null });
  await ctx.events.emit("invoicing.invoice.voided", { ...eventPayload(row!), reason: reason ?? null });
  return getInvoice(ctx, id);
}

/**
 * Records a payment reminder and emits `invoicing.invoice.reminded`. Delivery (email) is done by whoever
 * listens: a workflow or webhook today, the core send_email action once it exists.
 */
export async function remind(ctx: ModuleContext, id: string) {
  const r = await load(ctx, id, true);
  if (r.status !== "sent") throw E.conflict("Only unpaid sent invoices can be reminded about");
  const [row] = await ctx.db.update(invoices)
    .set({ reminderCount: sql`${invoices.reminderCount} + 1`, lastRemindedAt: new Date(), updatedAt: new Date() })
    .where(eq(invoices.id, id)).returning();
  await ctx.audit.log("invoice.reminded", { type: "invoice", id }, { reminderCount: row!.reminderCount });
  await ctx.events.emit("invoicing.invoice.reminded", { ...eventPayload(row!), reminderCount: row!.reminderCount });
  return { invoiceId: id, reminderCount: row!.reminderCount };
}

/** Job: flag sent invoices past their due date once each, emitting `invoicing.invoice.overdue`. */
export async function markOverdue(ctx: ModuleContext, on = today()) {
  const rows = await ctx.db.update(invoices).set({ overdueAt: new Date() })
    .where(sql`${invoices.id} in (
      select id from invoicing_invoices where status = 'sent' and overdue_at is null and due_date < ${on}
      order by due_date limit 500 for update skip locked)`)
    .returning();
  for (const r of rows) {
    const days = Math.round((Date.parse(`${on}T00:00:00Z`) - Date.parse(`${r.dueDate}T00:00:00Z`)) / 86_400_000);
    await ctx.events.emit("invoicing.invoice.overdue", { ...eventPayload(r), daysOverdue: days });
  }
  return rows.length;
}

/** Drafts an invoice for a won CRM deal. Payload v1: { id, title?, valueCents, currency?, companyId?, contactId? }. */
export async function invoiceForDeal(ctx: ModuleContext, p: Record<string, unknown>) {
  const dealId = typeof p.id === "string" ? p.id : null;
  const value = typeof p.valueCents === "number" && Number.isInteger(p.valueCents) ? p.valueCents : 0;
  if (!dealId || value <= 0 || (!p.companyId && !p.contactId)) {
    ctx.log.warn({ dealId }, "crm.deal.won without id, positive valueCents or customer; no invoice drafted");
    return null;
  }
  const [existing] = await ctx.db.select({ id: invoices.id }).from(invoices)
    .where(and(eq(invoices.source, "crm.deal"), eq(invoices.sourceRef, dealId)));
  if (existing) return existing.id;
  const inv = await createInvoice(ctx, {
    companyId: (p.companyId as string | undefined) ?? null, contactId: (p.contactId as string | undefined) ?? null,
    ...(typeof p.currency === "string" && /^[A-Z]{3}$/.test(p.currency) ? { currency: p.currency } : {}),
    lines: [{ description: typeof p.title === "string" && p.title.trim() ? p.title.trim().slice(0, 500) : "Deal", quantity: 1, unitPriceCents: value, taxRate: settingsOf(ctx).defaultTaxRate }],
  }, { source: "crm.deal", ref: dealId });
  return inv.id;
}
