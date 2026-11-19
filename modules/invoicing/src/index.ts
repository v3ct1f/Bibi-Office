import { fileURLToPath } from "node:url";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { action, defineModule, file, route, type ModuleContext } from "@office/sdk";
import { renderInvoicePdf } from "./pdf.ts";
import { invoices } from "./schema.ts";
import {
  createDraft, deleteDraft, DraftIn, getInvoice, issue, LineIn, listInvoices, ListQuery, markOverdue, markSent, PaymentIn,
  recordPayment, remind, SETTINGS_SCHEMA, settingsOf, summary, toDto, updateDraft, voidInvoice,
} from "./service.ts";

const P = {
  read: "invoicing:invoice.read",
  write: "invoicing:invoice.write",
  send: "invoicing:invoice.send",
  void: "invoicing:invoice.void",
  pay: "invoicing:payment.write",
} as const;
const Id = z.object({ id: z.uuid() });
const full = async (ctx: ModuleContext, id: string) => getInvoice(ctx, id);

/** Payload contract the CRM module (Session 6) emits for crm.deal.won, v1. */
export const DealWonV1 = z.object({
  dealId: z.string().min(1).max(100),
  title: z.string().min(1).max(500),
  amount: z.number().int().positive().describe("minor units"),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  contactId: z.uuid().nullish(),
  companyId: z.uuid().nullish(),
});

