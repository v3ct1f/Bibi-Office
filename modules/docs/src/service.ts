import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, ilike, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "@office/db";
import { moduleErrors as E, type ModuleContext } from "@office/sdk";
import { compose, MailError, send, type Security, type Smtp } from "./mail.ts";
import { buildSignedPdf, fillIn, inspectPdf, PdfError, placeholders, renderTemplate, sha256, type StampSigner } from "./pdf.ts";
import { activity, documents, FIELD_KINDS, fields, signers, templates, VISIBILITY, type Status } from "./schema.ts";

export const P = {
  READ: "docs:library.read",     // the library (shared files and your own), documents waiting for your signature
  SEND: "docs:library.send",     // upload files, prepare and send documents for signature, use templates
  MANAGE: "docs:library.manage", // see and manage everyone's documents, manage templates
} as const;

// ───────── Helpers ─────────
const me = (ctx: ModuleContext) => ctx.actor.userId ?? null;
const canManage = (ctx: ModuleContext) => ctx.authz.can(P.MANAGE);
const canSend = (ctx: ModuleContext) => ctx.authz.can(P.SEND);
export const todayIso = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FILE = 7 * 1024 * 1024;
const newToken = () => randomBytes(24).toString("base64url");

interface Settings {
  smtpHost?: string; smtpPort?: number; smtpSecurity?: string; smtpUser?: string; fromAddress?: string; fromName?: string;
  remindEveryDays?: number; expiryDays?: number;
}
const settingsOf = (ctx: ModuleContext) => {
  const s = ctx.settings.get<Settings>();
  return { ...s, remindEveryDays: s.remindEveryDays ?? 3, expiryDays: s.expiryDays ?? 30 };
};
const MAIL_LABELS: Record<string, string> = { smtpHost: "Outgoing mail server", fromAddress: "Send from (email address)" };
export function smtpOf(ctx: ModuleContext): { smtp: Smtp | null; missing: string[] } {
  const s = settingsOf(ctx);
  const missing = (["smtpHost", "fromAddress"] as const).filter((k) => !s[k]).map((k) => MAIL_LABELS[k]!);
  if (missing.length) return { smtp: null, missing };
  const security: Security = s.smtpSecurity === "starttls" || s.smtpSecurity === "none" ? s.smtpSecurity : "tls";
  return {
    missing: [],
    smtp: {
      host: s.smtpHost!, port: s.smtpPort ?? (security === "tls" ? 465 : 587), security,
      user: s.smtpUser ?? "", pass: ctx.secrets.get("smtpPassword") ?? "", from: s.fromAddress!, fromName: s.fromName || "Documents",
    },
  };
}

async function peopleIndex(ctx: ModuleContext) {
  const people = await ctx.people.list();
  const byId = new Map(people.map((p) => [p.userId, p]));
  return { people, byId, name: (id: string | null | undefined) => (id ? byId.get(id)?.name ?? "Former member" : null) };
}

/** "  Contracts / 2026 /" -> "Contracts/2026" */
export const normFolder = (f: string) => f.split("/").map((s) => s.trim()).filter(Boolean).join("/").slice(0, 200);
const Folder = z.string().max(400).transform(normFolder);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-31").nullable().optional();
const Base64 = z.string().min(1).max(9_800_000, "Files can be at most 7 MB").regex(/^[A-Za-z0-9+/=\r\n]+$/, "The file wasn't sent correctly");

type Doc = typeof documents.$inferSelect;
type Signer = typeof signers.$inferSelect;
type Field = typeof fields.$inferSelect;
const LIST_COLS = {
  id: documents.id, title: documents.title, folder: documents.folder, visibility: documents.visibility, status: documents.status,
  fileName: documents.fileName, contentType: documents.contentType, sizeBytes: documents.sizeBytes, pageCount: documents.pageCount,
  createdBy: documents.createdBy, createdAt: documents.createdAt, updatedAt: documents.updatedAt, sentAt: documents.sentAt,
  completedAt: documents.completedAt, expiresOn: documents.expiresOn, employeeId: documents.employeeId, contactId: documents.contactId,
};
type ListRow = { [K in keyof typeof LIST_COLS]: Doc[K] };

/** Who may see a document: managers all; others shared ones, their own, ones they sign, and ones about them. */
function visibleTo(ctx: ModuleContext): SQL | undefined {
  if (canManage(ctx)) return undefined;
  const u = me(ctx);
  if (!u) return eq(documents.visibility, "team");
  return or(
    eq(documents.visibility, "team"), eq(documents.createdBy, u), eq(documents.employeeId, u),
    sql`exists (select 1 from docs_signers s where s.tenant_id = ${documents.tenantId} and s.document_id = ${documents.id} and s.user_id = ${u})`,
  );
}
async function loadDoc(ctx: ModuleContext, id: string): Promise<Doc> {
  const [d] = await ctx.db.select().from(documents).where(and(eq(documents.id, id), visibleTo(ctx)));
  if (!d) throw E.notFound("Document");
  return d;
}
const canEdit = (ctx: ModuleContext, d: { createdBy: string | null }) => canManage(ctx) || (canSend(ctx) && !!me(ctx) && d.createdBy === me(ctx));
async function editableDoc(ctx: ModuleContext, id: string) {
  const d = await loadDoc(ctx, id);
  if (!canEdit(ctx, d)) throw E.forbidden("Only the person who added this document, or a documents manager, can change it");
  return d;
}

async function log(ctx: ModuleContext, documentId: string, action: string, o: { signerId?: string | null; actorName?: string | null; ip?: string | null; userAgent?: string | null; detail?: string | null } = {}) {
  await ctx.db.insert(activity).values({
    id: uuidv7(), tenantId: ctx.tenantId, documentId, action, signerId: o.signerId ?? null, actorName: o.actorName ?? null,
    ip: o.ip ?? null, userAgent: o.userAgent?.slice(0, 300) ?? null, detail: o.detail?.slice(0, 500) ?? null,
  });
}
async function myName(ctx: ModuleContext) {
  const u = me(ctx);
  return u ? (await ctx.people.get(u))?.name ?? null : null;
}

const signLink = (ctx: ModuleContext, d: Pick<Doc, "appUrl">, token: string | null) =>
  token && d.appUrl ? `${d.appUrl}/p/${ctx.tenantId}/docs/sign/${token}` : null;

/** Signers who may sign now: everyone still pending, or only the first one when the order matters. */
function currentSigners(d: Pick<Doc, "ordered">, list: Signer[]): Signer[] {
  const pending = [...list].sort((a, b) => a.position - b.position).filter((s) => s.status === "pending");
  return d.ordered ? pending.slice(0, 1) : pending;
}

