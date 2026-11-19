import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "@office/db";
import { moduleErrors as E, type ModuleContext } from "@office/sdk";
import { renderDocPdf } from "./pdf.ts";
import { fieldsIn, merge } from "./render.ts";
import { documents, events, signers, templates, type Doc, type EventKind, type Signer } from "./schema.ts";

export const P = { read: "docs:documents.read", send: "docs:documents.send", manage: "docs:templates.manage" } as const;
const pgCode = (e: unknown): string | undefined => (e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code;
const actorRef = (ctx: ModuleContext) => ctx.actor.userId ?? `${ctx.actor.type}:${ctx.actor.id}`;

// ───────────────────────── settings ─────────────────────────
export interface DocsSettings { senderName: string; expiryDays: number }
export const SETTINGS_SCHEMA = {
  type: "object",
  properties: {
    senderName: { type: "string", title: "Your organization's name, shown to signers", default: "", maxLength: 120 },
    expiryDays: { type: "integer", title: "Signing links expire after (days)", default: 30, minimum: 1, maximum: 365 },
  },
  additionalProperties: false,
} as const;
export const settingsOf = (ctx: ModuleContext): DocsSettings => ({ senderName: "", expiryDays: 30, ...ctx.settings.get<Partial<DocsSettings>>() });
const sender = (ctx: ModuleContext) => settingsOf(ctx).senderName || "Office";

// ───────────────────────── input schemas ─────────────────────────
const Body = z.string().trim().min(1).max(100_000);
const Title = z.string().trim().min(1).max(200);
export const TemplateIn = z.object({ name: z.string().trim().min(1).max(120), title: Title, body: Body });
export const TemplatePatch = TemplateIn.partial().extend({ archived: z.boolean().optional() }).refine((x) => Object.keys(x).length > 0, "Nothing to change");
const SignerIn = z.object({ name: z.string().trim().min(1).max(200), email: z.email().max(254).transform((s) => s.toLowerCase()) });
const Values = z.record(z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/).max(60), z.string().max(2000)).refine((v) => Object.keys(v).length <= 50, "Too many values");
export const DocIn = z.object({
  templateId: z.uuid().optional(), title: Title.optional(), body: Body.optional(), contactId: z.uuid().optional(),
  values: Values.default({}), signers: z.array(SignerIn).max(10).default([]), inOrder: z.boolean().default(false),
  message: z.string().trim().max(2000).optional(),
}).refine((d) => d.templateId || (d.title && d.body), "Pick a template or write a title and text");
export const DocPatch = z.object({
  title: Title.optional(), body: Body.optional(), signers: z.array(SignerIn).min(1).max(10).optional(), inOrder: z.boolean().optional(),
  message: z.string().trim().max(2000).nullable().optional(),
}).refine((x) => Object.keys(x).length > 0, "Nothing to change");
export const DocQuery = z.object({
  status: z.enum(["draft", "sent", "completed", "declined", "voided", "expired"]).optional(), q: z.string().trim().max(100).optional(),
  contactId: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.uuid().optional(),
});
export const SendIn = z.object({ expiresInDays: z.number().int().min(1).max(365).optional() });
export const VoidIn = z.object({ reason: z.string().trim().min(1, "Say why").max(1000) });
export const TokenIn = z.object({ token: z.string().max(100) });
export const SignIn = TokenIn.extend({
  name: z.string().trim().min(2, "Type your full name").max(200),
  signature: z.string().max(280_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "Signature must be a PNG").optional(),
  agree: z.literal(true, { error: "Please agree to sign electronically" }),
});
export const DeclineIn = TokenIn.extend({ reason: z.string().trim().min(1, "Tell the sender why").max(1000) });

// ───────────────────────── helpers ─────────────────────────
const hashToken = (t: string) => createHash("sha256").update(t).digest();
const contentHash = (title: string, body: string) => createHash("sha256").update(`${title}\n\n${body}`).digest("hex");

async function trail(ctx: ModuleContext, documentId: string, kind: EventKind, o: { signerId?: string | null; actor?: string | null; ip?: string | null; detail?: Record<string, unknown> } = {}) {
  await ctx.db.insert(events).values({
    id: uuidv7(), tenantId: ctx.tenantId, documentId, kind, signerId: o.signerId ?? null, actor: o.actor ?? null, ip: o.ip ?? null, detail: o.detail ?? {},
  });
}
async function loadDoc(ctx: ModuleContext, id: string, lock = false) {
  const q = ctx.db.select().from(documents).where(eq(documents.id, id));
  const [d] = lock ? await q.for("update") : await q;
  if (!d) throw E.notFound("Document");
  return d;
}
const docSigners = (ctx: ModuleContext, id: string) => ctx.db.select().from(signers).where(eq(signers.documentId, id)).orderBy(asc(signers.position));
const eventPayload = (d: Doc, extra: Record<string, unknown> = {}) => ({ id: d.id, number: d.number, title: d.title, contactId: d.contactId, ...extra });

