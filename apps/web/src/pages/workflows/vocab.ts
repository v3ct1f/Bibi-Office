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
};

const GROUP_NAMES: Record<string, string> = { crm: "Deals (CRM)", invoicing: "Invoicing" };

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

const OTHER_FIELDS: Record<string, EventField[]> = {
  "core.tenant.created": [{ path: "slug", label: "Workspace slug" }],
  "core.member.added": [{ path: "userId", label: "User ID" }, { path: "roles", label: "Roles" }],
  "core.member.removed": [{ path: "userId", label: "User ID" }],
  "core.module.enabled": [{ path: "key", label: "Module key" }, { path: "version", label: "Module version" }],
  "core.module.disabled": [{ path: "key", label: "Module key" }],
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