// ───────── File checks ─────────
const TYPES: Record<string, (b: Buffer) => boolean> = {
  "application/pdf": (b) => b.subarray(0, 5).toString("latin1") === "%PDF-",
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (b) => b[0] === 0x50 && b[1] === 0x4b,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": (b) => b[0] === 0x50 && b[1] === 0x4b,
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": (b) => b[0] === 0x50 && b[1] === 0x4b,
  "text/plain": (b) => !b.includes(0),
  "text/csv": (b) => !b.includes(0),
};
export const FILE_TYPES = Object.keys(TYPES);
function decodeFile(data: string, contentType: string): Buffer {
  const buf = Buffer.from(data, "base64");
  if (!buf.length) throw E.badRequest("The file is empty");
  if (buf.length > MAX_FILE) throw E.badRequest("Files can be at most 7 MB");
  if (!TYPES[contentType]?.(buf)) throw E.badRequest("The file content doesn't match its type");
  return buf;
}
async function pdfPages(buf: Buffer) {
  try { return (await inspectPdf(buf)).pageCount; }
  catch (e) { throw E.badRequest(e instanceof PdfError ? e.message : "This file can't be read as a PDF"); }
}

// ───────── Config & summary ─────────
export async function config(ctx: ModuleContext) {
  const s = settingsOf(ctx);
  const mail = smtpOf(ctx);
  return {
    me: me(ctx), canSend: canSend(ctx), canManage: canManage(ctx),
    emailReady: !!mail.smtp, emailMissing: mail.missing,
    defaults: { remindEveryDays: s.remindEveryDays, expiryDays: s.expiryDays },
    fileTypes: FILE_TYPES,
  };
}

export async function summary(ctx: ModuleContext) {
  const u = me(ctx);
  const waiting = u ? (await waitingForMe(ctx)).length : 0;
  const mine = u ? await ctx.db.select({ status: documents.status, n: sql<number>`count(*)::int` }).from(documents)
    .where(and(eq(documents.createdBy, u), inArray(documents.status, ["draft", "sent"]))).groupBy(documents.status) : [];
  const monthStart = `${todayIso().slice(0, 7)}-01`;
  const [done] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(documents)
    .where(and(eq(documents.status, "completed"), sql`${documents.completedAt} >= ${monthStart}::date`, visibleTo(ctx)));
  return {
    waitingForMe: waiting,
    outForSignature: mine.find((r) => r.status === "sent")?.n ?? 0,
    drafts: mine.find((r) => r.status === "draft")?.n ?? 0,
    completedThisMonth: done?.n ?? 0,
  };
}

