import { fileURLToPath } from "node:url";
import { z } from "zod";
import { action, defineModule, file, publicRoute, route } from "@office/sdk";
import {
  createDoc, createTemplate, DeclineIn, declineAsSigner, DocIn, DocPatch, docPdf, DocQuery, expireDue, getDoc, listDocs, listTemplates, openAsSigner, P,
  remind, seedTemplates, sendDoc, SendIn, SETTINGS_SCHEMA, signAsSigner, SignIn, signerPdf, TemplateIn, TemplatePatch, TokenIn, updateDoc, updateTemplate, voidDoc, VoidIn,
} from "./service.ts";
import { metrics } from "./metrics.ts";

const Id = z.object({ id: z.uuid() });
const EVENTS = ["docs.document.sent", "docs.document.viewed", "docs.document.signed", "docs.document.completed", "docs.document.declined", "docs.document.voided", "docs.document.expired"];
const pdfName = (d: { number: number; title: string; status: string }) => `${d.status === "completed" ? "signed" : d.status}-${d.number}-${d.title}.pdf`;

export default defineModule({
  manifest: {
    key: "docs",
    name: "Docs & e-sign",
    version: "1.0.0",
    office: "^1.0",
    description: "Document templates with merge fields from contacts, sending for e-signature by email link, a fixed content hash, and a signed PDF with an evidence trail.",
    permissions: {
      declares: [
        { key: P.read, label: "See documents and their signing status", defaultRoles: ["member"] },
        { key: P.send, label: "Create and send documents for signature", defaultRoles: ["member"] },
        { key: P.manage, label: "Manage templates and cancel anyone's documents" },
      ],
      requires: ["core:contacts.read", "core:companies.read", "core:mail.send"],
    },
    entities: ["document", "template"],
    events: { emits: EVENTS.map((type) => ({ type })), subscribes: [] },
    workflow: {
      triggers: EVENTS,
      actions: [{ key: "docs.send_template", label: "Send a template for signature" }],
    },
    ui: {
      slots: [
        { slot: "nav.main", label: "E-sign", icon: "signature", route: "/documents", permission: P.read },
        { slot: "dashboard.widget", label: "Waiting for signatures", component: "SignaturesWidget", permission: P.read },
      ],
    },
    settings: SETTINGS_SCHEMA as unknown as Record<string, unknown>,
    api: { basePath: "/docs" },
    lifecycle: ["enable"],
  },
  metrics,
  migrationsDir: fileURLToPath(new URL("../migrations", import.meta.url)),
  lifecycle: { enable: (ctx) => seedTemplates(ctx) },
  jobs: { expire: { everySeconds: 3600, run: (ctx) => expireDue(ctx) } },
  routes: [
    route({ method: "GET", path: "/templates", permission: P.read, query: z.object({ archived: z.stringbool().default(false) }), handler: (ctx, { query }) => listTemplates(ctx, query.archived) }),
    route({ method: "POST", path: "/templates", permission: P.manage, body: TemplateIn, status: 201, handler: (ctx, { body }) => createTemplate(ctx, body) }),
    route({ method: "PATCH", path: "/templates/:id", permission: P.manage, params: Id, body: TemplatePatch, handler: (ctx, { params, body }) => updateTemplate(ctx, params.id, body) }),
    route({ method: "GET", path: "/documents", permission: P.read, query: DocQuery, handler: (ctx, { query }) => listDocs(ctx, query) }),
    route({ method: "POST", path: "/documents", permission: P.send, body: DocIn, status: 201, handler: (ctx, { body }) => createDoc(ctx, body) }),
    route({ method: "GET", path: "/documents/:id", permission: P.read, params: Id, handler: (ctx, { params }) => getDoc(ctx, params.id) }),
    route({ method: "PATCH", path: "/documents/:id", permission: P.send, params: Id, body: DocPatch, handler: (ctx, { params, body }) => updateDoc(ctx, params.id, body) }),
    route({ method: "POST", path: "/documents/:id/send", permission: P.send, params: Id, body: SendIn, handler: (ctx, { params, body }) => sendDoc(ctx, params.id, body) }),
    route({ method: "POST", path: "/documents/:id/remind", permission: P.send, params: Id, handler: (ctx, { params }) => remind(ctx, params.id) }),
    route({ method: "POST", path: "/documents/:id/void", permission: P.send, params: Id, body: VoidIn, handler: (ctx, { params, body }) => voidDoc(ctx, params.id, body.reason) }),
    route({ method: "GET", path: "/documents/:id/pdf", permission: P.read, params: Id,
      handler: async (ctx, { params }) => { const { d, bytes } = await docPdf(ctx, params.id); return file({ contentType: "application/pdf", filename: pdfName(d), body: bytes, inline: true }); } }),
  ],
  publicRoutes: [
    publicRoute({ method: "POST", path: "/sign/:id/open", params: Id, body: TokenIn, handler: (ctx, { params, body, ip }) => openAsSigner(ctx, params.id, body.token, ip) }),
    publicRoute({ method: "POST", path: "/sign/:id/sign", params: Id, body: SignIn, handler: (ctx, { params, body, ip, userAgent }) => signAsSigner(ctx, params.id, body, ip, userAgent) }),
    publicRoute({ method: "POST", path: "/sign/:id/decline", params: Id, body: DeclineIn, handler: (ctx, { params, body, ip }) => declineAsSigner(ctx, params.id, body, ip) }),
    publicRoute({ method: "GET", path: "/sign/:id/pdf", params: Id, query: TokenIn,
      handler: async (ctx, { params, query }) => { const { d, bytes } = await signerPdf(ctx, params.id, query.token); return file({ contentType: "application/pdf", filename: pdfName(d), body: bytes }); } }),
  ],
  actions: {
    "docs.send_template": action({
      label: "Send a template for signature",
      input: z.object({
        templateId: z.uuid(), contactId: z.uuid().describe("signer, e.g. {{payload.contactId}}"),
        values: z.record(z.string(), z.string().max(2000)).optional().describe("extra merge fields, e.g. {\"scope\": \"Website redesign\"}"),
      }),
      run: async (ctx, i) => {
        const d = await createDoc(ctx, { templateId: i.templateId, contactId: i.contactId, values: i.values ?? {}, signers: [], inOrder: false });
        const s = await sendDoc(ctx, d.id, {});
        return { id: s.id, number: s.number, status: s.status };
      },
    }),
  },
});
