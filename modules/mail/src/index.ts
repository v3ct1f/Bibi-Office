import { fileURLToPath } from "node:url";
import { z } from "zod";
import { defineModule, job, route } from "@office/sdk";
import {
  AccountPatch, act, ActionInput, addAttachment, addContact, addLead, AttachmentInput, AttachmentParams, createDraft, createLabel, deleteDraft,
  deleteLabel, DraftInput, DraftPatch, downloadAttachment, emptyTrash, folders, getAccount, getMessage, getThread, Id, LabelInput, LabelPatch,
  cleanUpJob, listThreads, MessagePatch, requestLink, syncJob, onMailboxCreated, onMailboxState, patchAccount, patchMessage, removeAttachment, saveDraft, sendDraft, sync,
  ThreadsQuery, unread, updateLabel, USE,
} from "./service.ts";

export { configureMail, getMailProvider, getMailLimits, DEFAULT_QUOTA_BYTES, MailProviderError } from "./provider.ts";
export type { MailProvider, IncomingMail, OutgoingMail, Party, MailFile, ProviderAccount, RemoteChange, RemoteChangeResult, RemoteFlags } from "./provider.ts";
export { fakeMailProvider } from "./fake-provider.ts";
export { imapMailProvider, imapProviderFromEnv, masterLogin } from "./imap-provider.ts";
export { mailProviderFromEnv } from "./env.ts";
export type { FakeMailProvider } from "./fake-provider.ts";
export { sanitizeHtml, htmlToText } from "./sanitize.ts";

const ThreadParams = z.object({ id: z.uuid() });
const ThreadQuery = z.object({ folder: z.string().max(20).optional() });

