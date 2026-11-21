import { metrics } from "./metrics.ts";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { defineModule, job, route } from "@office/sdk";
import {
  addNote, addReply, checkMail, config, createMacro, createTicket, deleteMacro, deleteTicket, getFile, getTicket, listMacros, listTargets,
  listTickets, MacroInput, NewTicketInput, NoteInput, P, renderMacro, ReplyInput, retryFailed, retrySend, saveTargets, summary, TargetsInput,
  testMailbox, TicketPatch, TicketQuery, updateMacro, updateTicket,
} from "./service.ts";

const Id = z.object({ id: z.uuid() });
const EVENTS = ["support.ticket.created", "support.ticket.customer_replied", "support.ticket.replied", "support.ticket.assigned", "support.ticket.status_changed"];
const sec = (title: string, d: string) => ({ type: "string", title, enum: ["tls", "starttls", "none"], default: d, description: "tls = SSL/TLS (usually port 993 / 465), starttls = STARTTLS (143 / 587)" });

export default defineModule({
  manifest: {
    key: "support",
    name: "Support inbox",
    version: "1.0.0",
    office: "^1.0",
    description: "Turn your support email into tickets. Reply by email from one shared inbox, assign tickets, leave internal notes, use saved replies, see each customer's history, and track response-time targets.",
    icon: "inbox",
    category: "sales",
    permissions: {
      declares: [
        { key: P.READ, label: "See tickets and conversations" },
        { key: P.REPLY, label: "Reply to customers, add notes, assign and update tickets" },
        { key: P.MANAGE, label: "Manage saved replies, response targets and the mailbox; delete tickets" },
      ],
      requires: ["core:contacts.read", "core:contacts.write", "core:members.read"],
    },
    roles: { manager: [P.READ, P.REPLY, P.MANAGE], member: [P.READ, P.REPLY], viewer: [P.READ] },
    entities: ["ticket"],
    events: { emits: EVENTS.map((type) => ({ type })), subscribes: [] },
    workflow: { triggers: EVENTS, actions: [] },
    ui: {
      slots: [
        { slot: "nav.main", label: "Support", icon: "inbox", route: "/support", permission: P.READ },
        { slot: "nav.settings", label: "Support", icon: "inbox", route: "/support/settings", permission: P.READ },
        { slot: "dashboard.widget", label: "Support tickets", component: "SupportWidget", permission: P.READ },
      ],
    },
    settings: {
      type: "object",
      properties: {
        address: { type: "string", title: "Support email address", pattern: "^[^@ ]+@[^@ ]+[.][^@ ]+$", maxLength: 320, description: "Customers write here, and replies come from it, e.g. help@yourshop.com" },
        fromName: { type: "string", title: "Sender name", default: "Support", maxLength: 100 },
        folder: { type: "string", title: "Folder to read", default: "INBOX", maxLength: 200 },
        imapHost: { type: "string", title: "Incoming server (IMAP)", maxLength: 255 },
        imapPort: { type: "integer", title: "IMAP port", minimum: 1, maximum: 65535, default: 993 },
        imapSecurity: sec("IMAP security", "tls"),
        imapUser: { type: "string", title: "IMAP user name", description: "Usually the email address", maxLength: 320 },
        imapPassword: { type: "string", title: "IMAP password", "x-secret": true, maxLength: 500 },
        smtpHost: { type: "string", title: "Outgoing server (SMTP)", maxLength: 255 },
        smtpPort: { type: "integer", title: "SMTP port", minimum: 1, maximum: 65535, default: 465 },
        smtpSecurity: sec("SMTP security", "tls"),
        smtpUser: { type: "string", title: "SMTP user name", description: "Usually the email address", maxLength: 320 },
        smtpPassword: { type: "string", title: "SMTP password", "x-secret": true, maxLength: 500 },
      },
      additionalProperties: false,
    },
    api: { basePath: "/support" },
  },
  migrationsDir: fileURLToPath(new URL("../migrations", import.meta.url)),
  metrics,
  routes: [
    route({ method: "GET", path: "/config", permission: P.READ, handler: (ctx) => config(ctx) }),
    route({ method: "GET", path: "/summary", permission: P.READ, handler: (ctx) => summary(ctx) }),
    route({ method: "POST", path: "/mailbox/fetch", permission: P.REPLY, handler: (ctx) => checkMail(ctx) }),
    route({ method: "POST", path: "/mailbox/test", permission: P.MANAGE, handler: (ctx) => testMailbox(ctx) }),

    route({ method: "GET", path: "/tickets", permission: P.READ, query: TicketQuery, handler: (ctx, { query }) => listTickets(ctx, query) }),
    route({ method: "POST", path: "/tickets", permission: P.REPLY, status: 201, body: NewTicketInput, handler: (ctx, { body }) => createTicket(ctx, body) }),
    route({ method: "GET", path: "/tickets/:id", permission: P.READ, params: Id, handler: (ctx, { params }) => getTicket(ctx, params.id) }),
    route({ method: "PATCH", path: "/tickets/:id", permission: P.REPLY, params: Id, body: TicketPatch, handler: (ctx, { params, body }) => updateTicket(ctx, params.id, body) }),
    route({ method: "DELETE", path: "/tickets/:id", permission: P.MANAGE, params: Id, status: 204, handler: (ctx, { params }) => deleteTicket(ctx, params.id) }),
    route({ method: "POST", path: "/tickets/:id/reply", permission: P.REPLY, params: Id, body: ReplyInput, handler: (ctx, { params, body }) => addReply(ctx, params.id, body) }),
    route({ method: "POST", path: "/tickets/:id/notes", permission: P.REPLY, params: Id, status: 201, body: NoteInput, handler: (ctx, { params, body }) => addNote(ctx, params.id, body.body) }),
    route({
      method: "POST", path: "/tickets/:id/messages/:messageId/retry", permission: P.REPLY, params: z.object({ id: z.uuid(), messageId: z.uuid() }),
      handler: (ctx, { params }) => retrySend(ctx, params.id, params.messageId),
    }),
    route({
      method: "GET", path: "/tickets/:id/macros/:macroId", permission: P.REPLY, params: z.object({ id: z.uuid(), macroId: z.uuid() }),
      handler: (ctx, { params }) => renderMacro(ctx, params.id, params.macroId),
    }),
    route({ method: "GET", path: "/files/:id", permission: P.READ, params: Id, handler: (ctx, { params }) => getFile(ctx, params.id) }),

    route({ method: "GET", path: "/macros", permission: P.READ, handler: (ctx) => listMacros(ctx) }),
    route({ method: "POST", path: "/macros", permission: P.MANAGE, status: 201, body: MacroInput, handler: (ctx, { body }) => createMacro(ctx, body) }),
    route({ method: "PATCH", path: "/macros/:id", permission: P.MANAGE, params: Id, body: MacroInput.partial(), handler: (ctx, { params, body }) => updateMacro(ctx, params.id, body) }),
    route({ method: "DELETE", path: "/macros/:id", permission: P.MANAGE, params: Id, status: 204, handler: (ctx, { params }) => deleteMacro(ctx, params.id) }),

    route({ method: "GET", path: "/targets", permission: P.READ, handler: (ctx) => listTargets(ctx) }),
    route({ method: "PUT", path: "/targets", permission: P.MANAGE, body: TargetsInput, handler: (ctx, { body }) => saveTargets(ctx, body) }),
  ],
  jobs: {
    fetch_mail: job({ label: "Fetch new support email", everyMinutes: 1, run: async (ctx) => { await checkMail(ctx); } }),
    retry_failed_sends: job({ label: "Retry replies that failed to send", everyMinutes: 5, run: retryFailed }),
  },
});
