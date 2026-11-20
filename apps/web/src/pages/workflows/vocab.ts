/**
 * Plain-language names for workflow triggers and the details each trigger carries, plus starter recipes.
 * Unknown events (new modules) fall back to a generated name and a free-text field box, so nothing breaks.
 */
import type { WorkflowInput } from "../../api/types.ts";

export interface EventField { path: string; label: string }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");

const EVENT_LABELS: Record<string, string> = {
  "core.tenant.created": "The workspace is created",
  "core.member.added": "Someone joins the workspace",
  "core.member.removed": "Someone leaves the workspace",
  "core.module.enabled": "A module is turned on",
  "core.module.disabled": "A module is turned off",
  "core.notification.requested": "A notification is sent",
  "invoicing.invoice.created": "An invoice draft is created",
  "invoicing.invoice.sent": "An invoice is finalized",
  "invoicing.invoice.paid": "An invoice is fully paid",
  "invoicing.invoice.overdue": "An invoice becomes overdue",
  "invoicing.invoice.voided": "An invoice is voided",
  "invoicing.invoice.reminded": "A payment reminder is logged",
  "invoicing.payment.recorded": "A payment is recorded",
  "crm.deal.created": "A deal is added",
  "crm.deal.updated": "A deal is changed",
  "crm.deal.stage_changed": "A deal moves to another stage",
  "crm.deal.won": "A deal is won",
  "crm.deal.lost": "A deal is lost",
  "crm.deal.reopened": "A closed deal is reopened",
  "crm.deal.deleted": "A deal is deleted",
  "crm.activity.logged": "A note or call is logged on a deal",
  "expenses.expense.created": "An expense is added",
  "expenses.expense.submitted": "An expense is submitted for approval",
  "expenses.expense.approved": "An expense is approved",
  "expenses.expense.rejected": "An expense is rejected",
  "expenses.expense.paid": "An expense is marked paid",
  "scheduling.shifts.published": "A week's schedule is published",
  "scheduling.time_off.requested": "Someone asks for time off",
  "scheduling.time_off.approved": "Time off is approved",
  "scheduling.time_off.rejected": "Time off is rejected",
  "scheduling.time_off.cancelled": "Time off is cancelled",
  "scheduling.swap.requested": "Someone asks to swap a shift",
  "scheduling.swap.approved": "A shift swap is approved",
  "scheduling.clock.in": "Someone clocks in",
  "scheduling.clock.out": "Someone clocks out",
  "inventory.stock.changed": "Stock of an item changes",
  "inventory.stock.low": "An item drops to its minimum stock",
  "inventory.order.created": "A purchase order is created",
  "inventory.order.sent": "A purchase order is sent",
  "inventory.order.received": "A purchase order is received",
  "hr.employee.updated": "An employee profile changes",
  "hr.pay.changed": "Someone's pay changes",
  "hr.document.expiring": "An employee document is about to expire",
  "hr.checklist.assigned": "An onboarding or offboarding checklist is assigned",
  "hr.checklist.completed": "A checklist is completed",
  "docs.request.sent": "A document is sent for signature",
  "docs.request.signed": "Someone signs a document",
  "docs.request.completed": "A document is signed by everyone",
  "docs.request.declined": "Someone declines to sign a document",
  "docs.request.expired": "A signature request expires",
  "docs.request.cancelled": "A signature request is cancelled",
  "ai.summary.created": "An AI summary is made",
  "ai.action_items.tasks_created": "Action items from a summary become tasks",
  "support.ticket.created": "A support ticket comes in",
  "support.ticket.customer_replied": "A customer replies to a ticket",
  "support.ticket.replied": "Your team replies to a ticket",
  "support.ticket.assigned": "A ticket is assigned",
  "support.ticket.status_changed": "A ticket's status changes",
};

const GROUP_NAMES: Record<string, string> = { crm: "Deals (CRM)", invoicing: "Invoicing", expenses: "Expenses", scheduling: "Schedule & time clock", inventory: "Inventory", support: "Support", hr: "HR", docs: "Docs & e-sign", ai: "AI summaries" };

const ENTITY_WORDS: Record<string, [string, string]> = {
  contact: ["A contact", "Contacts"], company: ["A company", "Companies"], document: ["A document", "Documents"], task: ["A task", "Tasks"],
};
const VERBS: Record<string, string> = { created: "is added", updated: "is changed", deleted: "is deleted" };