// ───────── Library ─────────
export const ListQuery = z.object({
  folder: z.string().max(400).optional(), q: z.string().trim().max(200).optional(),
  kind: z.enum(["all", "files", "requests", "out", "completed"]).default("all"),
  contactId: z.uuid().optional(), employeeId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
async function signerSummaries(ctx: ModuleContext, ids: string[]) {
  const rows = ids.length ? await ctx.db.select({ documentId: signers.documentId, name: signers.name, status: signers.status, position: signers.position })
    .from(signers).where(inArray(signers.documentId, ids)).orderBy(asc(signers.position)) : [];
  const by = new Map<string, { name: string; status: string }[]>();
  for (const r of rows) (by.get(r.documentId) ?? by.set(r.documentId, []).get(r.documentId)!).push({ name: r.name, status: r.status });
  return by;
}
async function listDto(ctx: ModuleContext, rows: ListRow[]) {
  const { name } = await peopleIndex(ctx);
  const sig = await signerSummaries(ctx, rows.filter((r) => r.status !== "file").map((r) => r.id));
  return rows.map((r) => {
    const list = sig.get(r.id) ?? [];
    return {
      ...r, createdByName: name(r.createdBy), isPdf: r.contentType === "application/pdf",
      signers: list, signedCount: list.filter((s) => s.status === "signed").length,
      canEdit: canEdit(ctx, r),
    };
  });
}
export async function listDocuments(ctx: ModuleContext, q: z.infer<typeof ListQuery>) {
  const where: (SQL | undefined)[] = [visibleTo(ctx)];
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(or(ilike(documents.title, like), ilike(documents.fileName, like)));
  } else if (q.folder !== undefined && !q.contactId && !q.employeeId) {
    where.push(eq(documents.folder, normFolder(q.folder)));
  }
  if (q.kind === "files") where.push(eq(documents.status, "file"));
  if (q.kind === "requests") where.push(sql`${documents.status} <> 'file'`);
  if (q.kind === "out") where.push(eq(documents.status, "sent"));
  if (q.kind === "completed") where.push(eq(documents.status, "completed"));
  if (q.contactId) {
    where.push(or(eq(documents.contactId, q.contactId),
      sql`exists (select 1 from docs_signers s where s.tenant_id = ${documents.tenantId} and s.document_id = ${documents.id} and s.contact_id = ${q.contactId})`));
  }
  if (q.employeeId) where.push(eq(documents.employeeId, q.employeeId));
  const rows = await ctx.db.select(LIST_COLS).from(documents).where(and(...where)).orderBy(desc(documents.updatedAt)).limit(q.limit);
  const folders = await ctx.db.selectDistinct({ folder: documents.folder }).from(documents).where(visibleTo(ctx));
  return { data: await listDto(ctx, rows), folders: folders.map((f) => f.folder).filter(Boolean).sort((a, b) => a.localeCompare(b)) };
}

export const FileInput = z.object({
  title: z.string().trim().min(1, "Give the document a name").max(200), folder: Folder.optional(), visibility: z.enum(VISIBILITY).default("team"),
  fileName: z.string().trim().min(1).max(255), contentType: z.string().max(120), data: Base64,
}).strict();
export async function uploadFile(ctx: ModuleContext, input: z.infer<typeof FileInput>) {
  if (!FILE_TYPES.includes(input.contentType)) throw E.badRequest("Upload a PDF, a photo (JPG, PNG, WEBP), a Word, Excel or PowerPoint file, or a text or CSV file");
  const buf = decodeFile(input.data, input.contentType);
  const pageCount = input.contentType === "application/pdf" ? await inspectPdf(buf).then((r) => r.pageCount, () => null) : null;
  const id = uuidv7();
  await ctx.db.insert(documents).values({
    id, tenantId: ctx.tenantId, title: input.title, folder: input.folder ?? "", visibility: input.visibility, status: "file",
    fileName: input.fileName, contentType: input.contentType, sizeBytes: buf.length, sha256: sha256(buf), data: buf, pageCount, createdBy: me(ctx),
  });
  await ctx.audit.log("file.uploaded", { type: "document", id }, { title: input.title, folder: input.folder ?? "" });
  return getDocument(ctx, id);
}

// ───────── Signature requests ─────────
const SignerInput = z.object({
  name: z.string().trim().min(1, "Every signer needs a name").max(200), email: z.string().trim().toLowerCase().max(320),
  userId: z.uuid().nullable().optional(), contactId: z.uuid().nullable().optional(),
}).strict();
export const RequestInput = z.object({
  title: z.string().trim().min(1, "Give the document a name").max(200), folder: Folder.optional(),
  fileName: z.string().trim().min(1).max(255), data: Base64,
}).strict();
export const TemplateRequestInput = z.object({
  templateId: z.uuid(), title: z.string().trim().min(1, "Give the document a name").max(200), folder: Folder.optional(),
  values: z.record(z.string().max(60), z.string().max(2000)).default({}),
  signers: z.array(SignerInput).max(10).default([]),
  employeeId: z.uuid().nullable().optional(), contactId: z.uuid().nullable().optional(),
}).strict();

function newRequestValues(ctx: ModuleContext) {
  const s = settingsOf(ctx);
  return { status: "draft" as Status, visibility: "private" as const, remindEveryDays: s.remindEveryDays, expiresOn: s.expiryDays ? addDays(todayIso(), s.expiryDays) : null };
}

export async function createRequest(ctx: ModuleContext, input: z.infer<typeof RequestInput>) {
  const buf = decodeFile(input.data, "application/pdf");
  const pageCount = await pdfPages(buf);
  const id = uuidv7();
  await ctx.db.insert(documents).values({
    id, tenantId: ctx.tenantId, title: input.title, folder: input.folder ?? "", fileName: input.fileName, contentType: "application/pdf",
    sizeBytes: buf.length, sha256: sha256(buf), data: buf, pageCount, createdBy: me(ctx), ...newRequestValues(ctx),
  });
  await log(ctx, id, "created", { actorName: await myName(ctx) });
  await ctx.audit.log("request.created", { type: "document", id }, { title: input.title });
  return getDocument(ctx, id);
}

/** Turns a PDF from the library into a signature request (draft). */
export async function requestFromFile(ctx: ModuleContext, id: string) {
  const d = await editableDoc(ctx, id);
  if (d.status !== "file") throw E.conflict("This document is already a signature request");
  if (d.contentType !== "application/pdf") throw E.badRequest("Only PDF files can be sent for signature");
  const pageCount = await pdfPages(d.data);
  const v = newRequestValues(ctx);
  await ctx.db.update(documents).set({ status: "draft", pageCount, remindEveryDays: v.remindEveryDays, expiresOn: v.expiresOn, updatedAt: new Date() }).where(eq(documents.id, id));
  await log(ctx, id, "created", { actorName: await myName(ctx) });
  return getDocument(ctx, id);
}

async function checkSigners(ctx: ModuleContext, list: z.infer<typeof SignerInput>[]) {
  const seen = new Set<string>();
  for (const s of list) {
    if (!EMAIL_RE.test(s.email)) throw E.badRequest(`Check the email address of ${s.name}`);
    if (seen.has(s.email)) throw E.badRequest(`${s.email} is in the list twice`);
    seen.add(s.email);
    if (s.userId && !(await ctx.people.get(s.userId))) throw E.badRequest(`${s.name} isn't a member of this workspace`);
  }
}
async function checkEmployee(ctx: ModuleContext, employeeId: string | null | undefined) {
  if (employeeId && !(await ctx.people.get(employeeId))) throw E.badRequest("Pick a current team member");
}

export async function createFromTemplate(ctx: ModuleContext, input: z.infer<typeof TemplateRequestInput>) {
  const [t] = await ctx.db.select().from(templates).where(eq(templates.id, input.templateId));
  if (!t) throw E.notFound("Template");
  await checkSigners(ctx, input.signers);
  await checkEmployee(ctx, input.employeeId);
  const r = await renderTemplate(input.title, fillIn(t.body, input.values), input.signers.map((s) => s.name));
  const buf = Buffer.from(r.bytes);
  if (buf.length > MAX_FILE) throw E.badRequest("The document is too long");
  const id = uuidv7();
  const fileName = `${input.title.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120)}.pdf`;
  await ctx.db.insert(documents).values({
    id, tenantId: ctx.tenantId, title: input.title, folder: input.folder ?? t.folder, fileName, contentType: "application/pdf",
    sizeBytes: buf.length, sha256: sha256(buf), data: buf, pageCount: r.pageCount, createdBy: me(ctx), templateId: t.id,
    employeeId: input.employeeId ?? null, contactId: input.contactId ?? null, ...newRequestValues(ctx),
  });
  const ids = input.signers.map(() => uuidv7());
  if (input.signers.length) {
    await ctx.db.insert(signers).values(input.signers.map((s, i) => ({
      id: ids[i]!, tenantId: ctx.tenantId, documentId: id, position: i + 1, name: s.name, email: s.email, userId: s.userId ?? null, contactId: s.contactId ?? null,
    })));
    await ctx.db.insert(fields).values(r.fields.map((f) => ({
      id: uuidv7(), tenantId: ctx.tenantId, documentId: id, signerId: ids[f.signerIndex]!, kind: f.kind, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: true,
    })));
  }
  await log(ctx, id, "created", { actorName: await myName(ctx), detail: `From the template “${t.name}”` });
  await ctx.audit.log("request.created", { type: "document", id }, { title: input.title, templateId: t.id });
  return getDocument(ctx, id);
}

export async function getDocument(ctx: ModuleContext, id: string) {
  const d = await loadDoc(ctx, id);
  const { name } = await peopleIndex(ctx);
  const sList = await ctx.db.select().from(signers).where(eq(signers.documentId, id)).orderBy(asc(signers.position));
  const fList = await ctx.db.select().from(fields).where(eq(fields.documentId, id)).orderBy(asc(fields.page), asc(fields.y));
  const aList = await ctx.db.select().from(activity).where(eq(activity.documentId, id)).orderBy(asc(activity.at), asc(activity.id));
  const edit = canEdit(ctx, d);
  const now = new Set(d.status === "sent" ? currentSigners(d, sList).map((s) => s.id) : []);
  let templateName: string | null = null;
  if (d.templateId) templateName = (await ctx.db.select({ name: templates.name }).from(templates).where(eq(templates.id, d.templateId)))[0]?.name ?? null;
  const u = me(ctx);
  return {
    id: d.id, title: d.title, folder: d.folder, visibility: d.visibility, status: d.status, fileName: d.fileName, contentType: d.contentType,
    sizeBytes: d.sizeBytes, sha256: d.sha256, pageCount: d.pageCount, isPdf: d.contentType === "application/pdf",
    signedSha256: d.signedSha256, ordered: d.ordered, message: d.message, expiresOn: d.expiresOn, remindEveryDays: d.remindEveryDays,
    employeeId: d.employeeId, employeeName: name(d.employeeId), contactId: d.contactId, templateId: d.templateId, templateName,
    createdBy: d.createdBy, createdByName: name(d.createdBy), createdAt: d.createdAt, updatedAt: d.updatedAt, sentAt: d.sentAt, completedAt: d.completedAt,
    signers: sList.map((s) => ({
      id: s.id, position: s.position, name: s.name, email: s.email, userId: s.userId, contactId: s.contactId, status: s.status,
      viewedAt: s.viewedAt, signedAt: s.signedAt, declinedAt: s.declinedAt, declineReason: s.declineReason,
      notifiedAt: s.notifiedAt, lastRemindedAt: s.lastRemindedAt, remindersSent: s.remindersSent, mailError: s.mailError,
      canSignNow: now.has(s.id), isMe: !!u && s.userId === u,
      link: edit && d.status === "sent" && s.status === "pending" ? signLink(ctx, d, s.token) : null,
    })),
    fields: fList.map((f) => ({ id: f.id, signerId: f.signerId, kind: f.kind, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: f.required, label: f.label, value: d.status === "completed" || edit ? f.value : null })),
    activity: aList.map((a) => ({ id: a.id, at: a.at, action: a.action, actorName: a.actorName, signerId: a.signerId, detail: a.detail })),
    can: {
      edit, setup: edit && d.status === "draft", send: edit && d.status === "draft", cancel: edit && d.status === "sent",
      remind: edit && d.status === "sent" && !!smtpOf(ctx).smtp, delete: edit, toRequest: edit && d.status === "file" && d.contentType === "application/pdf",
    },
  };
}

export const FileQuery = z.object({ version: z.enum(["original", "signed"]).default("original") });
export async function getFile(ctx: ModuleContext, id: string, version: "original" | "signed") {
  const d = await loadDoc(ctx, id);
  if (version === "signed") {
    if (!d.signedData) throw E.notFound("Signed copy");
    return { fileName: signedName(d.fileName), contentType: "application/pdf", data: d.signedData.toString("base64") };
  }
  return { fileName: d.fileName, contentType: d.contentType, data: d.data.toString("base64") };
}
const signedName = (f: string) => `${f.replace(/\.pdf$/i, "")} (signed).pdf`;

export const DocumentPatch = z.object({
  title: z.string().trim().min(1).max(200).optional(), folder: Folder.optional(), visibility: z.enum(VISIBILITY).optional(),
  message: z.string().trim().max(2000).nullable().optional(), ordered: z.boolean().optional(), expiresOn: day,
  remindEveryDays: z.number().int().min(0).max(30).optional(),
  employeeId: z.uuid().nullable().optional(), contactId: z.uuid().nullable().optional(),
}).strict();
export async function updateDocument(ctx: ModuleContext, id: string, p: z.infer<typeof DocumentPatch>) {
  const d = await editableDoc(ctx, id);
  const draft = d.status === "draft";
  if (!draft && (p.ordered !== undefined || p.message !== undefined)) throw E.conflict("The signing order and message can only change before sending");
  if (d.status !== "draft" && d.status !== "sent" && (p.expiresOn !== undefined || p.remindEveryDays !== undefined)) throw E.conflict("This request is finished");
  if (p.expiresOn && p.expiresOn < todayIso()) throw E.badRequest("Pick an expiry date in the future");
  if (p.employeeId !== undefined) await checkEmployee(ctx, p.employeeId);
  await ctx.db.update(documents).set({
    ...(p.title !== undefined ? { title: p.title } : {}), ...(p.folder !== undefined ? { folder: p.folder } : {}),
    ...(p.visibility !== undefined ? { visibility: p.visibility } : {}), ...(p.message !== undefined ? { message: p.message || null } : {}),
    ...(p.ordered !== undefined ? { ordered: p.ordered } : {}), ...(p.expiresOn !== undefined ? { expiresOn: p.expiresOn } : {}),
    ...(p.remindEveryDays !== undefined ? { remindEveryDays: p.remindEveryDays } : {}),
    ...(p.employeeId !== undefined ? { employeeId: p.employeeId } : {}), ...(p.contactId !== undefined ? { contactId: p.contactId } : {}),
    updatedAt: new Date(),
  }).where(eq(documents.id, id));
  return getDocument(ctx, id);
}

const FieldInput = z.object({
  signer: z.number().int().min(0).max(9), kind: z.enum(FIELD_KINDS), page: z.number().int().min(1),
  x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().gt(0).max(1), h: z.number().gt(0).max(1),
  required: z.boolean().default(true), label: z.string().trim().max(80).nullable().optional(),
}).strict();
export const SetupInput = z.object({ signers: z.array(SignerInput).max(10), fields: z.array(FieldInput).max(300) }).strict();
/** Replaces the signers and the boxes of a draft. */
export async function setupRequest(ctx: ModuleContext, id: string, input: z.infer<typeof SetupInput>) {
  const d = await editableDoc(ctx, id);
  if (d.status !== "draft") throw E.conflict("Signers and boxes can only change before sending");
  await checkSigners(ctx, input.signers);
  for (const f of input.fields) {
    if (f.signer >= input.signers.length) throw E.badRequest("A box belongs to a signer who isn't in the list");
    if (f.page > (d.pageCount ?? 1)) throw E.badRequest(`The document has only ${d.pageCount} pages`);
    if (f.x + f.w > 1.001 || f.y + f.h > 1.001) throw E.badRequest("A box is outside the page");
  }
  await ctx.db.delete(signers).where(eq(signers.documentId, id));
  const ids = input.signers.map(() => uuidv7());
  if (input.signers.length) {
    await ctx.db.insert(signers).values(input.signers.map((s, i) => ({
      id: ids[i]!, tenantId: ctx.tenantId, documentId: id, position: i + 1, name: s.name, email: s.email, userId: s.userId ?? null, contactId: s.contactId ?? null,
    })));
  }
  if (input.fields.length) {
    await ctx.db.insert(fields).values(input.fields.map((f) => ({
      id: uuidv7(), tenantId: ctx.tenantId, documentId: id, signerId: ids[f.signer]!, kind: f.kind, page: f.page,
      x: f.x, y: f.y, w: Math.min(f.w, 1 - f.x), h: Math.min(f.h, 1 - f.y), required: f.kind === "date" || f.kind === "name" ? true : f.required, label: f.label ?? null,
    })));
  }
  // The first contact signer links the document to that contact, unless one is set already.
  const contact = input.signers.find((s) => s.contactId)?.contactId;
  await ctx.db.update(documents).set({ updatedAt: new Date(), ...(contact && !d.contactId ? { contactId: contact } : {}) }).where(eq(documents.id, id));
  return getDocument(ctx, id);
}

// ───────── Sending & email ─────────
export const SendInput = z.object({
  appUrl: z.string().trim().regex(/^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i, "The app address isn't valid"),
  companyName: z.string().trim().max(200).optional(),
}).strict();

async function senderName(ctx: ModuleContext, d: Doc) {
  return (d.createdBy ? (await ctx.people.get(d.createdBy))?.name : null) ?? d.companyName ?? "Someone";
}

/** Emails a signer their link. Never throws: the result (and the signer row) says what happened. */
async function emailSigner(ctx: ModuleContext, d: Doc, s: Signer, kind: "invite" | "reminder"): Promise<{ emailed: boolean; error: string | null }> {
  const { smtp } = smtpOf(ctx);
  const url = signLink(ctx, d, s.token);
  if (!smtp || !url) return { emailed: false, error: null };
  const from = await senderName(ctx, d);
  const who = d.companyName ? `${from} (${d.companyName})` : from;
  const body = compose({
    greeting: `Hi ${s.name},`,
    lines: [
      kind === "invite" ? `${who} asked you to sign “${d.title}”.` : `A reminder: “${d.title}” from ${who} is still waiting for your signature.`,
      ...(d.message && kind === "invite" ? [d.message] : []),
      ...(d.expiresOn ? [`Please sign by ${d.expiresOn}.`] : []),
    ],
    button: { label: "Review and sign", url },
    footer: "This link is personal: don't forward this email.",
  });
  try {
    await send(smtp, { to: s.email, subject: kind === "invite" ? `${from} sent you “${d.title}” to sign` : `Reminder: please sign “${d.title}”`, ...body });
    const now = new Date();
    await ctx.db.update(signers).set(kind === "invite"
      ? { notifiedAt: now, mailError: null }
      : { lastRemindedAt: now, remindersSent: s.remindersSent + 1, mailError: null }).where(eq(signers.id, s.id));
    await log(ctx, d.id, kind === "invite" ? "emailed" : "reminded", { signerId: s.id, actorName: s.name, detail: s.email });
    return { emailed: true, error: null };
  } catch (e) {
    const error = e instanceof MailError ? e.message : "The email couldn't be sent";
    await ctx.db.update(signers).set({ mailError: error }).where(eq(signers.id, s.id));
    ctx.log.warn({ documentId: d.id, signerId: s.id, error }, "signing email failed");
    return { emailed: false, error };
  }
}

/** Best-effort note to the person who sent the request. */
async function emailOwner(ctx: ModuleContext, d: Doc, subject: string, lines: string[], attach?: { filename: string; content: Buffer }) {
  const { smtp } = smtpOf(ctx);
  const owner = d.createdBy ? await ctx.people.get(d.createdBy) : null;
  if (!smtp || !owner) return;
  const url = d.appUrl ? `${d.appUrl}/` : undefined;
  try {
    await send(smtp, { to: owner.email, subject, ...compose({ greeting: `Hi ${owner.name},`, lines, ...(url ? { footer: `Open the app: ${url}` } : {}) }), ...(attach ? { attachments: [attach] } : {}) });
  } catch (e) { ctx.log.warn({ documentId: d.id, error: String(e) }, "owner email failed"); }
}

export async function sendRequest(ctx: ModuleContext, id: string, input: z.infer<typeof SendInput>) {
  const d = await editableDoc(ctx, id);
  if (d.status !== "draft") throw E.conflict("This document was already sent");
  if (d.expiresOn && d.expiresOn < todayIso()) throw E.badRequest("The expiry date has passed. Pick a new one.");
  const sList = await ctx.db.select().from(signers).where(eq(signers.documentId, id)).orderBy(asc(signers.position));
  if (!sList.length) throw E.badRequest("Add at least one signer");
  const fList = await ctx.db.select({ signerId: fields.signerId, kind: fields.kind }).from(fields).where(eq(fields.documentId, id));
  for (const s of sList) {
    if (!fList.some((f) => f.signerId === s.id && (f.kind === "signature" || f.kind === "initials"))) throw E.badRequest(`Add a signature box for ${s.name}`);
  }
  const now = new Date();
  for (const s of sList) await ctx.db.update(signers).set({ token: newToken() }).where(eq(signers.id, s.id));
  await ctx.db.update(documents).set({
    status: "sent", sentAt: now, updatedAt: now, appUrl: input.appUrl.replace(/\/+$/, ""), companyName: input.companyName || null,
  }).where(eq(documents.id, id));
  await log(ctx, id, "sent", { actorName: await myName(ctx), detail: sList.map((s) => s.name).join(", ") });
  const doc = (await ctx.db.select().from(documents).where(eq(documents.id, id)))[0]!;
  const fresh = await ctx.db.select().from(signers).where(eq(signers.documentId, id)).orderBy(asc(signers.position));
  const results: Record<string, { emailed: boolean; error: string | null }> = {};
  for (const s of currentSigners(doc, fresh)) results[s.id] = await emailSigner(ctx, doc, s, "invite");
  await ctx.events.emit("docs.request.sent", { documentId: id, title: d.title, signers: fresh.map((s) => ({ name: s.name, email: s.email })), employeeId: d.employeeId, contactId: d.contactId });
  await ctx.audit.log("request.sent", { type: "document", id }, { signers: fresh.length });
  return { ...(await getDocument(ctx, id)), delivery: results };
}

async function editableSigner(ctx: ModuleContext, signerId: string) {
  const [s] = await ctx.db.select().from(signers).where(eq(signers.id, signerId));
  if (!s) throw E.notFound("Signer");
  const d = await editableDoc(ctx, s.documentId);
  if (d.status !== "sent" || s.status !== "pending") throw E.conflict("This signer has nothing left to sign");
  return { s, d };
}
/** A fresh link for one signer; the old one stops working. */
export async function replaceLink(ctx: ModuleContext, signerId: string) {
  const { s, d } = await editableSigner(ctx, signerId);
  await ctx.db.update(signers).set({ token: newToken(), notifiedAt: null }).where(eq(signers.id, s.id));
  await log(ctx, d.id, "link_replaced", { signerId: s.id, actorName: await myName(ctx), detail: s.name });
  return getDocument(ctx, d.id);
}
export async function remindSigner(ctx: ModuleContext, signerId: string) {
  const { s, d } = await editableSigner(ctx, signerId);
  if (!smtpOf(ctx).smtp) throw E.badRequest("Email isn't set up yet. Copy the link and send it yourself, or fill in the email settings.");
  const all = await ctx.db.select().from(signers).where(eq(signers.documentId, d.id));
  if (!currentSigners(d, all).some((x) => x.id === s.id)) throw E.conflict(`It isn't ${s.name}'s turn to sign yet`);
  const r = await emailSigner(ctx, d, s, s.notifiedAt ? "reminder" : "invite");
  if (r.error) throw E.badRequest(r.error);
  return getDocument(ctx, d.id);
}

export const CancelInput = z.object({ reason: z.string().trim().max(500).optional() }).strict();
export async function cancelRequest(ctx: ModuleContext, id: string, reason?: string) {
  const d = await editableDoc(ctx, id);
  if (d.status !== "sent") throw E.conflict("Only requests that are out for signature can be cancelled");
  await ctx.db.update(documents).set({ status: "cancelled", updatedAt: new Date() }).where(eq(documents.id, id));
  await log(ctx, id, "cancelled", { actorName: await myName(ctx), detail: reason ?? null });
  await ctx.events.emit("docs.request.cancelled", { documentId: id, title: d.title, reason: reason ?? null });
  await ctx.audit.log("request.cancelled", { type: "document", id }, { reason: reason ?? null });
  return getDocument(ctx, id);
}

export async function deleteDocument(ctx: ModuleContext, id: string) {
  const d = await editableDoc(ctx, id);
  await ctx.db.delete(documents).where(eq(documents.id, id));
  await ctx.audit.log("document.deleted", { type: "document", id }, { title: d.title, status: d.status });
}

// ───────── Waiting for me (team members who sign) ─────────
export async function waitingForMe(ctx: ModuleContext) {
  const u = me(ctx);
  if (!u) return [];
  const mine = await ctx.db.select({ s: signers, d: LIST_COLS }).from(signers)
    .innerJoin(documents, and(eq(documents.id, signers.documentId), eq(documents.tenantId, signers.tenantId)))
    .where(and(eq(signers.userId, u), eq(signers.status, "pending"), eq(documents.status, "sent")));
  if (!mine.length) return [];
  const docIds = [...new Set(mine.map((m) => m.d.id))];
  const [all, ordered] = await Promise.all([
    ctx.db.select().from(signers).where(inArray(signers.documentId, docIds)),
    ctx.db.select({ id: documents.id, ordered: documents.ordered }).from(documents).where(inArray(documents.id, docIds)),
  ]);
  const { name } = await peopleIndex(ctx);
  return mine.filter((m) => currentSigners({ ordered: ordered.find((o) => o.id === m.d.id)!.ordered }, all.filter((s) => s.documentId === m.d.id)).some((s) => s.id === m.s.id))
    .map((m) => ({ id: m.d.id, title: m.d.title, sentAt: m.d.sentAt, expiresOn: m.d.expiresOn, createdByName: name(m.d.createdBy), signerId: m.s.id }));
}
/** The signing page for a team member who signs (same page as the emailed link). */
export async function mySigningLink(ctx: ModuleContext, id: string) {
  const u = me(ctx);
  const [s] = u ? await ctx.db.select().from(signers).where(and(eq(signers.documentId, id), eq(signers.userId, u), eq(signers.status, "pending"))) : [];
  if (!s?.token) throw E.notFound("Signature request");
  return { path: `/p/${ctx.tenantId}/docs/sign/${s.token}` };
}

// ───────── Public signing (no sign-in; the token is the key) ─────────
interface Client { ip: string; userAgent: string | null }
export const Token = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/) });

