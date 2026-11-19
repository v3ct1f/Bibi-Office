import { fileURLToPath } from "node:url";
import { z } from "zod";
import { action, defineModule, moduleErrors as E, publicRoute, route } from "@office/sdk";
import {
  addNote, checkSla, counts, createInternalTicket, getTicket, linkContact, ListQuery, listTickets, inboxInfo, NoteIn, P, PublicFormIn,
  receiveMail, reply, ReplyIn, SETTINGS_SCHEMA, settingsOf, submitPublicForm, summary, TicketIn, TicketPatch, updateTicket,
} from "./service.ts";

const Id = z.object({ id: z.uuid() });
const EVENTS = ["created", "assigned", "status_changed", "replied", "customer_replied", "sla_breached"].map((e) => `support.ticket.${e}`);

export default defineModule({
  manifest: {
    key: "support",
    name: "Support inbox",
    version: "1.0.0",
    office: "^1.0",
    description: "Shared inbox for customer requests: email and a contact form become numbered tickets with replies, notes, assignment and first-reply targets.",
    dependsOn: [],
    permissions: {
      declares: [
        { key: P.read, label: "View tickets", defaultRoles: ["member"] },
        { key: P.work, label: "Reply, add notes, take and close tickets", defaultRoles: ["member"] },
        { key: P.manage, label: "Assign tickets to anyone" },
      ],
      requires: ["core:contacts.read", "core:contacts.write", "core:mail.send"],
    },
    entities: ["ticket"],
    events: { emits: EVENTS.map((type) => ({ type })), subscribes: ["support.ticket.created"] },
    workflow: {
      triggers: EVENTS,
      actions: [
        { key: "support.assign", label: "Assign ticket" },
        { key: "support.set_status", label: "Set ticket status" },
      ],
    },
    ui: {
      slots: [
        { slot: "nav.main", label: "Support", icon: "inbox", route: "/inbox", permission: P.read },
        { slot: "entity.tab:contact", label: "Tickets", component: "TicketsTab", permission: P.read },
        { slot: "dashboard.widget", label: "Support", component: "QueueWidget", permission: P.read },
      ],
    },
    settings: SETTINGS_SCHEMA as unknown as Record<string, unknown>,
    api: { basePath: "/support" },
    lifecycle: [],
  },
  migrationsDir: fileURLToPath(new URL("../migrations", import.meta.url)),
  routes: [
    route({ method: "GET", path: "/tickets", permission: P.read, query: ListQuery, handler: (ctx, { query }) => listTickets(ctx, query) }),
    route({ method: "GET", path: "/counts", permission: P.read, handler: (ctx) => counts(ctx) }),
    route({ method: "GET", path: "/summary", permission: P.read, handler: (ctx) => summary(ctx) }),
    route({ method: "GET", path: "/meta", permission: P.read, handler: (ctx) => inboxInfo(ctx) }),
    route({ method: "POST", path: "/tickets", permission: P.work, body: TicketIn, status: 201, handler: (ctx, { body }) => createInternalTicket(ctx, body) }),
    route({ method: "GET", path: "/tickets/:id", permission: P.read, params: Id, handler: (ctx, { params }) => getTicket(ctx, params.id) }),
    route({ method: "PATCH", path: "/tickets/:id", permission: P.work, params: Id, body: TicketPatch, handler: (ctx, { params, body }) => updateTicket(ctx, params.id, body) }),
    route({ method: "POST", path: "/tickets/:id/reply", permission: P.work, params: Id, body: ReplyIn, handler: (ctx, { params, body }) => reply(ctx, params.id, body) }),
    route({ method: "POST", path: "/tickets/:id/notes", permission: P.work, params: Id, body: NoteIn, handler: (ctx, { params, body }) => addNote(ctx, params.id, body) }),
  ],
  publicRoutes: [
    publicRoute({
      method: "GET", path: "/form",
      handler: async (ctx) => {
        const s = settingsOf(ctx);
        if (!s.publicForm) throw E.notFound("Page");
        return { title: s.formTitle || null, teamName: s.teamName };
      },
    }),
    publicRoute({ method: "POST", path: "/form", body: PublicFormIn, status: 201, handler: (ctx, { body }) => submitPublicForm(ctx, body) }),
  ],
  inboundMail: (ctx, mail) => receiveMail(ctx, mail),
  handlers: {
    // Every ticket ends up linked to a core contact (found by email or created).
    "support.ticket.created": async (ctx, e) => {
      const id = (e.payload as { id?: unknown }).id;
      if (typeof id === "string") await linkContact(ctx, id);
    },
  },
  jobs: { "sla-check": { everySeconds: 300, run: (ctx) => checkSla(ctx) } },
  actions: {
    "support.assign": action({
      label: "Assign ticket",
      input: z.object({ id: z.uuid().describe("ticket id, e.g. {{payload.id}}"), assigneeId: z.uuid().nullable().describe("member user id, or null to unassign") }),
      run: async (ctx, i) => { const t = await updateTicket(ctx, i.id, { assigneeId: i.assigneeId }); return { id: t.id, assigneeId: t.assigneeId }; },
    }),
    "support.set_status": action({
      label: "Set ticket status",
      input: z.object({ id: z.uuid(), status: z.enum(["open", "pending", "solved"]) }),
      run: async (ctx, i) => { const t = await updateTicket(ctx, i.id, { status: i.status }); return { id: t.id, status: t.status }; },
    }),
  },
});
