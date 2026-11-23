import { randomBytes } from "node:crypto";
import { and, desc, eq, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "@office/db";
import { moduleErrors as E, type ModuleContext } from "@office/sdk";
import { activities, forms, leads, SOURCES, STATUSES, type ActivityKind, type LeadStatus } from "./schema.ts";

// ── Settings ─────────────────────────────────────────────────────────────────
export interface Settings { currency: string }
export const settingsOf = (ctx: ModuleContext): Settings => ({ currency: "EUR", ...ctx.settings.get<Partial<Settings>>() });

/** Statuses of leads still being worked on. */
export const OPEN: LeadStatus[] = ["new", "contacted", "qualified"];

// ── Input schemas ────────────────────────────────────────────────────────────
const opt = (max: number) => z.string().trim().max(max).nullish();
const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(320);
const currency = z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, e.g. EUR");

const fields = {
  firstName: opt(200), lastName: opt(200), email: email.nullish().or(z.literal("").transform(() => null)), phone: opt(50),
  companyName: opt(300), jobTitle: opt(200),
  source: z.enum(SOURCES).optional(),
  ownerId: z.uuid().nullish(),
  valueCents: z.number().int().min(0).max(1e15).optional(),
  currency: currency.optional(),
  followUpOn: z.iso.date().nullish(),
  message: opt(5000), notes: opt(10_000),
};
const someoneToReach = (l: { firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null; companyName?: string | null }) =>
  !!(l.firstName || l.lastName || l.email || l.phone || l.companyName);
export const LeadInput = z.object(fields).strict().refine(someoneToReach, { message: "Add at least a name, an email, a phone number or a company" });
export const LeadPatch = z.object(fields).partial().strict();
export const StatusInput = z.object({ status: z.enum(STATUSES).exclude(["converted"]), reason: opt(500) }).strict();
export const ActivityInput = z.object({ kind: z.enum(["note", "call", "meeting", "email"]).default("note"), body: z.string().trim().min(1).max(10_000) }).strict();
export const ListQuery = z.object({
  view: z.enum(["open", "all", ...STATUSES]).default("open"),
  source: z.enum(SOURCES).optional(),
  ownerId: z.uuid().optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.uuid().optional(),
});
export const ConvertInput = z.object({
  /** Also create (or reuse) a company from the lead's company name. */
  company: z.boolean().default(true),
  /** Ask CRM (if it's on) to open a deal for the new customer. */
  deal: z.object({ title: z.string().trim().min(1).max(300), valueCents: z.number().int().min(0).max(1e15).default(0), currency: currency.optional() }).strict().nullish(),
}).strict();
export const FormInput = z.object({
  enabled: z.boolean().optional(),
  heading: z.string().trim().min(1).max(200).optional(),
  intro: opt(1000),
  thanks: z.string().trim().min(1).max(1000).optional(),
  askPhone: z.boolean().optional(),
  askCompany: z.boolean().optional(),
}).strict();
export const Token = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/) });
export const PublicSubmit = z.object({
  name: z.string().trim().min(1, "Please enter your name").max(200),
  email,
  phone: opt(50), company: opt(300),
  message: z.string().trim().max(5000).optional(),
  /** Honeypot: hidden from people, filled in by bots. */
  website: z.string().max(500).optional(),
}).strict();

// ── Helpers ──────────────────────────────────────────────────────────────────
type Lead = typeof leads.$inferSelect;
const actorRef = (ctx: ModuleContext) => `${ctx.actor.type}:${ctx.actor.id}`;
const today = () => new Date().toISOString().slice(0, 10);
const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
export const leadName = (l: Pick<Lead, "firstName" | "lastName" | "email" | "companyName" | "phone">) =>
  [l.firstName, l.lastName].filter(Boolean).join(" ") || l.email || l.companyName || l.phone || "Lead";
const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New", contacted: "Contacted", qualified: "Qualified", disqualified: "Disqualified", converted: "Converted",
};
const SOURCE_LABEL: Record<string, string> = {
  manual: "Added by hand", web_form: "Web form", referral: "Referral", event: "Event", phone: "Phone call", email: "Email",
  social: "Social media", ads: "Ads", workflow: "Workflow", other: "Other",
};

async function loadLead(ctx: ModuleContext, id: string, lock = false): Promise<Lead> {
  const q = ctx.db.select().from(leads).where(eq(leads.id, id));
  const [r] = lock ? await q.for("update") : await q;
  if (!r) throw E.notFound("Lead");
  return r;
}