/** Merge values: contact, company, org, today, plus caller-supplied ones (which win). */
async function mergeValues(ctx: ModuleContext, contactId: string | undefined, given: Record<string, string>) {
  const v: Record<string, string> = { "org.name": sender(ctx), today: await ctx.clock.today() };
  let contactEmail: string | null = null, contactName = "";
  if (contactId) {
    const c = await ctx.data.contacts.get(contactId);
    const str = (x: unknown) => (typeof x === "string" ? x : "");
    contactName = [str(c.firstName), str(c.lastName)].filter(Boolean).join(" ");
    contactEmail = str(c.email) || null;
    Object.assign(v, { "contact.first_name": str(c.firstName), "contact.last_name": str(c.lastName), "contact.name": contactName, "contact.email": contactEmail ?? "" });
    if (typeof c.companyId === "string") {
      try { v["company.name"] = str((await ctx.data.companies.get(c.companyId)).name); } catch { /* no access or deleted */ }
    }
  }
  return { values: { ...v, ...given }, contactEmail, contactName };
}

async function nextNumber(ctx: ModuleContext) {
  await ctx.db.execute(sql`select pg_advisory_xact_lock(hashtext('docs_number:' || ${ctx.tenantId}))`);
  const [r] = await ctx.db.select({ n: sql<number>`coalesce(max(${documents.number}), 0)::int + 1` }).from(documents);
  return r!.n;
}

async function writeSigners(ctx: ModuleContext, documentId: string, list: z.infer<typeof SignerIn>[]) {
  if (new Set(list.map((s) => s.email)).size !== list.length) throw E.badRequest("Each signer needs their own email address");
  await ctx.db.delete(signers).where(eq(signers.documentId, documentId));
  if (list.length) {
    await ctx.db.insert(signers).values(list.map((s, i) => ({ id: uuidv7(), tenantId: ctx.tenantId, documentId, position: i, name: s.name, email: s.email, status: "waiting" as const })));
  }
}

// ───────────────────────── templates ─────────────────────────
const SAMPLE = `# Agreement

This agreement is made on {{today}} between {{org.name}} and {{contact.name}}.

## Scope
{{scope}}

## Terms
- Payment is due within 30 days of each invoice.
- Either party may end this agreement with 30 days' written notice.

By signing below, both parties agree to these terms.`;
export async function seedTemplates(ctx: ModuleContext) {
  const [any] = await ctx.db.select({ id: templates.id }).from(templates).limit(1);
  if (!any) await ctx.db.insert(templates).values({ id: uuidv7(), tenantId: ctx.tenantId, name: "Simple agreement", title: "Agreement with {{contact.name}}", body: SAMPLE, archived: false, createdBy: "system" });
}
export async function listTemplates(ctx: ModuleContext, includeArchived = false) {
  const rows = await ctx.db.select().from(templates).where(includeArchived ? undefined : eq(templates.archived, false)).orderBy(asc(sql`lower(${templates.name})`));
  return { data: rows.map(({ tenantId: _t, ...t }) => ({ ...t, fields: fieldsIn(t.title, t.body) })) };
}
const templateErr = (e: unknown): never => { if (pgCode(e) === "23505") throw E.conflict("A template with this name exists"); throw e; };
export async function createTemplate(ctx: ModuleContext, i: z.infer<typeof TemplateIn>) {
  try {
    const [t] = await ctx.db.insert(templates).values({ id: uuidv7(), tenantId: ctx.tenantId, ...i, archived: false, createdBy: actorRef(ctx) }).returning();
    await ctx.audit.log("template.created", { type: "docs.template", id: t!.id }, { name: i.name });
    return { ...t!, fields: fieldsIn(t!.title, t!.body) };
  } catch (e) { return templateErr(e); }
}
export async function updateTemplate(ctx: ModuleContext, id: string, p: z.infer<typeof TemplatePatch>) {
  try {
    const [t] = await ctx.db.update(templates).set({ ...p, updatedAt: new Date() }).where(eq(templates.id, id)).returning();
    if (!t) throw E.notFound("Template");
    await ctx.audit.log("template.updated", { type: "docs.template", id }, { changed: Object.keys(p) });
    return { ...t, fields: fieldsIn(t.title, t.body) };
  } catch (e) { return templateErr(e); }
}

