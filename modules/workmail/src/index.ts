import { fileURLToPath } from "node:url";
import { z } from "zod";
import { defineModule, route } from "@office/sdk";
import {
  checkDomain, config, ConnectInput, connectDomain, confirmOrder, createMailbox, deleteMailbox, listDomains, listMailboxes, MailboxInput,
  MailboxListQuery, OrderInput, orderDomain, removeDomain, resetPassword, resumeMailbox, SearchQuery, searchDomains, suspendForUser,
  suspendMailbox, setFeature, transferOut,
} from "./service.ts";

export { configureWorkmail, getProvider, ProviderError } from "./provider.ts";
export type { WorkmailProvider, WorkmailPayments, DomainOffer, DnsRecord, Registrant, MailboxPrice } from "./provider.ts";
export { fakeProvider, freePayments } from "./fake-provider.ts";
export type { FakeProvider } from "./fake-provider.ts";

const READ = "workmail:mailbox.read", WRITE = "workmail:mailbox.write", DOMAIN = "workmail:domain.manage";
const Id = z.object({ id: z.uuid() });

const EVENTS = ["workmail.domain.registered", "workmail.mailbox.created", "workmail.mailbox.suspended", "workmail.mailbox.deleted"];

export default defineModule({
  manifest: {
    key: "workmail",
    name: "Work email",
    version: "1.0.0",
    office: "^1.0",
    description: "A company domain (like yourcompany.com) and work mailboxes for your colleagues, set up for you. Paid extra.",
    permissions: {
      declares: [
        { key: READ, label: "See work mailboxes (members see only their own)" },
        { key: WRITE, label: "Create, switch off and delete work mailboxes" },
        { key: DOMAIN, label: "Buy, connect and move company domains" },
      ],
      requires: ["core:members.read"],
    },
    icon: "at-sign",
    category: "operations",
    roles: { manager: [READ, WRITE], member: [READ], viewer: [] },
    entities: ["domain", "mailbox"],
    events: { emits: EVENTS.map((type) => ({ type })), subscribes: ["core.member.removed"] },
    ui: {
      slots: [
        { slot: "nav.main", label: "Work email", icon: "at-sign", route: "/email", permission: READ },
      ],
    },
    settings: {
      type: "object",
      properties: {
        maxMailboxes: { type: "integer", title: "Most mailboxes (each one is paid per month)", default: 10, minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    },
    api: { basePath: "/workmail" },
  },
  migrationsDir: fileURLToPath(new URL("../migrations", import.meta.url)),
  handlers: {
    // Removing a colleague switches their work mailbox off (nothing is deleted; the owner can turn it back on).
    "core.member.removed": async (ctx, e) => {
      const userId = e.payload.userId;
      if (typeof userId === "string") await suspendForUser(ctx, userId);
    },
  },
  lifecycle: {
    enable: async (ctx) => { await setFeature(ctx, true); },
    disable: async (ctx) => { await setFeature(ctx, false); },
  },
  routes: [
    route({ method: "GET", path: "/config", permission: READ, handler: (ctx) => config(ctx) }),
    route({ method: "GET", path: "/domains/search", permission: DOMAIN, query: SearchQuery, handler: (ctx, { query }) => searchDomains(ctx, query.q) }),
    route({ method: "GET", path: "/domains", permission: READ, handler: (ctx) => listDomains(ctx) }),
    route({ method: "POST", path: "/domains/order", permission: DOMAIN, status: 201, body: OrderInput, handler: (ctx, { body }) => orderDomain(ctx, body) }),
    route({ method: "POST", path: "/domains/connect", permission: DOMAIN, status: 201, body: ConnectInput, handler: (ctx, { body }) => connectDomain(ctx, body) }),
    route({ method: "POST", path: "/domains/:id/confirm", permission: DOMAIN, params: Id, handler: (ctx, { params }) => confirmOrder(ctx, params.id) }),
    route({ method: "POST", path: "/domains/:id/check", permission: DOMAIN, params: Id, handler: (ctx, { params }) => checkDomain(ctx, params.id) }),
    route({ method: "POST", path: "/domains/:id/transfer-out", permission: DOMAIN, params: Id, handler: (ctx, { params }) => transferOut(ctx, params.id) }),
    route({ method: "DELETE", path: "/domains/:id", permission: DOMAIN, params: Id, status: 204, handler: (ctx, { params }) => removeDomain(ctx, params.id) }),
    route({ method: "GET", path: "/mailboxes", permission: READ, query: MailboxListQuery, handler: (ctx, { query }) => listMailboxes(ctx, query) }),
    route({ method: "POST", path: "/mailboxes", permission: WRITE, status: 201, body: MailboxInput, handler: (ctx, { body }) => createMailbox(ctx, body) }),
    route({ method: "POST", path: "/mailboxes/:id/suspend", permission: WRITE, params: Id, handler: (ctx, { params }) => suspendMailbox(ctx, params.id) }),
    route({ method: "POST", path: "/mailboxes/:id/resume", permission: WRITE, params: Id, handler: (ctx, { params }) => resumeMailbox(ctx, params.id) }),
    route({ method: "POST", path: "/mailboxes/:id/reset-password", permission: WRITE, params: Id, handler: (ctx, { params }) => resetPassword(ctx, params.id) }),
    route({ method: "DELETE", path: "/mailboxes/:id", permission: WRITE, params: Id, status: 204, handler: (ctx, { params }) => deleteMailbox(ctx, params.id) }),
  ],
});