async function byToken(ctx: ModuleContext, token: string) {
  const [s] = await ctx.db.select().from(signers).where(eq(signers.token, token));
  if (!s) throw E.notFound("Signing link");
  const [d] = await ctx.db.select().from(documents).where(eq(documents.id, s.documentId));
  if (!d || d.status === "draft" || d.status === "file") throw E.notFound("Signing link");
  const all = await ctx.db.select().from(signers).where(eq(signers.documentId, d.id)).orderBy(asc(signers.position));
  return { s, d, all };
}
const isExpired = (d: Doc) => d.status === "sent" && !!d.expiresOn && d.expiresOn < todayIso();

export async function publicView(ctx: ModuleContext, token: string, client: Client) {
  const { s, d, all } = await byToken(ctx, token);
  const turn = d.status === "sent" && !isExpired(d) && currentSigners(d, all).some((x) => x.id === s.id);
  if (d.status === "sent" && s.status === "pending" && !s.viewedAt) {
    await ctx.db.update(signers).set({ viewedAt: new Date() }).where(eq(signers.id, s.id));
    await log(ctx, d.id, "viewed", { signerId: s.id, actorName: s.name, ip: client.ip, userAgent: client.userAgent });
  }
  const mine = await ctx.db.select().from(fields).where(and(eq(fields.documentId, d.id), eq(fields.signerId, s.id)));
  const waitingFor = d.status === "sent" && s.status === "pending" && !turn ? currentSigners(d, all)[0]?.name ?? null : null;
  return {
    document: {
      title: d.title, message: d.message, status: isExpired(d) ? "expired" : d.status, companyName: d.companyName, senderName: await senderName(ctx, d),
      expiresOn: d.expiresOn, pageCount: d.pageCount, fileName: d.fileName,
    },
    signer: { name: s.name, email: s.email, status: s.status, signedAt: s.signedAt },
    signers: all.map((x) => ({ name: x.name, status: x.status, me: x.id === s.id })),
    yourTurn: turn && s.status === "pending",
    waitingFor,
    fields: mine.map((f) => ({ id: f.id, kind: f.kind, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: f.required, label: f.label })),
    pdf: (d.status === "completed" && d.signedData ? d.signedData : d.data).toString("base64"),
    signedCopy: d.status === "completed",
  };
}