export default defineModule({
  manifest: {
    key: "invoicing",
    name: "Invoicing",
    version: "1.0.0",
    office: "^1.0",
    description: "Invoices with line items and tax, gapless numbering, PDF, payments, overdue tracking and reminders.",
    permissions: {
      declares: [
        { key: P.read, label: "View invoices" },
        { key: P.write, label: "Create and edit draft invoices" },
        { key: P.send, label: "Issue, send and remind invoices" },
        { key: P.void, label: "Void issued invoices" },
        { key: P.pay, label: "Record payments" },
      ],
      requires: ["core:contacts.read", "core:companies.read"],
    },
    entities: ["invoice", "invoice_line", "payment"],
    events: {
      emits: [
        { type: "invoicing.invoice.created" },
        { type: "invoicing.invoice.issued" },
        { type: "invoicing.invoice.sent" },
        { type: "invoicing.invoice.paid" },
        { type: "invoicing.invoice.overdue" },
        { type: "invoicing.invoice.voided" },
        { type: "invoicing.invoice.reminder_requested" },
        { type: "invoicing.payment.recorded" },
      ],
      subscribes: ["crm.deal.won"],
    },
    workflow: {
      triggers: [
        "invoicing.invoice.issued", "invoicing.invoice.sent", "invoicing.invoice.paid", "invoicing.invoice.overdue",
        "invoicing.invoice.voided", "invoicing.invoice.reminder_requested", "invoicing.payment.recorded",
      ],
      actions: [
        { key: "invoicing.create_invoice", label: "Create invoice" },
        { key: "invoicing.send_reminder", label: "Send payment reminder" },
      ],
    },
    ui: {
      slots: [
        { slot: "nav.main", label: "Invoices", icon: "receipt", route: "/invoices", permission: P.read },
        { slot: "entity.tab:contact", label: "Invoices", component: "ContactInvoicesTab", permission: P.read },
        { slot: "dashboard.widget", label: "Invoices", component: "OutstandingWidget", permission: P.read },
      ],
    },
    settings: SETTINGS_SCHEMA as unknown as Record<string, unknown>,
    api: { basePath: "/invoicing" },
    lifecycle: [],
  },
  migrationsDir: fileURLToPath(new URL("../migrations", import.meta.url)),
  routes: [
    route({ method: "GET", path: "/invoices", permission: P.read, query: ListQuery, handler: (ctx, { query }) => listInvoices(ctx, query) }),
    route({ method: "GET", path: "/summary", permission: P.read, handler: (ctx) => summary(ctx) }),
    route({
      method: "POST", path: "/invoices", permission: P.write, status: 201, body: DraftIn,
      handler: async (ctx, { body }) => full(ctx, (await createDraft(ctx, body)).id),
    }),
    route({ method: "GET", path: "/invoices/:id", permission: P.read, params: Id, handler: (ctx, { params }) => full(ctx, params.id) }),
    route({
      method: "PUT", path: "/invoices/:id", permission: P.write, params: Id, body: DraftIn,
      handler: async (ctx, { params, body }) => { await updateDraft(ctx, params.id, body); return full(ctx, params.id); },
    }),
    route({
      method: "DELETE", path: "/invoices/:id", permission: P.write, params: Id,
      handler: async (ctx, { params }) => { await deleteDraft(ctx, params.id); },
    }),
    route({
      method: "POST", path: "/invoices/:id/issue", permission: P.send, params: Id,
      body: z.object({ issueDate: z.iso.date().optional() }).default({}),
      handler: async (ctx, { params, body }) => { await issue(ctx, params.id, body); return full(ctx, params.id); },
    }),
    route({
      method: "POST", path: "/invoices/:id/send", permission: P.send, params: Id,
      body: z.object({ to: z.email().optional() }).default({}),
      handler: async (ctx, { params, body }) => { await markSent(ctx, params.id, body); return full(ctx, params.id); },
    }),
    route({
      method: "POST", path: "/invoices/:id/remind", permission: P.send, params: Id,
      handler: async (ctx, { params }) => { await remind(ctx, params.id); return full(ctx, params.id); },
    }),
    route({
      method: "POST", path: "/invoices/:id/void", permission: P.void, params: Id,
      body: z.object({ reason: z.string().trim().min(1).max(500) }),
      handler: async (ctx, { params, body }) => { await voidInvoice(ctx, params.id, body.reason); return full(ctx, params.id); },
    }),
    route({
      method: "POST", path: "/invoices/:id/payments", permission: P.pay, params: Id, body: PaymentIn, status: 201,
      handler: async (ctx, { params, body }) => { await recordPayment(ctx, params.id, body); return full(ctx, params.id); },
    }),
    route({
      method: "GET", path: "/invoices/:id/pdf", permission: P.read, params: Id,
      handler: async (ctx, { params }) => {
        const inv = await full(ctx, params.id);
        const s = settingsOf(ctx);
        const preview = inv.status === "draft"
          ? { ...inv, seller: { name: s.sellerName ?? "", address: s.sellerAddress ?? null, taxId: s.sellerTaxId ?? null, email: s.sellerEmail ?? null, paymentInstructions: s.paymentInstructions ?? null, footer: s.footer ?? null } }
          : inv;
        return file({ contentType: "application/pdf", filename: `${inv.number ?? `draft-${inv.id.slice(-8)}`}.pdf`, body: await renderInvoicePdf(preview) });
      },
    }),
  ],
  handlers: {
    "crm.deal.won": async (ctx, e) => {
      if (!settingsOf(ctx).draftOnDealWon) return;
      const p = DealWonV1.safeParse(e.payload);
      if (!p.success) { ctx.log.warn({ eventId: e.id }, "crm.deal.won payload not understood; skipped"); return; }
      const source = `crm.deal:${p.data.dealId}`;
      const [exists] = await ctx.db.select({ id: invoices.id }).from(invoices).where(eq(invoices.source, source));
      if (exists) return;
      await createDraft(ctx, {
        contactId: p.data.contactId ?? null, companyId: p.data.companyId ?? null, currency: p.data.currency,
        lines: [{ description: p.data.title, quantity: 1, unitPrice: p.data.amount, taxRate: 0 }],
      }, source);
    },
  },
  actions: {
    "invoicing.create_invoice": action({
      label: "Create invoice",
      input: z.object({
        contactId: z.uuid().optional(), companyId: z.uuid().optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(),
        notes: z.string().max(4000).optional(), lines: z.array(LineIn).min(1).max(200),
        issue: z.boolean().default(false).describe("Issue immediately (assigns a number)"),
      }),
      run: async (ctx, i) => {
        const r = await createDraft(ctx, { contactId: i.contactId, companyId: i.companyId, currency: i.currency, notes: i.notes, lines: i.lines });
        const out = i.issue ? await issue(ctx, r.id) : r;
        return { id: out.id, number: out.number, total: out.total, status: out.status };
      },
    }),
    "invoicing.send_reminder": action({
      label: "Send payment reminder",
      input: z.object({ invoiceId: z.uuid() }),
      run: async (ctx, i) => {
        const r = await remind(ctx, i.invoiceId);
        return { id: r.id, reminderCount: r.reminderCount };
      },
    }),
  },
  jobs: {
    "mark-overdue": { everySeconds: 3600, run: (ctx) => markOverdue(ctx) },
  },
});

export { toDto };
export type { InvoiceDto } from "./service.ts";