// ───────────────────────── documents ─────────────────────────
export async function createDoc(ctx: ModuleContext, i: z.infer<typeof DocIn>) {
  let title = i.title, body = i.body;
  if (i.templateId) {
    const [t] = await ctx.db.select().from(templates).where(eq(templates.id, i.templateId));
    if (!t || t.archived) throw E.notFound("Template");
    title ??= t.title; body ??= t.body;
  }
  const { values, contactEmail, contactName } = await mergeValues(ctx, i.contactId, i.values);
  const mt = merge(title!, values), mb = merge(body!, values);
  const missing = [...new Set([...mt.missing, ...mb.missing])];
  const list = i.signers.length ? i.signers : contactEmail ? [{ name: contactName || contactEmail, email: contactEmail.toLowerCase() }] : [];
  const id = uuidv7();
  const [d] = await ctx.db.insert(documents).values({
    id, tenantId: ctx.tenantId, number: await nextNumber(ctx), title: mt.text.slice(0, 200), body: mb.text, status: "draft",
    templateId: i.templateId ?? null, contactId: i.contactId ?? null, message: i.message || null, inOrder: i.inOrder, createdBy: actorRef(ctx),
  }).returning();
  await writeSigners(ctx, id, list);
  await trail(ctx, id, "created", { actor: actorRef(ctx), detail: { template: i.templateId ?? null } });
  await ctx.audit.log("document.created", { type: "docs.document", id }, { number: d!.number, title: d!.title });
  return { ...(await getDoc(ctx, id)), missing };
}

export async function updateDoc(ctx: ModuleContext, id: string, p: z.infer<typeof DocPatch>) {
  const d = await loadDoc(ctx, id, true);
  if (d.status !== "draft") throw E.conflict("Only drafts can be edited");
  const { signers: list, ...rest } = p;
  await ctx.db.update(documents).set({ ...rest, updatedAt: new Date() }).where(eq(documents.id, id));
  if (list) await writeSigners(ctx, id, list);
  await ctx.audit.log("document.updated", { type: "docs.document", id }, { changed: Object.keys(p) });
  return getDoc(ctx, id);
}

const signerView = (s: Signer) => ({
  id: s.id, position: s.position, name: s.name, email: s.email, status: s.status, viewedAt: s.viewedAt, signedAt: s.signedAt,
  signedName: s.signedName, hasSignatureImage: !!s.signaturePng, declineReason: s.declineReason, lastSentAt: s.lastSentAt,
});
export async function listDocs(ctx: ModuleContext, q: z.infer<typeof DocQuery>) {
  const conds: (SQL | undefined)[] = [];
  if (q.status) conds.push(eq(documents.status, q.status));
  if (q.contactId) conds.push(eq(documents.contactId, q.contactId));
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(documents.title, like), sql`exists (select 1 from docs_signers s where s.document_id = ${documents.id} and (s.email ilike ${like} or s.name ilike ${like}))`,
      /^\d{1,9}$/.test(q.q) ? eq(documents.number, Number(q.q)) : undefined));
  }
  if (q.cursor) conds.push(lt(documents.id, q.cursor));
  const rows = await ctx.db.select().from(documents).where(and(...conds)).orderBy(desc(documents.id)).limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const ss = page.length ? await ctx.db.select().from(signers).where(inArray(signers.documentId, page.map((d) => d.id))).orderBy(asc(signers.position)) : [];
  return {
    data: page.map(({ tenantId: _t, body: _b, ...d }) => ({
      ...d, signers: ss.filter((s) => s.documentId === d.id).map((s) => ({ name: s.name, email: s.email, status: s.status })),
    })),
    nextCursor: rows.length > q.limit ? page.at(-1)!.id : null,
  };
}