/** "core.contact.created" → "A contact is added"; unknown "crm.deal.won" → "Deal won". */
export function eventLabel(event: string): string {
  if (EVENT_LABELS[event]) return EVENT_LABELS[event];
  const [mod, entity, verb] = event.split(".");
  if (mod === "core" && entity && verb && ENTITY_WORDS[entity] && VERBS[verb]) return `${ENTITY_WORDS[entity][0]} ${VERBS[verb]}`;
  const rest = event.split(".").slice(1);
  return rest.length ? cap(rest.join(" ")) : event;
}

/** Group heading in the trigger picker. */
export function eventGroup(event: string): string {
  const [mod, entity] = event.split(".");
  if (mod === "core") return entity && ENTITY_WORDS[entity] ? ENTITY_WORDS[entity][1] : "Workspace";
  return GROUP_NAMES[mod ?? ""] ?? cap(mod ?? event);
}

const ENTITY_FIELDS: Record<string, EventField[]> = {
  contact: [
    { path: "firstName", label: "First name" }, { path: "lastName", label: "Last name" },
    { path: "email", label: "Email" }, { path: "phone", label: "Phone" }, { path: "companyId", label: "Company ID" },
  ],
  company: [{ path: "name", label: "Name" }, { path: "domain", label: "Website domain" }, { path: "taxId", label: "Tax ID" }],
  document: [{ path: "title", label: "Title" }, { path: "folder", label: "Folder" }],
  task: [
    { path: "title", label: "Title" }, { path: "status", label: "Status" }, { path: "priority", label: "Priority (0-4)" },
    { path: "assigneeId", label: "Assignee ID" }, { path: "dueAt", label: "Due date" },
  ],
};

const INVOICE_FIELDS: EventField[] = [
  { path: "number", label: "Invoice number" }, { path: "customerName", label: "Customer name" }, { path: "status", label: "Status" },
  { path: "totalCents", label: "Total (in cents)" }, { path: "balanceCents", label: "Amount still owed (in cents)" },
  { path: "paidCents", label: "Amount paid (in cents)" }, { path: "currency", label: "Currency" }, { path: "dueDate", label: "Due date" },
  { path: "companyId", label: "Company ID" }, { path: "contactId", label: "Contact ID" },
];
const INVOICE_EXTRA: Record<string, EventField[]> = {
  "invoicing.invoice.overdue": [{ path: "daysOverdue", label: "Days overdue" }],
  "invoicing.invoice.voided": [{ path: "reason", label: "Void reason" }],
  "invoicing.invoice.reminded": [{ path: "reminderCount", label: "Reminders so far" }],
  "invoicing.payment.recorded": [{ path: "amountCents", label: "Payment amount (in cents)" }],
};

const DEAL_FIELDS: EventField[] = [
  { path: "title", label: "Deal name" }, { path: "valueCents", label: "Value (in cents)" }, { path: "currency", label: "Currency" },
  { path: "stage", label: "Stage" }, { path: "status", label: "Status (open, won, lost)" }, { path: "expectedClose", label: "Expected close date" },
  { path: "companyId", label: "Company ID" }, { path: "contactId", label: "Contact ID" }, { path: "ownerId", label: "Owner ID" },
];
const DEAL_EXTRA: Record<string, EventField[]> = {
  "crm.deal.stage_changed": [{ path: "fromStage", label: "Previous stage" }],
  "crm.deal.lost": [{ path: "lostReason", label: "Lost reason" }],
};

const EXPENSE_FIELDS: EventField[] = [
  { path: "vendor", label: "Vendor" }, { path: "totalCents", label: "Total (in cents)" }, { path: "taxCents", label: "Tax (in cents)" },
  { path: "currency", label: "Currency" }, { path: "category", label: "Category" }, { path: "docDate", label: "Date" },
  { path: "kind", label: "Type (receipt, invoice)" }, { path: "status", label: "Status" }, { path: "employeeId", label: "Employee (user ID)" },
];