export default defineModule({
  manifest: {
    key: "mail",
    name: "Mail",
    version: "1.0.0",
    office: "^1.0",
    description: "Your own private inbox inside Office, like Gmail: read, write and organise your work email. Nobody else can see it, not even the owner.",
    permissions: {
      declares: [{ key: USE, label: "Use my own mailbox" }],
      requires: ["core:members.read", "core:contacts.read", "core:contacts.write"],
    },
    icon: "mail",
    category: "operations",
    roles: { manager: [USE], member: [USE], viewer: [USE] },
    entities: ["message", "label"],
    events: {
      emits: [{ type: "mail.lead.requested" }, { type: "mail.mailboxes.requested" }],
      subscribes: ["workmail.mailbox.created", "workmail.mailbox.suspended", "workmail.mailbox.resumed", "workmail.mailbox.deleted"],
    },
    ui: {
      slots: [{ slot: "nav.main", label: "Mail", icon: "mail", route: "/inbox", permission: USE, badge: "/unread" }],
    },
    api: { basePath: "/mail" },
  },
  migrationsDir: fileURLToPath(new URL("../migrations", import.meta.url)),
  handlers: {
    // A work mailbox made for a colleague becomes their mailbox here; switching it off pauses it.
    "workmail.mailbox.created": async (ctx, e) => { await onMailboxCreated(ctx, e.payload); },
    "workmail.mailbox.suspended": async (ctx, e) => { await onMailboxState(ctx, e.payload, "paused"); },
    "workmail.mailbox.deleted": async (ctx, e) => { await onMailboxState(ctx, e.payload, "paused"); },
    "workmail.mailbox.resumed": async (ctx, e) => { await onMailboxState(ctx, e.payload, "active"); },
  },
  lifecycle: {
    // Mailboxes made in Work email before Mail was turned on: ask for all of them again (Work email answers with its events).
    enable: async (ctx) => { await ctx.events.emit("mail.mailboxes.requested", { userId: null }); },
  },
  jobs: {
    // Only does something with a real mail server (MAIL_PROVIDER=imap); the pretend one is read when the page asks.
    sync_mail: job({ label: "Fetch new mail and write changes back to the mail server", everyMinutes: 1, run: async (ctx) => { await syncJob(ctx); } }),
    clean_up: job({ label: "Delete mail that has been in Trash or Spam for 30 days", everyMinutes: 60, run: async (ctx) => { await cleanUpJob(ctx); } }),
  },
  routes: [
    route({ method: "GET", path: "/account", permission: USE, handler: (ctx) => getAccount(ctx) }),
    route({ method: "POST", path: "/account/link", permission: USE, handler: (ctx) => requestLink(ctx) }),
    route({ method: "PATCH", path: "/account", permission: USE, body: AccountPatch, handler: (ctx, { body }) => patchAccount(ctx, body) }),
    route({ method: "GET", path: "/unread", permission: USE, handler: (ctx) => unread(ctx) }),
    route({ method: "POST", path: "/sync", permission: USE, handler: (ctx) => sync(ctx) }),
    route({ method: "GET", path: "/folders", permission: USE, handler: (ctx) => folders(ctx) }),
    route({ method: "POST", path: "/folders/trash/empty", permission: USE, handler: (ctx) => emptyTrash(ctx) }),
    route({ method: "GET", path: "/threads", permission: USE, query: ThreadsQuery, handler: (ctx, { query }) => listThreads(ctx, query) }),
    route({ method: "GET", path: "/threads/:id", permission: USE, params: ThreadParams, query: ThreadQuery, handler: (ctx, { params, query }) => getThread(ctx, params.id, query.folder) }),
    route({ method: "POST", path: "/threads/action", permission: USE, body: ActionInput, handler: (ctx, { body }) => act(ctx, body) }),
    route({ method: "GET", path: "/messages/:id", permission: USE, params: Id, handler: (ctx, { params }) => getMessage(ctx, params.id) }),
    route({ method: "PATCH", path: "/messages/:id", permission: USE, params: Id, body: MessagePatch, handler: (ctx, { params, body }) => patchMessage(ctx, params.id, body) }),
    route({ method: "POST", path: "/messages/:id/add-contact", permission: USE, params: Id, handler: (ctx, { params }) => addContact(ctx, params.id) }),
    route({ method: "POST", path: "/messages/:id/add-lead", permission: USE, params: Id, handler: (ctx, { params }) => addLead(ctx, params.id) }),
    route({ method: "GET", path: "/attachments/:id", permission: USE, params: Id, handler: (ctx, { params }) => downloadAttachment(ctx, params.id) }),
    route({ method: "POST", path: "/drafts", permission: USE, status: 201, body: DraftInput, handler: (ctx, { body }) => createDraft(ctx, body) }),
    route({ method: "PUT", path: "/drafts/:id", permission: USE, params: Id, body: DraftPatch, handler: (ctx, { params, body }) => saveDraft(ctx, params.id, body) }),
    route({ method: "DELETE", path: "/drafts/:id", permission: USE, params: Id, status: 204, handler: (ctx, { params }) => deleteDraft(ctx, params.id) }),
    route({
      method: "POST", path: "/drafts/:id/attachments", permission: USE, params: Id, body: AttachmentInput, status: 201, bodyLimit: 8 * 1024 * 1024,
      handler: (ctx, { params, body }) => addAttachment(ctx, params.id, body),
    }),
    route({
      method: "DELETE", path: "/drafts/:id/attachments/:attId", permission: USE, params: AttachmentParams, status: 204,
      handler: (ctx, { params }) => removeAttachment(ctx, params.id, params.attId),
    }),
    route({ method: "POST", path: "/drafts/:id/send", permission: USE, params: Id, handler: (ctx, { params }) => sendDraft(ctx, params.id) }),
    route({ method: "POST", path: "/labels", permission: USE, status: 201, body: LabelInput, handler: (ctx, { body }) => createLabel(ctx, body) }),
    route({ method: "PATCH", path: "/labels/:id", permission: USE, params: Id, body: LabelPatch, handler: (ctx, { params, body }) => updateLabel(ctx, params.id, body) }),
    route({ method: "DELETE", path: "/labels/:id", permission: USE, params: Id, status: 204, handler: (ctx, { params }) => deleteLabel(ctx, params.id) }),
  ],
});