const Mark = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("typed"), text: z.string().trim().min(1, "Type your name").max(100) }).strict(),
  z.object({ kind: z.literal("drawn"), image: z.string().max(400_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "The drawing wasn't sent correctly") }).strict(),
]);
export const SignInput = z.object({
  agree: z.literal(true, "Tick the box to agree to sign electronically"),
  signature: Mark, initials: Mark.optional(),
  values: z.record(z.uuid(), z.string().trim().max(500)).default({}),
}).strict();
function png(dataUrl: string): Buffer {
  const b = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  if (b.length < 60 || b.length > 280_000 || !TYPES["image/png"]!(b)) throw E.badRequest("The drawing wasn't sent correctly");
  return b;
}

/** Locks the document row, then reads it fresh, so two signers (or a double click) can't race past each other. */
async function byTokenLocked(ctx: ModuleContext, token: string) {
  const first = await byToken(ctx, token);
  await ctx.db.select({ id: documents.id }).from(documents).where(eq(documents.id, first.d.id)).for("update");
  return byToken(ctx, token);
}

export async function publicSign(ctx: ModuleContext, token: string, input: z.infer<typeof SignInput>, client: Client) {
  const { s, d, all } = await byTokenLocked(ctx, token);
  if (d.status !== "sent") throw E.conflict(`This document is ${d.status} and can't be signed`);
  if (isExpired(d)) throw E.conflict("This signing request has expired. Ask the sender for a new one.");
  if (s.status !== "pending") throw E.conflict("You've already answered this request");
  if (!currentSigners(d, all).some((x) => x.id === s.id)) throw E.conflict("It isn't your turn to sign yet");
  const mine = await ctx.db.select().from(fields).where(and(eq(fields.documentId, d.id), eq(fields.signerId, s.id)));
  if (mine.some((f) => f.kind === "initials") && !input.initials) throw E.badRequest("Add your initials");
  for (const f of mine.filter((x) => x.kind === "text" && x.required)) {
    if (!input.values[f.id]?.trim()) throw E.badRequest(`Fill in ${f.label || "every required box"}`);
  }
  const sig = input.signature, ini = input.initials;
  const now = new Date();
  await ctx.db.update(signers).set({
    status: "signed", signedAt: now, ip: client.ip, userAgent: client.userAgent?.slice(0, 300) ?? null,
    signatureKind: sig.kind, signatureText: sig.kind === "typed" ? sig.text : null, signatureImage: sig.kind === "drawn" ? png(sig.image) : null,
    initialsText: ini?.kind === "typed" ? ini.text : null, initialsImage: ini?.kind === "drawn" ? png(ini.image) : null,
  }).where(eq(signers.id, s.id));
  for (const f of mine.filter((x) => x.kind === "text")) {
    const v = input.values[f.id]?.trim();
    if (v) await ctx.db.update(fields).set({ value: v }).where(eq(fields.id, f.id));
  }
  await log(ctx, d.id, "signed", { signerId: s.id, actorName: s.name, ip: client.ip, userAgent: client.userAgent, detail: s.email });
  await ctx.events.emit("docs.request.signed", { documentId: d.id, title: d.title, signerName: s.name, signerEmail: s.email });

  const after = await ctx.db.select().from(signers).where(eq(signers.documentId, d.id)).orderBy(asc(signers.position));
  if (after.every((x) => x.status === "signed")) await complete(ctx, d.id);
  else if (d.ordered) {
    const next = currentSigners(d, after)[0];
    if (next) await emailSigner(ctx, d, next, "invite");
  }
  return publicView(ctx, token, client);
}

