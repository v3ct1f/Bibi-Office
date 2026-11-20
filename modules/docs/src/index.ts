import { fileURLToPath } from "node:url";
import { z } from "zod";
import { defineModule, job, publicRoute, route } from "@office/sdk";
import {
  cancelRequest, CancelInput, config, createFromTemplate, createRequest, createTemplate, DeclineInput, deleteDocument, deleteTemplate, DocumentPatch,
  FileInput, FileQuery, getDocument, getFile, ListQuery, listDocuments, listTemplates, mySigningLink, P, publicDecline, publicDownload, publicSign,
  publicView, remindSigner, replaceLink, RequestInput, requestFromFile, sendRequest, SendInput, setupRequest, SetupInput, SignInput, summary, sweep,
  teamPeople, TemplateInput, TemplateRequestInput, testEmail, Token, updateDocument, updateTemplate, uploadFile, waitingForMe,
} from "./service.ts";

const Id = z.object({ id: z.uuid() });
const MB10 = 10 * 1024 * 1024;
const EVENTS = ["docs.request.sent", "docs.request.signed", "docs.request.completed", "docs.request.declined", "docs.request.expired", "docs.request.cancelled"];
const sec = (title: string) => ({ type: "string", title, enum: ["tls", "starttls", "none"], default: "tls", description: "tls = SSL/TLS (usually port 465), starttls = STARTTLS (587)" });