const OTHER_FIELDS: Record<string, EventField[]> = {
  "core.tenant.created": [{ path: "slug", label: "Workspace slug" }],
  "core.member.added": [{ path: "userId", label: "User ID" }, { path: "roles", label: "Roles" }],
  "core.member.removed": [{ path: "userId", label: "User ID" }],
  "core.module.enabled": [{ path: "key", label: "Module key" }, { path: "version", label: "Module version" }],
  "core.module.disabled": [{ path: "key", label: "Module key" }],
  "scheduling.shifts.published": [{ path: "weekStart", label: "Week starting" }, { path: "count", label: "Number of shifts" }, { path: "employeeIds", label: "Employee IDs" }],
  "scheduling.time_off.requested": [{ path: "id", label: "Request ID" }, ...[{ path: "employeeId", label: "Employee ID" }, { path: "kind", label: "Kind of time off" }, { path: "startDate", label: "First day" }, { path: "endDate", label: "Last day" }]],
  "scheduling.time_off.approved": [{ path: "id", label: "Request ID" }, ...[{ path: "employeeId", label: "Employee ID" }, { path: "kind", label: "Kind of time off" }, { path: "startDate", label: "First day" }, { path: "endDate", label: "Last day" }], { path: "comment", label: "Manager's comment" }],
  "scheduling.time_off.cancelled": [{ path: "id", label: "Request ID" }, { path: "employeeId", label: "Employee ID" }, { path: "kind", label: "Kind of time off" }, { path: "startDate", label: "First day" }, { path: "endDate", label: "Last day" }, { path: "wasApproved", label: "Was approved" }],
  "scheduling.time_off.rejected": [{ path: "id", label: "Request ID" }, ...[{ path: "employeeId", label: "Employee ID" }, { path: "kind", label: "Kind of time off" }, { path: "startDate", label: "First day" }, { path: "endDate", label: "Last day" }], { path: "comment", label: "Manager's comment" }],
  "scheduling.swap.requested": [{ path: "id", label: "Swap ID" }, { path: "fromEmployeeId", label: "Asked by (employee ID)" }, { path: "toEmployeeId", label: "Asked to (employee ID)" }, { path: "day", label: "Shift day" }],
  "scheduling.swap.approved": [{ path: "id", label: "Swap ID" }, { path: "fromEmployeeId", label: "Gave away (employee ID)" }, { path: "toEmployeeId", label: "Took over (employee ID)" }],
  "inventory.stock.changed": [{ path: "name", label: "Item" }, { path: "reason", label: "Reason" }, { path: "delta", label: "Change" }, { path: "stock", label: "Stock after" }, { path: "unit", label: "Unit" }, { path: "itemId", label: "Item ID" }],
  "inventory.stock.low": [{ path: "name", label: "Item" }, { path: "stock", label: "Stock" }, { path: "minStock", label: "Minimum stock" }, { path: "unit", label: "Unit" }, { path: "supplierId", label: "Supplier (company ID)" }, { path: "itemId", label: "Item ID" }],
  "inventory.order.created": [{ path: "number", label: "Order number" }, { path: "supplierId", label: "Supplier (company ID)" }, { path: "id", label: "Order ID" }],
  "inventory.order.sent": [{ path: "number", label: "Order number" }, { path: "supplierId", label: "Supplier (company ID)" }, { path: "id", label: "Order ID" }],
  "hr.employee.updated": [{ path: "userId", label: "Person (user ID)" }, { path: "changes", label: "Changed fields" }],
  "hr.pay.changed": [{ path: "userId", label: "Person (user ID)" }, { path: "effectiveFrom", label: "Effective from" }],
  "hr.document.expiring": [{ path: "personName", label: "Person" }, { path: "name", label: "Document" }, { path: "category", label: "Type" }, { path: "expiresOn", label: "Expires on" }, { path: "userId", label: "Person (user ID)" }, { path: "documentId", label: "Document ID" }],
  "hr.checklist.assigned": [{ path: "name", label: "Checklist" }, { path: "kind", label: "Kind" }, { path: "startDate", label: "Start day" }, { path: "userId", label: "Person (user ID)" }, { path: "checklistId", label: "Checklist ID" }],
  "hr.checklist.completed": [{ path: "name", label: "Checklist" }, { path: "kind", label: "Kind" }, { path: "userId", label: "Person (user ID)" }, { path: "checklistId", label: "Checklist ID" }],
  "docs.request.sent": [{ path: "title", label: "Document" }, { path: "documentId", label: "Document ID" }],
  "docs.request.signed": [{ path: "title", label: "Document" }, { path: "signerName", label: "Signer" }, { path: "signerEmail", label: "Signer email" }, { path: "documentId", label: "Document ID" }],
  "docs.request.completed": [{ path: "title", label: "Document" }, { path: "fileName", label: "File name" }, { path: "completedAt", label: "Completed at" }, { path: "employeeId", label: "Team member (user ID)" }, { path: "contactId", label: "Contact ID" }, { path: "documentId", label: "Document ID" }],
  "docs.request.declined": [{ path: "title", label: "Document" }, { path: "signerName", label: "Signer" }, { path: "signerEmail", label: "Signer email" }, { path: "reason", label: "Reason" }, { path: "documentId", label: "Document ID" }],
  "docs.request.expired": [{ path: "title", label: "Document" }, { path: "expiresOn", label: "Expired on" }, { path: "documentId", label: "Document ID" }],
  "docs.request.cancelled": [{ path: "title", label: "Document" }, { path: "reason", label: "Reason" }, { path: "documentId", label: "Document ID" }],
  "ai.summary.created": [{ path: "title", label: "Summary" }, { path: "kind", label: "Kind (meeting or ticket)" }, { path: "actionItemCount", label: "Number of action items" }, { path: "contactId", label: "Contact ID" }, { path: "dealId", label: "Deal ID" }, { path: "ticketId", label: "Ticket ID" }, { path: "summaryId", label: "Summary ID" }],
  "ai.action_items.tasks_created": [{ path: "title", label: "Summary" }, { path: "count", label: "Number of tasks" }, { path: "summaryId", label: "Summary ID" }],
  "support.ticket.created": [{ path: "number", label: "Ticket number" }, { path: "subject", label: "Subject" }, { path: "requesterEmail", label: "Customer email" }, { path: "priority", label: "Priority" }, { path: "channel", label: "Channel" }, { path: "id", label: "Ticket ID" }],
  "support.ticket.customer_replied": [{ path: "number", label: "Ticket number" }, { path: "subject", label: "Subject" }, { path: "requesterEmail", label: "Customer email" }, { path: "reopened", label: "Reopened" }, { path: "assigneeId", label: "Assignee (user ID)" }, { path: "id", label: "Ticket ID" }],
  "support.ticket.replied": [{ path: "number", label: "Ticket number" }, { path: "subject", label: "Subject" }, { path: "status", label: "New status" }, { path: "id", label: "Ticket ID" }],
  "support.ticket.assigned": [{ path: "number", label: "Ticket number" }, { path: "subject", label: "Subject" }, { path: "assigneeId", label: "Assignee (user ID)" }, { path: "id", label: "Ticket ID" }],
  "support.ticket.status_changed": [{ path: "number", label: "Ticket number" }, { path: "from", label: "Old status" }, { path: "to", label: "New status" }, { path: "id", label: "Ticket ID" }],
  "inventory.order.received": [{ path: "number", label: "Order number" }, { path: "supplierId", label: "Supplier (company ID)" }, { path: "itemsReceived", label: "Items received" }, { path: "id", label: "Order ID" }],
  "scheduling.clock.in": [{ path: "employeeId", label: "Employee ID" }, { path: "at", label: "Time" }],
  "scheduling.clock.out": [{ path: "employeeId", label: "Employee ID" }, { path: "at", label: "Time" }, { path: "minutes", label: "Minutes worked" }],
  "core.notification.requested": [{ path: "userId", label: "User ID" }, { path: "message", label: "Message" }],
  "crm.deal.deleted": [{ path: "title", label: "Deal name" }, { path: "id", label: "Deal ID" }],
  "crm.activity.logged": [
    { path: "title", label: "Deal name" }, { path: "kind", label: "Type (note, call, meeting, email)" }, { path: "body", label: "Text" },
    { path: "dealId", label: "Deal ID" }, { path: "companyId", label: "Company ID" }, { path: "contactId", label: "Contact ID" },
  ],
};