const ACTION_TEXT: Record<string, (a: typeof activity.$inferSelect) => string> = {
  created: (a) => `Created by ${a.actorName ?? "a team member"}${a.detail ? ` (${a.detail})` : ""}`,
  sent: (a) => `Sent for signature by ${a.actorName ?? "a team member"}`,
  emailed: (a) => `Signing link emailed to ${a.actorName} <${a.detail}>`,
  reminded: (a) => `Reminder emailed to ${a.actorName} <${a.detail}>`,
  viewed: (a) => `Opened by ${a.actorName} (IP ${a.ip ?? "unknown"})`,
  signed: (a) => `Signed by ${a.actorName} <${a.detail}> (IP ${a.ip ?? "unknown"})`,
  link_replaced: (a) => `New signing link made for ${a.detail}`,
  completed: () => "All signers have signed; signed copy created",
};

async function complete(ctx: ModuleContext, id: string) {
  const d = (await ctx.db.select().from(documents).where(eq(documents.id, id)))[0]!;
  const sList = await ctx.db.select().from(signers).where(eq(signers.documentId, id)).orderBy(asc(signers.position));
  const fList = await ctx.db.select().from(fields).where(eq(fields.documentId, id));
  const now = new Date();
  await log(ctx, id, "completed", {});
  const aList = await ctx.db.select().from(activity).where(eq(activity.documentId, id)).orderBy(asc(activity.at), asc(activity.id));
  const stamp = new Map<string, StampSigner>(sList.map((s) => [s.id, {
    name: s.name, email: s.email, status: s.status, signedAt: s.signedAt, ip: s.ip, userAgent: s.userAgent,
    signatureText: s.signatureText, signatureImage: s.signatureImage, initialsText: s.initialsText, initialsImage: s.initialsImage,
  }]));
  const bytes = Buffer.from(await buildSignedPdf(d.data, fList.map((f: Field) => ({ ...f, signer: stamp.get(f.signerId)! })), {
    documentId: d.id, title: d.title, companyName: d.companyName, senderName: await senderName(ctx, d), originalSha256: d.sha256, completedAt: now,
    signers: [...stamp.values()],
    activity: aList.filter((a) => ACTION_TEXT[a.action]).map((a) => ({ at: a.at, text: ACTION_TEXT[a.action]!(a) })),
  }));
  await ctx.db.update(documents).set({ status: "completed", completedAt: now, updatedAt: now, signedData: bytes, signedSha256: sha256(bytes) }).where(eq(documents.id, id));
  await ctx.events.emit("docs.request.completed", {
    documentId: id, title: d.title, fileName: signedName(d.fileName), sizeBytes: bytes.length, employeeId: d.employeeId, contactId: d.contactId,
    signers: sList.map((s) => ({ name: s.name, email: s.email })), completedAt: now.toISOString(),
  });
  await ctx.audit.log("request.completed", { type: "document", id }, { signers: sList.length });

  // Everyone gets the signed copy (best effort).
  const { smtp } = smtpOf(ctx);
  if (!smtp) return;
  const attach = bytes.length <= MAX_FILE ? { filename: signedName(d.fileName), content: bytes } : undefined;
  for (const s of sList) {
    try {
      const url = signLink(ctx, d, s.token);
      await send(smtp, {
        to: s.email, subject: `Signed: “${d.title}”`, ...(attach ? { attachments: [attach] } : {}),
        ...compose({ greeting: `Hi ${s.name},`, lines: [`Everyone has signed “${d.title}”.`, attach ? "The signed copy is attached." : "You can download the signed copy from the link below."], ...(url ? { button: { label: "Open the signed document", url } } : {}) }),
      });
    } catch (e) { ctx.log.warn({ documentId: id, error: String(e) }, "completion email failed"); }
  }
  await emailOwner(ctx, d, `Signed: “${d.title}”`, [`Everyone has signed “${d.title}”.`, ...(attach ? ["The signed copy is attached and saved in Docs."] : ["The signed copy is saved in Docs."])], attach);
}

