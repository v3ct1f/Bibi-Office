import { fileURLToPath } from "node:url";
import { z } from "zod";
import { action, defineModule, job, route } from "@office/sdk";
import { addDays, toCents, today } from "./money.ts";
import {
  createInvoice, deleteDraft, getInvoice, InvoiceInput, InvoicePatch, invoiceForDeal, ListQuery, listInvoices, markOverdue,
  PaymentInput, recordPayment, remind, sendInvoice, settingsOf, summary, updateInvoice, voidInvoice,
} from "./service.ts";

const READ = "invoicing:invoice.read", WRITE = "invoicing:invoice.write", SEND = "invoicing:invoice.send";
const Id = z.object({ id: z.uuid() });

export default defineModule({
  manifest: {
    key: "invoicing",
    name: "Invoicing",
    version: "1.0.0",
    office: "^1.0",
    description: "Invoices with gapless numbering, payments, overdue tracking and reminders.",
    permissions: {
      declares: [
        { key: READ, label: "View invoices" },
        { key: WRITE, label: "Create and edit invoices, record payments" },
        { key: SEND, label: "Send invoices and reminders" },
      ],
      requires: ["core:contacts.read", "core:companies.read"],
    },
    entities: ["invoice", "invoice_line", "payment"],
    events: {
      emits: [
        { type: "invoicing.invoice.created" }, { type: "invoicing.invoice.sent" }, { type: "invoicing.invoice.paid" },
        { type: "invoicing.invoice.overdue" }, { type: "invoicing.invoice.voided" }, { type: "invoicing.invoice.reminded" },
        { type: "invoicing.payment.recorded" },
      ],
      subscribes: ["crm.deal.won"],
    },
    workflow: {
      triggers: [
        "invoicing.invoice.created", "invoicing.invoice.sent", "invoicing.invoice.paid", "invoicing.invoice.overdue",
        "invoicing.invoice.voided", "invoicing.invoice.reminded", "invoicing.payment.recorded",
      ],
      actions: [
        { key: "invoicing.create_invoice", label: "Create invoice" },
        { key: "invoicing.send_reminder", label: "Send payment reminder" },
      ],
    },
    ui: {
      slots: [
        { slot: "nav.main", label: "Invoices", icon: "receipt", route: "/invoices", permission: READ },
        { slot: "global.create", label: "Invoice", route: "/invoices/new", permission: WRITE },
        { slot: "entity.tab:company", label: "Invoices", component: "CustomerInvoicesTab", permission: READ },
        { slot: "entity.tab:contact", label: "Invoices", component: "CustomerInvoicesTab", permission: READ },
        { slot: "dashboard.widget", label: "Invoices", component: "OutstandingWidget", permission: READ },
      ],
    },
    settings: {
      type: "object",
      properties: {
        currency: { type: "string", title: "Default currency", default: "EUR", pattern: "^[A-Z]{3}$" },
        numberFormat: {
          type: "string", title: "Number format", default: "INV-{YYYY}-{seq:5}", maxLength: 40, pattern: "\\{seq(:\\d{1,2})?\\}",
          description: "Tokens: {YYYY} {YY} {MM} {seq:N}. Numbers restart each year (or month) when the format contains it.",
        },
        paymentTermDays: { type: "integer", title: "Payment terms (days)", default: 30, minimum: 0, maximum: 365 },
        defaultTaxRate: { type: "number", title: "Default tax rate (%)", default: 0, minimum: 0, maximum: 100 },
        sellerName: { type: "string", title: "Your company name", maxLength: 200 },
        sellerAddress: { type: "string", title: "Your address", maxLength: 500 },
        sellerTaxId: { type: "string", title: "Your tax / VAT ID", maxLength: 50 },
        paymentInstructions: { type: "string", title: "Payment instructions", maxLength: 500, description: "Shown on every invoice, e.g. IBAN and BIC." },
      },
      additionalProperties: false,
    },
    api: { basePath: "/invoicing" },
  },
  migrationsDir: fileURLToPath(new URL("../migrations", import.meta.url)),
  routes: [
    route({ method: "GET", path: "/invoices", permission: READ, query: ListQuery, handler: (ctx, { query }) => listInvoices(ctx, query) }),
    route({ method: "GET", path: "/summary", permission: READ, handler: (ctx) => summary(ctx) }),
    route({
      method: "GET", path: "/config", permission: READ,
      handler: async (ctx) => { const s = settingsOf(ctx); return { ...s, defaultDueDate: addDays(today(), s.paymentTermDays) }; },
    }),
    route({ method: "POST", path: "/invoices", permission: WRITE, status: 201, body: InvoiceInput, handler: (ctx, { body }) => createInvoice(ctx, body) }),
    route({ method: "GET", path: "/invoices/:id", permission: READ, params: Id, handler: (ctx, { params }) => getInvoice(ctx, params.id) }),
    route({ method: "PATCH", path: "/invoices/:id", permission: WRITE, params: Id, body: InvoicePatch, handler: (ctx, { params, body }) => updateInvoice(ctx, params.id, body) }),
    route({ method: "DELETE", path: "/invoices/:id", permission: WRITE, params: Id, status: 204, handler: (ctx, { params }) => deleteDraft(ctx, params.id) }),
    route({ method: "POST", path: "/invoices/:id/send", permission: SEND, params: Id, handler: (ctx, { params }) => sendInvoice(ctx, params.id) }),
    route({ method: "POST", path: "/invoices/:id/remind", permission: SEND, params: Id, handler: (ctx, { params }) => remind(ctx, params.id) }),
    route({
      method: "POST", path: "/invoices/:id/payments", permission: WRITE, params: Id, body: PaymentInput, status: 201,
      handler: (ctx, { params, body }) => recordPayment(ctx, params.id, body),
    }),
    route({
      method: "POST", path: "/invoices/:id/void", permission: WRITE, params: Id, body: z.object({ reason: z.string().trim().max(500).nullish() }),
      handler: (ctx, { params, body }) => voidInvoice(ctx, params.id, body.reason),
    }),
  ],
  handlers: {
    "crm.deal.won": async (ctx, e) => { await invoiceForDeal(ctx, e.payload); },
  },
  actions: {
    "invoicing.create_invoice": action({
      label: "Create invoice",
      input: z.object({
        companyId: z.uuid().optional().describe("Company to bill (or set Contact)"),
        contactId: z.uuid().optional().describe("Contact to bill (or set Company)"),
        description: z.string().min(1).max(500),
        amount: z.coerce.number().positive().max(1e12).describe("Net amount in major units, e.g. 1500.00"),
        taxRate: z.coerce.number().min(0).max(100).optional().describe("Percent; defaults to the module setting"),
        dueInDays: z.coerce.number().int().min(0).max(365).optional(),
        send: z.boolean().optional().describe("Send right away (assigns the invoice number)"),
      }),
      run: async (ctx, i) => {
        const s = settingsOf(ctx);
        const issueDate = today();
        let inv = await createInvoice(ctx, {
          companyId: i.companyId ?? null, contactId: i.contactId ?? null, issueDate,
          dueDate: addDays(issueDate, i.dueInDays ?? s.paymentTermDays),
          lines: [{ description: i.description, quantity: 1, unitPriceCents: toCents(Math.round(i.amount * 100) / 100), taxRate: i.taxRate ?? s.defaultTaxRate }],
        }, { source: "workflow" });
        if (i.send) inv = await sendInvoice(ctx, inv.id);
        return { invoiceId: inv.id, number: inv.number, totalCents: inv.totalCents };
      },
    }),
    "invoicing.send_reminder": action({
      label: "Send payment reminder",
      input: z.object({ invoiceId: z.uuid().describe("Usually {{payload.id}}") }),
      run: (ctx, i) => remind(ctx, i.invoiceId),
    }),
  },
  jobs: {
    mark_overdue: job({ label: "Flag overdue invoices", everyMinutes: 60, run: async (ctx) => { await markOverdue(ctx); } }),
  },
});