const withPrefix = (fs: EventField[], prefix = "payload.", labelPrefix = "") =>
  fs.map((f) => ({ path: `${prefix}${f.path}`, label: `${labelPrefix}${f.label}` }));

/** Details the trigger carries, as `payload.*` paths with readable labels. Empty when unknown. */
export function eventFields(event: string): EventField[] {
  const idField = { path: "payload.id", label: "Record ID" };
  const [mod, entity, verb] = event.split(".");
  if (mod === "core" && entity && ENTITY_FIELDS[entity]) {
    if (verb === "created") return [...withPrefix(ENTITY_FIELDS[entity]), idField];
    if (verb === "updated") return [idField, ...withPrefix(ENTITY_FIELDS[entity], "payload.changes.", "Changed: ")];
    if (verb === "deleted") return [idField];
  }
  if (event.startsWith("invoicing.")) return [...withPrefix(INVOICE_FIELDS), ...withPrefix(INVOICE_EXTRA[event] ?? []), { path: "payload.id", label: "Invoice ID" }];
  if (event.startsWith("expenses.expense.")) {
    const comment = event.endsWith(".approved") || event.endsWith(".rejected") ? [{ path: "comment", label: "Manager's comment" }] : [];
    return [...withPrefix([...EXPENSE_FIELDS, ...comment]), { path: "payload.id", label: "Expense ID" }];
  }
  if (event.startsWith("crm.deal.") && !OTHER_FIELDS[event]) return [...withPrefix(DEAL_FIELDS), ...withPrefix(DEAL_EXTRA[event] ?? []), { path: "payload.id", label: "Deal ID" }];
  return withPrefix(OTHER_FIELDS[event] ?? []);
}