export const DeclineInput = z.object({ reason: z.string().trim().min(1, "Tell the sender why").max(1000) }).strict();
export async function publicDecline(ctx: ModuleContext, token: string, reason: string, client: Client) {
  const { s, d } = await byTokenLocked(ctx, token);
  if (d.status !== "sent" || isExpired(d)) throw E.conflict("This request is no longer open");
  if (s.status !== "pending") throw E.conflict("You've already answered this request");
  const now = new Date();
  await ctx.db.update(signers).set({ status: "declined", declinedAt: now, declineReason: reason, ip: client.ip, userAgent: client.userAgent?.slice(0, 300) ?? null }).where(eq(signers.id, s.id));
  await ctx.db.update(documents).set({ status: "declined", updatedAt: now }).where(eq(documents.id, d.id));
  await log(ctx, d.id, "declined", { signerId: s.id, actorName: s.name, ip: client.ip, userAgent: client.userAgent, detail: reason });
  await ctx.events.emit("docs.request.declined", { documentId: d.id, title: d.title, signerName: s.name, signerEmail: s.email, reason });
  await emailOwner(ctx, d, `Declined: “${d.title}”`, [`${s.name} declined to sign “${d.title}”.`, `Their reason: ${reason}`]);
  return publicView(ctx, token, client);
}