export default defineModule({
  manifest: {
    key: "docs",
    name: "Docs & e-sign",
    version: "1.0.0",
    office: "^1.0",
    description: "A document library with folders, and PDF signature requests: upload a PDF or fill in a template, place signature boxes, and email private signing links to customers and staff, with signing order, reminders and expiry. The signed copy gets a certificate page.",
    icon: "file",
    category: "operations",
    permissions: {
      declares: [
        { key: P.READ, label: "See shared documents and your own, and sign documents sent to you" },
        { key: P.SEND, label: "Upload documents and send documents for signature" },
        { key: P.MANAGE, label: "See and manage everyone's documents, and manage templates" },
      ],
      requires: ["core:members.read"],
    },
    roles: { manager: [P.READ, P.SEND, P.MANAGE], member: [P.READ, P.SEND], viewer: [P.READ] },
    entities: ["document"],
    events: { emits: EVENTS.map((type) => ({ type })), subscribes: [] },
    workflow: { triggers: EVENTS, actions: [] },
    ui: {
      slots: [
        { slot: "nav.main", label: "Docs", icon: "file", route: "/docs", permission: P.READ },
        { slot: "dashboard.widget", label: "Documents", component: "DocsWidget", permission: P.READ },
        { slot: "global.create", label: "Document for signature", route: "/docs/new", permission: P.SEND },
        { slot: "entity.tab:contact", label: "Documents", component: "ContactDocsTab", permission: P.READ },
      ],
    },
    settings: {
      type: "object",
      properties: {
        fromAddress: { type: "string", title: "Send from (email address)", description: "Signing emails come from this address.", maxLength: 320, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" },
        fromName: { type: "string", title: "Sender name", description: "For example your company name.", maxLength: 100 },
        smtpHost: { type: "string", title: "Outgoing mail server (SMTP)", description: "For example smtp.gmail.com. You can use the same details as your Support mailbox.", maxLength: 255 },
        smtpPort: { type: "integer", title: "SMTP port", minimum: 1, maximum: 65535, default: 465 },
        smtpSecurity: sec("SMTP security"),
        smtpUser: { type: "string", title: "SMTP user name", description: "Usually the email address", maxLength: 320 },
        smtpPassword: { type: "string", title: "SMTP password", "x-secret": true, maxLength: 500 },
        remindEveryDays: { type: "integer", title: "Remind signers every (days)", description: "0 = no automatic reminders. Can be changed per document.", default: 3, minimum: 0, maximum: 30 },
        expiryDays: { type: "integer", title: "Signing links expire after (days)", description: "0 = never. Can be changed per document.", default: 30, minimum: 0, maximum: 365 },
      },
      additionalProperties: false,
    },
    api: { basePath: "/docs" },
  },
  migrationsDir: fileURLToPath(new URL("../migrations", import.meta.url)),
  routes: [
    route({ method: "GET", path: "/config", permission: P.READ, handler: (ctx) => config(ctx) }),
    route({ method: "GET", path: "/summary", permission: P.READ, handler: (ctx) => summary(ctx) }),
    route({ method: "GET", path: "/people", permission: P.SEND, handler: (ctx) => teamPeople(ctx) }),
    route({ method: "POST", path: "/email/test", permission: P.MANAGE, handler: (ctx) => testEmail(ctx) }),

    route({ method: "GET", path: "/documents", permission: P.READ, query: ListQuery, handler: (ctx, { query }) => listDocuments(ctx, query) }),
    route({ method: "POST", path: "/documents", permission: P.SEND, status: 201, body: FileInput, bodyLimit: MB10, handler: (ctx, { body }) => uploadFile(ctx, body) }),
    route({ method: "GET", path: "/documents/:id", permission: P.READ, params: Id, handler: (ctx, { params }) => getDocument(ctx, params.id) }),
    route({ method: "GET", path: "/documents/:id/file", permission: P.READ, params: Id, query: FileQuery, handler: (ctx, { params, query }) => getFile(ctx, params.id, query.version) }),
    route({ method: "PATCH", path: "/documents/:id", permission: P.READ, params: Id, body: DocumentPatch, handler: (ctx, { params, body }) => updateDocument(ctx, params.id, body) }),
    route({ method: "DELETE", path: "/documents/:id", permission: P.READ, params: Id, status: 204, handler: (ctx, { params }) => deleteDocument(ctx, params.id) }),

    route({ method: "POST", path: "/requests", permission: P.SEND, status: 201, body: RequestInput, bodyLimit: MB10, handler: (ctx, { body }) => createRequest(ctx, body) }),
    route({ method: "POST", path: "/requests/from-template", permission: P.SEND, status: 201, body: TemplateRequestInput, handler: (ctx, { body }) => createFromTemplate(ctx, body) }),
    route({ method: "POST", path: "/documents/:id/request", permission: P.SEND, params: Id, handler: (ctx, { params }) => requestFromFile(ctx, params.id) }),
    route({ method: "PUT", path: "/documents/:id/setup", permission: P.SEND, params: Id, body: SetupInput, handler: (ctx, { params, body }) => setupRequest(ctx, params.id, body) }),
    route({ method: "POST", path: "/documents/:id/send", permission: P.SEND, params: Id, body: SendInput, handler: (ctx, { params, body }) => sendRequest(ctx, params.id, body) }),
    route({ method: "POST", path: "/documents/:id/cancel", permission: P.SEND, params: Id, body: CancelInput, handler: (ctx, { params, body }) => cancelRequest(ctx, params.id, body.reason) }),
    route({ method: "POST", path: "/signers/:id/new-link", permission: P.SEND, params: Id, handler: (ctx, { params }) => replaceLink(ctx, params.id) }),
    route({ method: "POST", path: "/signers/:id/remind", permission: P.SEND, params: Id, handler: (ctx, { params }) => remindSigner(ctx, params.id) }),

    route({ method: "GET", path: "/waiting", permission: P.READ, handler: (ctx) => waitingForMe(ctx) }),
    route({ method: "POST", path: "/documents/:id/my-link", permission: P.READ, params: Id, handler: (ctx, { params }) => mySigningLink(ctx, params.id) }),

    route({ method: "GET", path: "/templates", permission: P.SEND, handler: (ctx) => listTemplates(ctx) }),
    route({ method: "POST", path: "/templates", permission: P.MANAGE, status: 201, body: TemplateInput, handler: (ctx, { body }) => createTemplate(ctx, body) }),
    route({ method: "PUT", path: "/templates/:id", permission: P.MANAGE, params: Id, body: TemplateInput, handler: (ctx, { params, body }) => updateTemplate(ctx, params.id, body) }),
    route({ method: "DELETE", path: "/templates/:id", permission: P.MANAGE, params: Id, status: 204, handler: (ctx, { params }) => deleteTemplate(ctx, params.id) }),
  ],
  publicRoutes: [
    publicRoute({ method: "GET", path: "/sign/:token", params: Token, handler: (ctx, { params, client }) => publicView(ctx, params.token, client) }),
    publicRoute({ method: "POST", path: "/sign/:token", params: Token, body: SignInput, bodyLimit: 2 * 1024 * 1024, handler: (ctx, { params, body, client }) => publicSign(ctx, params.token, body, client) }),
    publicRoute({ method: "POST", path: "/sign/:token/decline", params: Token, body: DeclineInput, handler: (ctx, { params, body, client }) => publicDecline(ctx, params.token, body.reason, client) }),
    publicRoute({ method: "GET", path: "/sign/:token/download", params: Token, handler: (ctx, { params }) => publicDownload(ctx, params.token) }),
  ],
  jobs: {
    reminders: job({ label: "Send signing reminders and expire old requests", everyMinutes: 60, run: sweep }),
  },
});