export function fieldLabel(event: string, path: string): string {
  return eventFields(event).find((f) => f.path === path)?.label ?? path;
}

// ── Recipes ──────────────────────────────────────────────────────────────────
export interface Recipe { id: string; title: string; description: string; event: string; build(): WorkflowInput }

export const RECIPES: Recipe[] = [
  {
    id: "follow-up-contact", title: "Follow up new contacts", event: "core.contact.created",
    description: "When a contact is added, create a task to get in touch within 2 days.",
    build: () => ({
      name: "Follow up new contacts", enabled: true, trigger: { event: "core.contact.created" }, conditions: null,
      actions: [{ key: "core.create_task", input: { title: "Follow up with {{payload.firstName}} {{payload.lastName}}", description: "Email: {{payload.email}}", dueInDays: 2 } }],
    }),
  },
  {
    id: "chase-overdue", title: "Chase overdue invoices", event: "invoicing.invoice.overdue",
    description: "When an invoice becomes overdue, log a reminder and create a task to call the customer.",
    build: () => ({
      name: "Chase overdue invoices", enabled: true, trigger: { event: "invoicing.invoice.overdue" }, conditions: null,
      actions: [
        { key: "invoicing.send_reminder", input: { invoiceId: "{{payload.id}}" } },
        { key: "core.create_task", input: { title: "Call {{payload.customerName}} about invoice {{payload.number}}", dueInDays: 1 } },
      ],
    }),
  },
  {
    id: "invoice-paid", title: "Tell me when I get paid", event: "invoicing.invoice.paid",
    description: "When an invoice is fully paid, send a notification.",
    build: () => ({
      name: "Invoice paid notification", enabled: true, trigger: { event: "invoicing.invoice.paid" }, conditions: null,
      actions: [{ key: "core.notify", input: { message: "Invoice {{payload.number}} from {{payload.customerName}} has been paid." } }],
    }),
  },
  {
    id: "deal-won-kickoff", title: "Kick off won deals", event: "crm.deal.won",
    description: "When a deal is won, create a kickoff task and send a notification.",
    build: () => ({
      name: "Kick off won deals", enabled: true, trigger: { event: "crm.deal.won" }, conditions: null,
      actions: [
        { key: "core.create_task", input: { title: "Kick off: {{payload.title}}", dueInDays: 2 } },
        { key: "core.notify", input: { message: "Deal won: {{payload.title}}" } },
      ],
    }),
  },
  {
    id: "deal-for-company", title: "Open a deal for new companies", event: "core.company.created",
    description: "When a company is added, create a deal in the first stage of your pipeline.",
    build: () => ({
      name: "Open a deal for new companies", enabled: true, trigger: { event: "core.company.created" }, conditions: null,
      actions: [{ key: "crm.create_deal", input: { title: "New business: {{payload.name}}", companyId: "{{payload.id}}" } }],
    }),
  },
  {
    id: "onboard-member", title: "Onboard new team members", event: "core.member.added",
    description: "When someone joins the workspace, create an onboarding task.",
    build: () => ({
      name: "Onboard new team members", enabled: true, trigger: { event: "core.member.added" }, conditions: null,
      actions: [{ key: "core.create_task", input: { title: "Onboard new team member", dueInDays: 3 } }],
    }),
  },
];

/** Recipes whose trigger exists in this workspace (e.g. invoicing ones only when Invoicing is installed). */
export const recipesFor = (events: string[], actions?: string[]) =>
  RECIPES.filter((r) => events.includes(r.event) && (!actions || r.build().actions.every((a) => actions.includes(a.key))));