export async function publicDownload(ctx: ModuleContext, token: string) {
  const { d } = await byToken(ctx, token);
  if (d.status !== "completed" || !d.signedData) throw E.notFound("Signed copy");
  return { fileName: signedName(d.fileName), contentType: "application/pdf", data: d.signedData.toString("base64") };
}

// ───────── Templates ─────────
export const TemplateInput = z.object({
  name: z.string().trim().min(1, "Name the template").max(120), body: z.string().min(1, "Write the text of the template").max(50000), folder: Folder.optional(),
}).strict();
const templateDto = (t: typeof templates.$inferSelect) => ({ id: t.id, name: t.name, body: t.body, folder: t.folder, placeholders: placeholders(t.body), updatedAt: t.updatedAt });
export async function listTemplates(ctx: ModuleContext) {
  return (await ctx.db.select().from(templates).orderBy(asc(templates.name))).map(templateDto);
}
async function uniqueTemplateName(ctx: ModuleContext, name: string, except?: string) {
  const [dup] = await ctx.db.select({ id: templates.id }).from(templates).where(sql`lower(${templates.name}) = lower(${name})`);
  if (dup && dup.id !== except) throw E.conflict(`There's already a template called “${name}”`);
}
export async function createTemplate(ctx: ModuleContext, input: z.infer<typeof TemplateInput>) {
  await uniqueTemplateName(ctx, input.name);
  const id = uuidv7();
  await ctx.db.insert(templates).values({ id, tenantId: ctx.tenantId, name: input.name, body: input.body, folder: input.folder ?? "", createdBy: me(ctx) });
  await ctx.audit.log("template.created", { type: "docs_template", id }, { name: input.name });
  return templateDto((await ctx.db.select().from(templates).where(eq(templates.id, id)))[0]!);
}
export async function updateTemplate(ctx: ModuleContext, id: string, input: z.infer<typeof TemplateInput>) {
  const [t] = await ctx.db.select().from(templates).where(eq(templates.id, id));
  if (!t) throw E.notFound("Template");
  await uniqueTemplateName(ctx, input.name, id);
  await ctx.db.update(templates).set({ name: input.name, body: input.body, folder: input.folder ?? "", updatedAt: new Date() }).where(eq(templates.id, id));
  return templateDto((await ctx.db.select().from(templates).where(eq(templates.id, id)))[0]!);
}
export async function deleteTemplate(ctx: ModuleContext, id: string) {
  const [t] = await ctx.db.select().from(templates).where(eq(templates.id, id));
  if (!t) throw E.notFound("Template");
  await ctx.db.delete(templates).where(eq(templates.id, id));
  await ctx.audit.log("template.deleted", { type: "docs_template", id }, { name: t.name });
}

export async function teamPeople(ctx: ModuleContext) {
  return (await ctx.people.list()).map((p) => ({ userId: p.userId, name: p.name, email: p.email })).sort((a, b) => a.name.localeCompare(b.name));
}

// ───────── Settings check ─────────
export async function testEmail(ctx: ModuleContext) {
  const { smtp, missing } = smtpOf(ctx);
  if (!smtp) throw E.badRequest(`Fill in: ${missing.join(", ")}`);
  const u = me(ctx);
  const to = u ? (await ctx.people.get(u))?.email : null;
  if (!to) throw E.badRequest("Only a signed-in person can send a test email");
  try {
    await send(smtp, { to, subject: "Test email from Docs", ...compose({ greeting: "Hi,", lines: ["Signing emails from Docs will be sent like this one."] }) });
  } catch (e) { throw E.badRequest(e instanceof MailError ? e.message : "The email couldn't be sent"); }
  return { sentTo: to };
}

// ───────── Scheduled: expiry and reminders ─────────
const MAX_REMINDERS = 5;
export async function sweep(ctx: ModuleContext) {
  const today = todayIso();
  const open = await ctx.db.select().from(documents).where(eq(documents.status, "sent"));
  const ready = !!smtpOf(ctx).smtp;
  for (const d of open) {
    if (d.expiresOn && d.expiresOn < today) {
      await ctx.db.update(documents).set({ status: "expired", updatedAt: new Date() }).where(eq(documents.id, d.id));
      await log(ctx, d.id, "expired", { detail: d.expiresOn });
      await ctx.events.emit("docs.request.expired", { documentId: d.id, title: d.title, expiresOn: d.expiresOn });
      await emailOwner(ctx, d, `Expired: “${d.title}”`, [`“${d.title}” wasn't signed by everyone before ${d.expiresOn}, so the signing links stopped working.`, "You can send it again from Docs."]);
      continue;
    }
    if (!ready || d.remindEveryDays <= 0) continue;
    const all = await ctx.db.select().from(signers).where(and(eq(signers.documentId, d.id), isNotNull(signers.notifiedAt)));
    const due = Date.now() - d.remindEveryDays * 86_400_000;
    for (const s of currentSigners(d, await ctx.db.select().from(signers).where(eq(signers.documentId, d.id)))) {
      const row = all.find((x) => x.id === s.id);
      if (!row || row.remindersSent >= MAX_REMINDERS) continue;
      const last = (row.lastRemindedAt ?? row.notifiedAt)!.getTime();
      if (last <= due) await emailSigner(ctx, d, row, "reminder");
    }
  }
}