export async function getDoc(ctx: ModuleContext, id: string) {
  const { tenantId: _t, ...d } = await loadDoc(ctx, id);
  const ss = await docSigners(ctx, id);
  const ev = await ctx.db.select().from(events).where(eq(events.documentId, id)).orderBy(asc(events.at), asc(events.id));
  const names = await ctx.people.names(ev.map((e) => e.actor ?? "").concat(d.createdBy));
  return {
    ...d, createdByName: names[d.createdBy] ?? null, unresolved: fieldsIn(d.title, d.body), signers: ss.map(signerView),
    trail: ev.map((e) => ({ id: e.id, kind: e.kind, at: e.at, who: e.actor ? (names[e.actor] ?? (e.actor.includes("@") ? e.actor : "Workflow")) : null, ip: e.ip, signerId: e.signerId })),
  };
}

/** New link token for a signer (rotates the old one) and the email with it. */
async function sendLink(ctx: ModuleContext, d: Doc, s: Signer, kind: "request" | "reminder") {
  const token = randomBytes(32).toString("base64url");
  await ctx.db.update(signers).set({ tokenHash: hashToken(token), lastSentAt: new Date(), ...(s.status === "waiting" ? { status: "pending" as const } : {}) }).where(eq(signers.id, s.id));
  const link = await ctx.mail.publicPageUrl(`/sign/${s.id}#${token}`);
  const from = sender(ctx);
  const lines = [
    `Hello ${s.name},`, "",
    `${from} ${kind === "reminder" ? "is still waiting for your signature on" : "has sent you a document to sign"}: "${d.title}".`,
    ...(d.message ? ["", d.message] : []),
    "", "Review and sign it here:", link, "",
    d.expiresAt ? `This link works until ${d.expiresAt.toISOString().slice(0, 10)}. Don't forward it: anyone with the link can sign as you.` : "Don't forward this link: anyone with it can sign as you.",
  ];
  await ctx.mail.send({ to: s.email, subject: `${kind === "reminder" ? "Reminder: " : ""}Please sign: ${d.title}`, text: lines.join("\n"), fromName: from });
}

export async function sendDoc(ctx: ModuleContext, id: string, o: z.infer<typeof SendIn>) {
  const d = await loadDoc(ctx, id, true);
  if (d.status !== "draft") throw E.conflict("This document was already sent");
  const unresolved = fieldsIn(d.title, d.body);
  if (unresolved.length) throw E.unprocessable(`Fill in the remaining fields first: ${unresolved.join(", ")}`, { missing: unresolved });
  const ss = await docSigners(ctx, id);
  if (!ss.length) throw E.unprocessable("Add at least one signer");
  const now = new Date();
  const [sent] = await ctx.db.update(documents).set({
    status: "sent", sentAt: now, contentHash: contentHash(d.title, d.body), updatedAt: now,
    expiresAt: new Date(now.getTime() + (o.expiresInDays ?? settingsOf(ctx).expiryDays) * 86_400_000),
  }).where(eq(documents.id, id)).returning();
  for (const s of d.inOrder ? ss.slice(0, 1) : ss) await sendLink(ctx, sent!, s, "request");
  await trail(ctx, id, "sent", { actor: actorRef(ctx), detail: { to: (d.inOrder ? ss.slice(0, 1) : ss).map((s) => s.email), contentHash: sent!.contentHash } });
  await ctx.audit.log("document.sent", { type: "docs.document", id }, { signers: ss.length });
  await ctx.events.emit("docs.document.sent", eventPayload(sent!, { signers: ss.map((s) => s.email) }));
  return getDoc(ctx, id);
}

export async function remind(ctx: ModuleContext, id: string) {
  const d = await loadDoc(ctx, id, true);
  if (d.status !== "sent") throw E.conflict("Only documents waiting for signatures can be reminded");
  const due = (await docSigners(ctx, id)).filter((s) => s.status === "pending" || s.status === "viewed");
  const hourAgo = Date.now() - 3_600_000;
  const now = due.filter((s) => !s.lastSentAt || s.lastSentAt.getTime() < hourAgo);
  if (!now.length) throw E.conflict("A reminder went out less than an hour ago");
  for (const s of now) await sendLink(ctx, d, s, "reminder");
  await trail(ctx, id, "reminded", { actor: actorRef(ctx), detail: { to: now.map((s) => s.email) } });
  return getDoc(ctx, id);
}