async function ownerNames(ctx: ModuleContext, rows: Lead[]) {
  const ids = [...new Set(rows.map((r) => r.ownerId).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  await Promise.all(ids.map(async (id) => { const p = await ctx.people.get(id).catch(() => null); if (p) names.set(id, p.name || p.email); }));
  return names;
}

const dto = (r: Lead, owners: Map<string, string>) => ({
  id: r.id, name: leadName(r), firstName: r.firstName, lastName: r.lastName, email: r.email, phone: r.phone,
  companyName: r.companyName, jobTitle: r.jobTitle, source: r.source, status: r.status,
  ownerId: r.ownerId, ownerName: r.ownerId ? owners.get(r.ownerId) ?? null : null,
  valueCents: r.valueCents, currency: r.currency, followUpOn: r.followUpOn, message: r.message, notes: r.notes,
  disqualifyReason: r.disqualifyReason, contactId: r.contactId, companyId: r.companyId, convertedAt: r.convertedAt,
  statusChangedAt: r.statusChangedAt, createdAt: r.createdAt, updatedAt: r.updatedAt,
});
export type LeadDto = ReturnType<typeof dto>;

/** Event payload v1 (stable contract for workflows, webhooks and CRM's leads.lead.converted handler). */
const payload = (r: Lead) => ({
  id: r.id, name: leadName(r), firstName: r.firstName, lastName: r.lastName, email: r.email, phone: r.phone,
  companyName: r.companyName, source: r.source, status: r.status, ownerId: r.ownerId,
  valueCents: r.valueCents, currency: r.currency, contactId: r.contactId, companyId: r.companyId,
});

async function log(ctx: ModuleContext, leadId: string, kind: ActivityKind, body: string) {
  const [a] = await ctx.db.insert(activities).values({ id: uuidv7(), tenantId: ctx.tenantId, leadId, kind, body, createdBy: actorRef(ctx) }).returning();
  return a!;
}

async function checkOwner(ctx: ModuleContext, ownerId: string | null | undefined) {
  if (ownerId && !(await ctx.people.get(ownerId))) throw E.badRequest("The owner must be an active member of this business");
}

// ── Queries ──────────────────────────────────────────────────────────────────
export async function listLeads(ctx: ModuleContext, q: z.infer<typeof ListQuery>) {
  const where: (SQL | undefined)[] = [];
  if (q.view === "open") where.push(inArray(leads.status, OPEN));
  else if (q.view !== "all") where.push(eq(leads.status, q.view));
  if (q.source) where.push(eq(leads.source, q.source));
  if (q.ownerId) where.push(eq(leads.ownerId, q.ownerId));
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push(or(ilike(leads.firstName, like), ilike(leads.lastName, like), ilike(leads.email, like), ilike(leads.companyName, like), ilike(leads.phone, like),
      ilike(sql`coalesce(${leads.firstName}, '') || ' ' || coalesce(${leads.lastName}, '')`, like)));
  }
  if (q.cursor) where.push(lt(leads.id, q.cursor));
  const rows = await ctx.db.select().from(leads).where(and(...where)).orderBy(desc(leads.id)).limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const owners = await ownerNames(ctx, page);
  return { data: page.map((r) => dto(r, owners)), nextCursor: rows.length > q.limit ? page.at(-1)!.id : null };
}

export async function getLead(ctx: ModuleContext, id: string) {
  const r = await loadLead(ctx, id);
  const acts = await ctx.db.select().from(activities).where(eq(activities.leadId, id)).orderBy(desc(activities.createdAt), desc(activities.id)).limit(200);
  return {
    ...dto(r, await ownerNames(ctx, [r])),
    activities: acts.map((a) => ({ id: a.id, kind: a.kind, body: a.body, createdBy: a.createdBy, createdAt: a.createdAt })),
  };
}

export async function summary(ctx: ModuleContext) {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const since90 = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const [s] = await ctx.db.select({
    new: sql<number>`count(*) filter (where ${leads.status} = 'new')::int`,
    contacted: sql<number>`count(*) filter (where ${leads.status} = 'contacted')::int`,
    qualified: sql<number>`count(*) filter (where ${leads.status} = 'qualified')::int`,
    addedThisWeek: sql<number>`count(*) filter (where ${leads.createdAt} >= ${weekAgo}::timestamptz)::int`,
    followUpsDue: sql<number>`count(*) filter (where ${leads.status} in ('new', 'contacted', 'qualified') and ${leads.followUpOn} <= ${today()}::date)::int`,
    converted90: sql<number>`count(*) filter (where ${leads.status} = 'converted' and ${leads.statusChangedAt} >= ${since90}::timestamptz)::int`,
    disqualified90: sql<number>`count(*) filter (where ${leads.status} = 'disqualified' and ${leads.statusChangedAt} >= ${since90}::timestamptz)::int`,
  }).from(leads);
  const decided = (s?.converted90 ?? 0) + (s?.disqualified90 ?? 0);
  return {
    byStatus: { new: s?.new ?? 0, contacted: s?.contacted ?? 0, qualified: s?.qualified ?? 0 },
    open: (s?.new ?? 0) + (s?.contacted ?? 0) + (s?.qualified ?? 0),
    addedThisWeek: s?.addedThisWeek ?? 0,
    followUpsDue: s?.followUpsDue ?? 0,
    conversionRate90d: decided ? Math.round(((s?.converted90 ?? 0) / decided) * 100) : null,
  };
}

// ── Commands ─────────────────────────────────────────────────────────────────
export async function createLead(ctx: ModuleContext, input: z.input<typeof LeadInput>, opts: { source?: string; firstNote?: string } = {}) {
  const i = LeadInput.parse(input);
  await checkOwner(ctx, i.ownerId);
  const [row] = await ctx.db.insert(leads).values({
    id: uuidv7(), tenantId: ctx.tenantId,
    firstName: clean(i.firstName), lastName: clean(i.lastName), email: clean(i.email), phone: clean(i.phone),
    companyName: clean(i.companyName), jobTitle: clean(i.jobTitle), source: i.source ?? "manual", status: "new",
    ownerId: i.ownerId === undefined ? (ctx.actor.userId ?? null) : i.ownerId,
    valueCents: i.valueCents ?? 0, currency: i.currency ?? settingsOf(ctx).currency,
    followUpOn: i.followUpOn ?? null, message: clean(i.message), notes: clean(i.notes), createdBy: actorRef(ctx),
  }).returning();
  await log(ctx, row!.id, "system", opts.firstNote ?? `Lead added (${SOURCE_LABEL[row!.source] ?? row!.source})`);
  await ctx.audit.log("leads.lead.created", { type: "leads_lead", id: row!.id }, { name: leadName(row!), source: row!.source });
  await ctx.events.emit("leads.lead.created", payload(row!));
  return getLead(ctx, row!.id);
}

export async function updateLead(ctx: ModuleContext, id: string, patch: z.infer<typeof LeadPatch>) {
  const r = await loadLead(ctx, id, true);
  if (patch.ownerId !== undefined) await checkOwner(ctx, patch.ownerId);
  const set: Partial<Lead> = { updatedAt: new Date() };
  const changes: string[] = [];
  const keys = ["firstName", "lastName", "email", "phone", "companyName", "jobTitle", "source", "ownerId", "valueCents", "currency", "followUpOn", "message", "notes"] as const;
  for (const k of keys) {
    if (patch[k] === undefined) continue;
    const v = typeof patch[k] === "string" ? clean(patch[k] as string) : patch[k];
    if (v === r[k]) continue;
    (set as Record<string, unknown>)[k] = v;
    changes.push(k);
  }
  if (!changes.length) return getLead(ctx, id);
  if (!someoneToReach({ ...r, ...set })) throw E.badRequest("Add at least a name, an email, a phone number or a company");
  const [row] = await ctx.db.update(leads).set(set).where(eq(leads.id, id)).returning();
  if (changes.includes("ownerId")) {
    const owner = row!.ownerId ? await ctx.people.get(row!.ownerId) : null;
    await log(ctx, id, "system", owner ? `Assigned to ${owner.name || owner.email}` : "Unassigned");
  }
  await ctx.audit.log("leads.lead.updated", { type: "leads_lead", id }, Object.fromEntries(changes.map((k) => [k, (set as Record<string, unknown>)[k]])));
  await ctx.events.emit("leads.lead.updated", { ...payload(row!), changes });
  return getLead(ctx, id);
}

export async function setStatus(ctx: ModuleContext, id: string, input: z.infer<typeof StatusInput>) {
  const r = await loadLead(ctx, id, true);
  if (r.status === "converted") throw E.conflict("This lead was already converted into a customer");
  if (r.status === input.status) return getLead(ctx, id);
  const now = new Date();
  const [row] = await ctx.db.update(leads).set({
    status: input.status, statusChangedAt: now, updatedAt: now,
    disqualifyReason: input.status === "disqualified" ? (clean(input.reason) ?? r.disqualifyReason) : null,
  }).where(eq(leads.id, id)).returning();
  const reason = row!.disqualifyReason;
  await log(ctx, id, "status", input.status === "disqualified"
    ? `Disqualified${reason ? `: ${reason}` : ""}`
    : r.status === "disqualified" ? `Reopened as ${STATUS_LABEL[input.status]}` : `${STATUS_LABEL[r.status]} → ${STATUS_LABEL[input.status]}`);
  await ctx.audit.log("leads.lead.status_changed", { type: "leads_lead", id }, { from: r.status, to: input.status });
  const p = payload(row!);
  await ctx.events.emit("leads.lead.status_changed", { ...p, fromStatus: r.status });
  if (input.status === "qualified") await ctx.events.emit("leads.lead.qualified", p);
  if (input.status === "disqualified") await ctx.events.emit("leads.lead.disqualified", { ...p, reason });
  return getLead(ctx, id);
}

export async function addActivity(ctx: ModuleContext, leadId: string, input: z.infer<typeof ActivityInput>) {
  const r = await loadLead(ctx, leadId, true);
  const a = await log(ctx, leadId, input.kind, input.body);
  // Reaching out to a new lead means it has been contacted.
  if (r.status === "new" && input.kind !== "note") {
    await ctx.db.update(leads).set({ status: "contacted", statusChangedAt: new Date(), updatedAt: new Date() }).where(eq(leads.id, leadId));
    await log(ctx, leadId, "status", "New → Contacted");
    await ctx.events.emit("leads.lead.status_changed", { ...payload({ ...r, status: "contacted" }), fromStatus: "new" });
  } else {
    await ctx.db.update(leads).set({ updatedAt: new Date() }).where(eq(leads.id, leadId));
  }
  await ctx.events.emit("leads.activity.logged", { id: a.id, leadId, kind: a.kind, body: a.body.slice(0, 2000), name: leadName(r) });
  return { id: a.id, kind: a.kind, body: a.body, createdBy: a.createdBy, createdAt: a.createdAt };
}

export async function deleteLead(ctx: ModuleContext, id: string) {
  const r = await loadLead(ctx, id, true);
  await ctx.db.delete(leads).where(eq(leads.id, id));
  await ctx.audit.log("leads.lead.deleted", { type: "leads_lead", id }, { name: leadName(r) });
  await ctx.events.emit("leads.lead.deleted", { id, name: leadName(r) });
}

/**
 * Turns a lead into a customer: reuses the contact with the same email (or creates one), and the company with the
 * same name (or creates one). The lead keeps links to both. With `deal`, CRM (when it's on) opens a deal for them.
 */
export async function convertLead(ctx: ModuleContext, id: string, input: z.infer<typeof ConvertInput>) {
  const r = await loadLead(ctx, id, true);
  if (r.status === "converted") throw E.conflict("This lead was already converted");
  let companyId: string | null = null, companyReused = false;
  if (input.company && r.companyName) {
    const found = await ctx.data.companies.list({ q: r.companyName, limit: 20 });
    const hit = found.data.find((c) => String(c.name ?? "").trim().toLowerCase() === r.companyName!.toLowerCase());
    if (hit) { companyId = String(hit.id); companyReused = true; }
    else companyId = String((await ctx.data.companies.create({ name: r.companyName })).id);
  }
  let contactId: string | null = null, contactReused = false;
  if (r.email) {
    const found = await ctx.data.contacts.list({ q: r.email, limit: 20 });
    const hit = found.data.find((c) => String(c.email ?? "").toLowerCase() === r.email);
    if (hit) { contactId = String(hit.id); contactReused = true; }
  }
  if (!contactId && (r.firstName || r.lastName || r.email || r.phone)) {
    contactId = String((await ctx.data.contacts.create({
      firstName: r.firstName, lastName: r.lastName, email: r.email, phone: r.phone, companyId,
    })).id);
  }
  const now = new Date();
  const [row] = await ctx.db.update(leads).set({
    status: "converted", convertedAt: now, statusChangedAt: now, updatedAt: now, contactId, companyId, disqualifyReason: null,
  }).where(eq(leads.id, id)).returning();
  const what = [contactId && (contactReused ? "linked to an existing contact" : "contact created"), companyId && (companyReused ? "existing company" : "company created")].filter(Boolean);
  await log(ctx, id, "status", `Converted into a customer${what.length ? ` (${what.join(", ")})` : ""}${input.deal ? `; deal “${input.deal.title}” requested in CRM` : ""}`);
  await ctx.audit.log("leads.lead.converted", { type: "leads_lead", id }, { contactId, companyId, deal: input.deal?.title ?? null });
  await ctx.events.emit("leads.lead.converted", {
    ...payload(row!),
    deal: input.deal ? { title: input.deal.title, valueCents: input.deal.valueCents, currency: input.deal.currency ?? row!.currency } : null,
  });
  return { ...(await getLead(ctx, id)), contactReused, companyReused };
}

// ── Web form ─────────────────────────────────────────────────────────────────
const newToken = () => randomBytes(24).toString("base64url");
const formDto = (f: typeof forms.$inferSelect) => ({
  enabled: f.enabled, token: f.token, heading: f.heading, intro: f.intro, thanks: f.thanks, askPhone: f.askPhone, askCompany: f.askCompany,
  path: `/p/${f.tenantId}/leads/form/${f.token}`,
});

async function ensureForm(ctx: ModuleContext) {
  const [f] = await ctx.db.select().from(forms);
  if (f) return f;
  const [row] = await ctx.db.insert(forms).values({
    id: uuidv7(), tenantId: ctx.tenantId, token: newToken(), enabled: false, heading: "Get in touch",
    intro: "Tell us a little about what you need and we'll get back to you.", thanks: "Thanks! We'll be in touch soon.",
    askPhone: true, askCompany: true,
  }).onConflictDoNothing().returning();
  return row ?? (await ctx.db.select().from(forms))[0]!;
}

export async function getForm(ctx: ModuleContext) { return formDto(await ensureForm(ctx)); }

export async function saveForm(ctx: ModuleContext, input: z.infer<typeof FormInput>) {
  const f = await ensureForm(ctx);
  const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  const [row] = await ctx.db.update(forms).set({ ...set, intro: "intro" in input ? clean(input.intro) : f.intro, updatedAt: new Date() }).where(eq(forms.id, f.id)).returning();
  await ctx.audit.log("leads.form.updated", { type: "leads_form", id: f.id }, set);
  return formDto(row!);
}

/** A new link; the old one stops working (e.g. when it attracts spam). */
export async function replaceFormLink(ctx: ModuleContext) {
  const f = await ensureForm(ctx);
  const [row] = await ctx.db.update(forms).set({ token: newToken(), updatedAt: new Date() }).where(eq(forms.id, f.id)).returning();
  await ctx.audit.log("leads.form.link_replaced", { type: "leads_form", id: f.id });
  return formDto(row!);
}

async function liveForm(ctx: ModuleContext, token: string) {
  const [f] = await ctx.db.select().from(forms).where(eq(forms.token, token));
  if (!f || !f.enabled) throw E.notFound("Form");
  return f;
}

export async function publicFormView(ctx: ModuleContext, token: string) {
  const f = await liveForm(ctx, token);
  return { heading: f.heading, intro: f.intro, askPhone: f.askPhone, askCompany: f.askCompany };
}

/** Someone filled in the public form: a new lead, or a note on their open lead if they wrote before. */
export async function publicSubmit(ctx: ModuleContext, token: string, body: z.infer<typeof PublicSubmit>, _client: { ip: string; userAgent: string | null }) {
  const f = await liveForm(ctx, token);
  if (body.website) return { thanks: f.thanks }; // a bot; say thanks and keep nothing
  const parts = body.name.split(/\s+/).filter(Boolean);
  const message = clean(body.message);
  const [open] = await ctx.db.select().from(leads)
    .where(and(sql`lower(${leads.email}) = ${body.email}`, inArray(leads.status, OPEN))).orderBy(desc(leads.id)).limit(1);
  if (open) {
    await log(ctx, open.id, "email", `Sent the web form again${message ? `:\n${message}` : ""}`);
    await ctx.db.update(leads).set({ updatedAt: new Date() }).where(eq(leads.id, open.id));
    await ctx.events.emit("leads.activity.logged", { id: open.id, leadId: open.id, kind: "email", body: (message ?? "").slice(0, 2000), name: leadName(open) });
    return { thanks: f.thanks };
  }
  await createLead(ctx, {
    firstName: parts[0] ?? null, lastName: parts.slice(1).join(" ") || null, email: body.email,
    phone: f.askPhone ? clean(body.phone) : null, companyName: f.askCompany ? clean(body.company) : null,
    message, source: "web_form", ownerId: null,
  }, { firstNote: "Sent the web form" });
  return { thanks: f.thanks };
}