export async function voidDoc(ctx: ModuleContext, id: string, reason: string) {
  const d = await loadDoc(ctx, id, true);
  if (d.status !== "sent" && d.status !== "draft") throw E.conflict("This document is already closed");
  if (d.createdBy !== actorRef(ctx) && !ctx.authz.can(P.manage)) throw E.forbidden("Only the sender or an admin can cancel this document");
  const [v] = await ctx.db.update(documents).set({ status: "voided", voidReason: reason, updatedAt: new Date() }).where(eq(documents.id, id)).returning();
  const notified = (await docSigners(ctx, id)).filter((s) => s.lastSentAt && s.status !== "signed");
  await ctx.db.update(signers).set({ tokenHash: null }).where(and(eq(signers.documentId, id), sql`${signers.status} not in ('signed', 'declined')`));
  for (const s of notified) {
    await ctx.mail.send({ to: s.email, subject: `Cancelled: ${d.title}`, fromName: sender(ctx), text: `Hello ${s.name},\n\n${sender(ctx)} cancelled "${d.title}". You don't need to sign it.\n\nReason: ${reason}` });
  }
  await trail(ctx, id, "voided", { actor: actorRef(ctx), detail: { reason } });
  await ctx.audit.log("document.voided", { type: "docs.document", id }, { reason });
  await ctx.events.emit("docs.document.voided", eventPayload(v!, { reason }));
  return getDoc(ctx, id);
}

async function pdfFor(ctx: ModuleContext, d: Doc) {
  const ss = await docSigners(ctx, d.id);
  const ev = await ctx.db.select().from(events).where(eq(events.documentId, d.id)).orderBy(asc(events.at), asc(events.id));
  const names = await ctx.people.names(ev.map((e) => e.actor ?? ""));
  return renderDocPdf({
    number: d.number, title: d.title, body: d.body, status: d.status, contentHash: d.contentHash, sender: sender(ctx), sentAt: d.sentAt, completedAt: d.completedAt,
    signers: ss.map((s) => ({ name: s.name, email: s.email, status: s.status, signedName: s.signedName, signedAt: s.signedAt, signedIp: s.signedIp, signaturePng: s.signaturePng })),
    trail: ev.map((e) => ({ at: e.at, kind: e.kind, who: e.actor ? (names[e.actor] ?? e.actor) : null, ip: e.ip })),
  });
}
export const docPdf = async (ctx: ModuleContext, id: string) => { const d = await loadDoc(ctx, id); return { d, bytes: await pdfFor(ctx, d) }; };

/** Expire documents whose signing window has passed. */
export async function expireDue(ctx: ModuleContext) {
  const due = await ctx.db.select().from(documents).where(and(eq(documents.status, "sent"), lt(documents.expiresAt, new Date()))).limit(200).for("update", { skipLocked: true });
  for (const d of due) {
    await ctx.db.update(documents).set({ status: "expired", updatedAt: new Date() }).where(eq(documents.id, d.id));
    await trail(ctx, d.id, "expired");
    await ctx.events.emit("docs.document.expired", eventPayload(d));
  }
  return due.length;
}

// ───────────────────────── signing (public, by link) ─────────────────────────
async function bySigner(ctx: ModuleContext, signerId: string, token: string, lock = false) {
  const [s] = await ctx.db.select().from(signers).where(eq(signers.id, signerId));
  const ok = !!s?.tokenHash && /^[\w-]{43}$/.test(token) && timingSafeEqual(Buffer.from(s.tokenHash), hashToken(token));
  if (!s || !ok) throw E.notFound("This signing link is not valid any more. Ask the sender for a new one");
  const d = await loadDoc(ctx, s.documentId, lock);
  if (d.status === "sent" && d.expiresAt && d.expiresAt.getTime() < Date.now()) throw E.conflict("This signing link has expired. Ask the sender for a new one");
  return { s, d };
}
async function publicView(ctx: ModuleContext, d: Doc, me: Signer) {
  const ss = await docSigners(ctx, d.id);
  const cur = ss.find((x) => x.id === me.id)!;
  return {
    document: { number: d.number, title: d.title, body: d.body, status: d.status, sender: sender(ctx), expiresAt: d.expiresAt, contentHash: d.contentHash, completedAt: d.completedAt },
    signer: { name: cur.name, email: cur.email, status: cur.status, signedAt: cur.signedAt },
    signers: ss.map((x) => ({ name: x.name, status: x.status, me: x.id === me.id })),
    canSign: d.status === "sent" && (cur.status === "pending" || cur.status === "viewed"),
  };
}

export async function openAsSigner(ctx: ModuleContext, signerId: string, token: string, ip: string) {
  const { s, d } = await bySigner(ctx, signerId, token);
  if (s.status === "pending" && d.status === "sent") {
    const [u] = await ctx.db.update(signers).set({ status: "viewed", viewedAt: new Date() }).where(and(eq(signers.id, s.id), eq(signers.status, "pending"))).returning();
    if (u) {
      await trail(ctx, d.id, "viewed", { signerId: s.id, actor: s.email, ip });
      await ctx.events.emit("docs.document.viewed", eventPayload(d, { signer: s.email }));
    }
  }
  return publicView(ctx, d, s);
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export async function signAsSigner(ctx: ModuleContext, signerId: string, i: z.infer<typeof SignIn>, ip: string, userAgent: string) {
  const { s, d } = await bySigner(ctx, signerId, i.token, true);   // locks the document: signers finish one at a time
  if (d.status !== "sent") throw E.conflict(`This document is ${d.status}`);
  const [me] = await ctx.db.select().from(signers).where(eq(signers.id, s.id));
  if (me!.status !== "pending" && me!.status !== "viewed") throw E.conflict(me!.status === "signed" ? "You already signed this document" : "It isn't your turn to sign yet");
  let png: Buffer | null = null;
  if (i.signature) {
    png = Buffer.from(i.signature.slice(i.signature.indexOf(",") + 1), "base64");
    if (png.length > 200_000 || !png.subarray(0, 8).equals(PNG)) throw E.badRequest("Signature must be a PNG under 200 KB");
  }
  const now = new Date();
  await ctx.db.update(signers).set({ status: "signed", signedAt: now, signedName: i.name, signaturePng: png, signedIp: ip, viewedAt: me!.viewedAt ?? now }).where(eq(signers.id, s.id));
  await trail(ctx, d.id, "signed", { signerId: s.id, actor: s.email, ip, detail: { typedName: i.name, drawn: !!png, userAgent, contentHash: d.contentHash, consent: "Agreed to sign electronically" } });
  await ctx.events.emit("docs.document.signed", eventPayload(d, { signer: s.email, name: i.name }));

  const ss = await docSigners(ctx, d.id);
  const next = ss.find((x) => x.status === "waiting");
  if (ss.every((x) => x.status === "signed")) {
    const [c] = await ctx.db.update(documents).set({ status: "completed", completedAt: now, updatedAt: now }).where(eq(documents.id, d.id)).returning();
    await trail(ctx, d.id, "completed", { detail: { contentHash: d.contentHash } });
    await ctx.events.emit("docs.document.completed", eventPayload(c!, { signers: ss.map((x) => x.email) }));
    for (const x of ss) {
      // the signer on the page keeps their token; everyone else gets a fresh link to the signed copy
      let token = i.token;
      if (x.id !== s.id) { token = randomBytes(32).toString("base64url"); await ctx.db.update(signers).set({ tokenHash: hashToken(token) }).where(eq(signers.id, x.id)); }
      await ctx.mail.send({
        to: x.email, subject: `Signed by everyone: ${d.title}`, fromName: sender(ctx),
        text: `Hello ${x.name},\n\n"${d.title}" has been signed by everyone. View and download the signed copy here:\n${await ctx.mail.publicPageUrl(`/sign/${x.id}#${token}`)}`,
      });
    }
  } else if (d.inOrder && next) {
    await sendLink(ctx, d, next, "request");
  }
  const [fresh] = await ctx.db.select().from(signers).where(eq(signers.id, s.id));
  return publicView(ctx, await loadDoc(ctx, d.id), fresh!);
}

export async function declineAsSigner(ctx: ModuleContext, signerId: string, i: z.infer<typeof DeclineIn>, ip: string) {
  const { s, d } = await bySigner(ctx, signerId, i.token, true);
  if (d.status !== "sent") throw E.conflict(`This document is ${d.status}`);
  if (s.status !== "pending" && s.status !== "viewed") throw E.conflict("You can't decline this document now");
  await ctx.db.update(signers).set({ status: "declined", declineReason: i.reason }).where(eq(signers.id, s.id));
  const [x] = await ctx.db.update(documents).set({ status: "declined", updatedAt: new Date() }).where(eq(documents.id, d.id)).returning();
  await trail(ctx, d.id, "declined", { signerId: s.id, actor: s.email, ip, detail: { reason: i.reason } });
  await ctx.events.emit("docs.document.declined", eventPayload(x!, { signer: s.email, reason: i.reason }));
  return publicView(ctx, x!, { ...s, status: "declined" });
}

export async function signerPdf(ctx: ModuleContext, signerId: string, token: string) {
  const { d } = await bySigner(ctx, signerId, token);
  return { d, bytes: await pdfFor(ctx, d) };
}
