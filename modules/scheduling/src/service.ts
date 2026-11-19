import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, eq, gte, inArray, lt, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "@office/db";
import { moduleErrors as E, type ModuleContext } from "@office/sdk";
import { bookings, hours, serviceHosts, services, timeOff, type BookingStatus } from "./schema.ts";

export const P = {
  read: "scheduling:booking.read", write: "scheduling:booking.write", own: "scheduling:availability.own",
  manage: "scheduling:availability.manage", services: "scheduling:service.manage",
} as const;

// ───────────────────────── settings ─────────────────────────
export interface SchedulingSettings {
  timezone: string; slotStepMin: number; minNoticeMin: number; maxDaysAhead: number; publicBooking: boolean; pageTitle: string; emailCustomers: boolean;
}
export const SETTINGS_SCHEMA = {
  type: "object",
  properties: {
    timezone: { type: "string", title: "Time zone of opening hours (IANA, e.g. Europe/Berlin)", default: "UTC", maxLength: 64 },
    slotStepMin: { type: "integer", title: "Offer a start time every (minutes)", default: 30, enum: [5, 10, 15, 20, 30, 60] },
    minNoticeMin: { type: "integer", title: "Minimum notice for online bookings (minutes)", default: 120, minimum: 0, maximum: 20160 },
    maxDaysAhead: { type: "integer", title: "Bookable up to (days ahead)", default: 60, minimum: 1, maximum: 365 },
    publicBooking: { type: "boolean", title: "Public booking page on", default: true },
    pageTitle: { type: "string", title: "Booking page title", default: "", maxLength: 120 },
    emailCustomers: { type: "boolean", title: "Email customers when a booking is made, moved or cancelled", default: true },
  },
  additionalProperties: false,
} as const;
const validTz = (tz: string) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } };
export const settingsOf = (ctx: ModuleContext): SchedulingSettings => {
  const s = { timezone: "UTC", slotStepMin: 30, minNoticeMin: 120, maxDaysAhead: 60, publicBooking: true, pageTitle: "", emailCustomers: true, ...ctx.settings.get<Partial<SchedulingSettings>>() };
  if (!validTz(s.timezone)) s.timezone = "UTC";
  return s;
};
/** YYYY-MM-DD of an instant in a time zone. */
export const localDate = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ───────────────────────── input schemas ─────────────────────────
const slug = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/, "lowercase letters, digits and dashes");
const ServiceFields = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slug,
  description: z.string().max(2000).nullable(),
  durationMin: z.number().int().min(5).max(720),
  bufferMin: z.number().int().min(0).max(240),
  location: z.string().max(300).nullable(),
  isPublic: z.boolean(),
  active: z.boolean(),
  hostIds: z.array(z.uuid()).max(50),
});
export const ServiceIn = ServiceFields.extend({
  slug: slug.optional(), description: z.string().max(2000).nullish(), location: z.string().max(300).nullish(),
  bufferMin: ServiceFields.shape.bufferMin.default(0), isPublic: z.boolean().default(true), active: z.boolean().default(true),
  hostIds: ServiceFields.shape.hostIds.default([]),
});
/** No defaults here: a patch must never reset fields it doesn't mention. */
export const ServicePatch = ServiceFields.partial().extend({ position: z.number().int().min(0).max(1000).optional() });
export const HoursIn = z.object({
  hostId: z.uuid().optional(),
  rules: z.array(z.object({ weekday: z.number().int().min(1).max(7), startMin: z.number().int().min(0).max(1439), endMin: z.number().int().min(1).max(1440) })
    .refine((r) => r.endMin > r.startMin, "end must be after start")).max(50),
});
export const TimeOffIn = z.object({ hostId: z.uuid().optional(), startsAt: z.iso.datetime({ offset: true }), endsAt: z.iso.datetime({ offset: true }), reason: z.string().max(200).nullish() });
const day = z.iso.date();
export const SlotQuery = z.object({ from: day, to: day, hostId: z.uuid().optional() });
export const Customer = z.object({
  name: z.string().trim().min(1).max(200), email: z.email().max(320).optional(), phone: z.string().trim().max(50).optional(), notes: z.string().max(2000).optional(),
});
export const BookingIn = z.object({
  serviceId: z.uuid(), start: z.iso.datetime({ offset: true }), hostId: z.uuid().optional(),
  contactId: z.uuid().optional(), name: z.string().trim().min(1).max(200).optional(), email: z.email().max(320).optional(),
  phone: z.string().trim().max(50).optional(), notes: z.string().max(2000).optional(),
  outsideHours: z.boolean().default(false).describe("team bookings may ignore opening hours (never double-books)"),
});
export const BookingQuery = z.object({
  from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(),
  hostId: z.uuid().optional(), contactId: z.uuid().optional(), status: z.enum(["confirmed", "cancelled", "completed", "no_show"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export const PublicBookIn = z.object({
  start: z.iso.datetime({ offset: true }), name: z.string().trim().min(1).max(200), email: z.email().max(320),
  phone: z.string().trim().max(50).optional(), notes: z.string().max(1000).optional(),
  website: z.string().max(200).optional().describe("honeypot: must be empty"),
});

const me = (ctx: ModuleContext) => ctx.actor.userId;
const pgCode = (e: unknown): string | undefined => (e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code;

// ───────────────────────── services ─────────────────────────
const toSlug = (s: string) => s.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "service";

export async function listServices(ctx: ModuleContext, onlyActive = false) {
  const rows = await ctx.db.select().from(services).where(onlyActive ? eq(services.active, true) : undefined).orderBy(asc(services.position), asc(services.name));
  const hs = rows.length ? await ctx.db.select().from(serviceHosts).where(inArray(serviceHosts.serviceId, rows.map((r) => r.id))) : [];
  const names = await ctx.people.names(hs.map((h) => h.hostId));
  return rows.map((r) => ({
    ...r, hosts: hs.filter((h) => h.serviceId === r.id).map((h) => ({ id: h.hostId, name: names[h.hostId] ?? null })),
  }));
}
async function setHosts(ctx: ModuleContext, serviceId: string, hostIds: string[]) {
  await ctx.db.delete(serviceHosts).where(eq(serviceHosts.serviceId, serviceId));
  const uniq = [...new Set(hostIds)];
  if (!uniq.length) return;
  const known = await ctx.people.names(uniq);
  const missing = uniq.filter((h) => !known[h]);
  if (missing.length) throw E.unprocessable("Hosts must be members of this organization");
  await ctx.db.insert(serviceHosts).values(uniq.map((hostId) => ({ tenantId: ctx.tenantId, serviceId, hostId })));
}
export async function createService(ctx: ModuleContext, i: z.infer<typeof ServiceIn>) {
  const [{ n }] = await ctx.db.select({ n: sql<number>`coalesce(max(${services.position}) + 1, 0)::int` }).from(services) as [{ n: number }];
  const id = uuidv7();
  try {
    await ctx.db.insert(services).values({
      id, tenantId: ctx.tenantId, slug: i.slug ?? toSlug(i.name), name: i.name, description: i.description ?? null, durationMin: i.durationMin,
      bufferMin: i.bufferMin, location: i.location ?? null, isPublic: i.isPublic, active: i.active, position: n,
    });
  } catch (e) { if (pgCode(e) === "23505") throw E.conflict("A service with this link name exists"); throw e; }
  await setHosts(ctx, id, i.hostIds);
  await ctx.audit.log("service.created", { type: "scheduling.service", id }, { name: i.name });
  return getService(ctx, id);
}
export async function updateService(ctx: ModuleContext, id: string, i: z.infer<typeof ServicePatch>) {
  const { hostIds, ...rest } = i;
  const set = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v ?? null]));
  try {
    const r = await ctx.db.update(services).set({ ...set, updatedAt: new Date() }).where(eq(services.id, id)).returning({ id: services.id });
    if (!r.length) throw E.notFound("Service");
  } catch (e) { if (pgCode(e) === "23505") throw E.conflict("A service with this link name exists"); throw e; }
  if (hostIds) await setHosts(ctx, id, hostIds);
  await ctx.audit.log("service.updated", { type: "scheduling.service", id }, i);
  return getService(ctx, id);
}
export async function getService(ctx: ModuleContext, id: string) {
  const s = (await listServices(ctx)).find((x) => x.id === id);
  if (!s) throw E.notFound("Service");
  return s;
}

// ───────────────────────── availability ─────────────────────────
/** Members manage their own hours (P.own); P.manage may manage anyone's. */
function hostFor(ctx: ModuleContext, hostId?: string) {
  const uid = me(ctx);
  const h = hostId ?? uid;
  if (!h) throw E.badRequest("hostId is required");
  if (h !== uid && !ctx.authz.can(P.manage)) throw E.forbidden("You can only change your own availability");
  if (h === uid && !ctx.authz.can(P.own) && !ctx.authz.can(P.manage)) throw E.forbidden("Missing permission to change availability");
  return h;
}
export async function getHours(ctx: ModuleContext, hostId?: string) {
  const h = hostId ?? me(ctx);
  if (!h) throw E.badRequest("hostId is required");
  const rows = await ctx.db.select().from(hours).where(eq(hours.hostId, h)).orderBy(asc(hours.weekday), asc(hours.startMin));
  return { hostId: h, timezone: settingsOf(ctx).timezone, rules: rows.map(({ weekday, startMin, endMin }) => ({ weekday, startMin, endMin })) };
}
export async function setHoursFor(ctx: ModuleContext, i: z.infer<typeof HoursIn>) {
  const h = hostFor(ctx, i.hostId);
  const sorted = [...i.rules].sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin);
  for (let k = 1; k < sorted.length; k++) {
    if (sorted[k]!.weekday === sorted[k - 1]!.weekday && sorted[k]!.startMin < sorted[k - 1]!.endMin) throw E.unprocessable("Opening hours overlap on the same day");
  }
  if (!(await ctx.people.names([h]))[h]) throw E.unprocessable("Host must be a member of this organization");
  await ctx.db.delete(hours).where(eq(hours.hostId, h));
  if (sorted.length) await ctx.db.insert(hours).values(sorted.map((r) => ({ id: uuidv7(), tenantId: ctx.tenantId, hostId: h, ...r })));
  await ctx.audit.log("hours.updated", { type: "scheduling.host", id: h }, { rules: sorted.length });
  return getHours(ctx, h);
}
export async function listTimeOff(ctx: ModuleContext, hostId?: string) {
  const h = hostId ?? me(ctx);
  if (!h) throw E.badRequest("hostId is required");
  return ctx.db.select().from(timeOff).where(and(eq(timeOff.hostId, h), gte(timeOff.endsAt, new Date()))).orderBy(asc(timeOff.startsAt));
}
export async function addTimeOff(ctx: ModuleContext, i: z.infer<typeof TimeOffIn>) {
  const h = hostFor(ctx, i.hostId);
  const s = new Date(i.startsAt), e = new Date(i.endsAt);
  if (e <= s) throw E.unprocessable("End must be after start");
  const [r] = await ctx.db.insert(timeOff).values({ id: uuidv7(), tenantId: ctx.tenantId, hostId: h, startsAt: s, endsAt: e, reason: i.reason ?? null }).returning();
  await ctx.audit.log("time_off.added", { type: "scheduling.host", id: h }, { startsAt: i.startsAt, endsAt: i.endsAt });
  return r!;
}
export async function removeTimeOff(ctx: ModuleContext, id: string) {
  const [r] = await ctx.db.select().from(timeOff).where(eq(timeOff.id, id));
  if (!r) throw E.notFound("Time off");
  hostFor(ctx, r.hostId);
  await ctx.db.delete(timeOff).where(eq(timeOff.id, id));
}

// ───────────────────────── slots ─────────────────────────
export interface Slot { start: string; end: string; hosts: string[] }
type Svc = typeof services.$inferSelect;

/**
 * Open start times for a service between two local dates (inclusive), in the module's time zone.
 * Weekly hours are turned into instants by Postgres (DST-correct), then busy time
 * (bookings incl. buffers, time off) is removed. `enforceNotice` applies min notice / max days ahead.
 */
export async function computeSlots(ctx: ModuleContext, svc: Svc, from: string, to: string, opts: { hostId?: string | undefined; enforceNotice: boolean }): Promise<Slot[]> {
  const s = settingsOf(ctx);
  if (to < from) throw E.badRequest("to must not be before from");
  if (Date.parse(to) - Date.parse(from) > 42 * 86_400_000) throw E.badRequest("Ask for at most 6 weeks at a time");
  let hostIds = (await ctx.db.select({ h: serviceHosts.hostId }).from(serviceHosts).where(eq(serviceHosts.serviceId, svc.id))).map((r) => r.h);
  if (opts.hostId) hostIds = hostIds.filter((h) => h === opts.hostId);
  if (!hostIds.length) return [];
  const hostList = sql.join(hostIds.map((h) => sql`${h}::uuid`), sql`, `);
  const windows = (await ctx.db.execute(sql`
    select h.host_id as "hostId",
           ((d + make_interval(mins => h.start_min)) at time zone ${s.timezone}) as "s",
           ((d + make_interval(mins => h.end_min)) at time zone ${s.timezone}) as "e"
    from generate_series(${from}::timestamp, ${to}::timestamp, interval '1 day') d
    join scheduling_hours h on h.weekday = extract(isodow from d)::int and h.host_id in (${hostList})
    order by 2`)) as unknown as { hostId: string; s: string | Date; e: string | Date }[];
  if (!windows.length) return [];
  const t = (v: string | Date) => new Date(v).getTime();
  const lo = Math.min(...windows.map((w) => t(w.s))), hi = Math.max(...windows.map((w) => t(w.e)));
  const span = sql`tstzrange(${new Date(lo - 86_400_000).toISOString()}::timestamptz, ${new Date(hi + 86_400_000).toISOString()}::timestamptz)`;
  const busyRows = (await ctx.db.execute(sql`
    select host_id as "hostId", lower(blocked) as "s", upper(blocked) as "e" from scheduling_bookings
      where status <> 'cancelled' and host_id in (${hostList}) and blocked && ${span}
    union all
    select host_id, starts_at, ends_at from scheduling_time_off
      where host_id in (${hostList}) and tstzrange(starts_at, ends_at) && ${span}`)) as unknown as { hostId: string; s: string | Date; e: string | Date }[];
  const busy = new Map<string, [number, number][]>();
  for (const b of busyRows) (busy.get(b.hostId) ?? busy.set(b.hostId, []).get(b.hostId)!).push([t(b.s), t(b.e)]);

  const now = Date.now();
  const earliest = opts.enforceNotice ? now + s.minNoticeMin * 60_000 : now;
  const latest = now + s.maxDaysAhead * 86_400_000;
  const dur = svc.durationMin * 60_000, block = (svc.durationMin + svc.bufferMin) * 60_000, step = s.slotStepMin * 60_000;
  const out = new Map<number, string[]>();
  for (const w of windows) {
    const ws = t(w.s), we = t(w.e);
    for (let st = ws; st + dur <= we; st += step) {
      if (st < earliest || (opts.enforceNotice && st > latest)) continue;
      const clash = (busy.get(w.hostId) ?? []).some(([a, b]) => st < b && st + block > a);
      if (clash) continue;
      (out.get(st) ?? out.set(st, []).get(st)!).push(w.hostId);
    }
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([st, hs]) => ({ start: new Date(st).toISOString(), end: new Date(st + dur).toISOString(), hosts: [...new Set(hs)] }));
}

// ───────────────────────── bookings ─────────────────────────
type Booking = typeof bookings.$inferSelect;
export const bookingDto = (b: Booking, extra: { serviceName?: string | null; hostName?: string | null } = {}) => ({
  id: b.id, serviceId: b.serviceId, serviceName: extra.serviceName ?? null, hostId: b.hostId, hostName: extra.hostName ?? null,
  startsAt: b.startsAt, endsAt: b.endsAt, status: b.status, source: b.source,
  customerName: b.customerName, customerEmail: b.customerEmail, customerPhone: b.customerPhone, notes: b.notes, contactId: b.contactId,
  cancelledAt: b.cancelledAt, cancelReason: b.cancelReason, createdAt: b.createdAt,
});
async function dtos(ctx: ModuleContext, rows: Booking[]) {
  const [svcs, names] = await Promise.all([
    rows.length ? ctx.db.select({ id: services.id, name: services.name }).from(services).where(inArray(services.id, [...new Set(rows.map((r) => r.serviceId))])) : [],
    ctx.people.names(rows.map((r) => r.hostId)),
  ]);
  const sn = new Map(svcs.map((x) => [x.id, x.name]));
  return rows.map((b) => bookingDto(b, { serviceName: sn.get(b.serviceId) ?? null, hostName: names[b.hostId] ?? null }));
}
export async function getBooking(ctx: ModuleContext, id: string) {
  const [b] = await ctx.db.select().from(bookings).where(eq(bookings.id, id));
  if (!b) throw E.notFound("Booking");
  return (await dtos(ctx, [b]))[0]!;
}
export async function listBookings(ctx: ModuleContext, q: z.infer<typeof BookingQuery>) {
  const w: SQL[] = [];
  if (q.from) w.push(gte(bookings.endsAt, new Date(q.from)));
  if (q.to) w.push(lt(bookings.startsAt, new Date(q.to)));
  if (q.hostId) w.push(eq(bookings.hostId, q.hostId));
  if (q.contactId) w.push(eq(bookings.contactId, q.contactId));
  if (q.status) w.push(eq(bookings.status, q.status));
  const rows = await ctx.db.select().from(bookings).where(w.length ? and(...w) : undefined).orderBy(asc(bookings.startsAt)).limit(q.limit);
  return { data: await dtos(ctx, rows) };
}

const eventPayload = (b: Booking, serviceName: string) => ({
  id: b.id, serviceId: b.serviceId, serviceName, hostId: b.hostId, startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(),
  customerName: b.customerName, customerEmail: b.customerEmail, source: b.source, contactId: b.contactId,
});
const hashToken = (t: string) => createHash("sha256").update(t).digest();
export function tokenMatches(b: Pick<Booking, "manageToken">, token: string) {
  if (!b.manageToken || !/^[\w-]{43}$/.test(token)) return false;
  return timingSafeEqual(Buffer.from(b.manageToken), hashToken(token));
}

/** Create a booking at `start`. Picks the least-busy free host unless one is given. The DB constraint is the final guard. */
export async function book(ctx: ModuleContext, svc: Svc, i: {
  start: string; hostId?: string | undefined; outsideHours?: boolean; source: "internal" | "public";
  name: string; email?: string | undefined; phone?: string | undefined; notes?: string | undefined; contactId?: string | undefined;
}) {
  if (!svc.active) throw E.unprocessable("This service is not bookable");
  const start = new Date(i.start);
  if (Number.isNaN(start.getTime())) throw E.badRequest("Invalid start");
  const end = new Date(start.getTime() + svc.durationMin * 60_000);
  const s = settingsOf(ctx);
  let hostId = i.hostId;
  if (!i.outsideHours) {
    const d = localDate(start, s.timezone);
    const slot = (await computeSlots(ctx, svc, d, d, { hostId, enforceNotice: i.source === "public" })).find((x) => x.start === start.toISOString());
    if (!slot) throw E.conflict("That time is not available. Pick another time.");
    if (!hostId) {
      // least booked that day first, so work spreads across hosts
      const counts = await ctx.db.select({ h: bookings.hostId, n: sql<number>`count(*)::int` }).from(bookings)
        .where(and(inArray(bookings.hostId, slot.hosts), ne(bookings.status, "cancelled"),
          sql`${bookings.startsAt} >= ${new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString()}::timestamptz`,
          sql`${bookings.startsAt} < ${new Date(Date.parse(`${d}T00:00:00Z`) + 2 * 86_400_000).toISOString()}::timestamptz`))
        .groupBy(bookings.hostId);
      const n = new Map(counts.map((c) => [c.h, c.n]));
      hostId = [...slot.hosts].sort((a, b) => (n.get(a) ?? 0) - (n.get(b) ?? 0))[0];
    }
  } else {
    if (!hostId) throw E.badRequest("Choose who the booking is with");
    const isHost = await ctx.db.select({ h: serviceHosts.hostId }).from(serviceHosts).where(and(eq(serviceHosts.serviceId, svc.id), eq(serviceHosts.hostId, hostId)));
    if (!isHost.length) throw E.unprocessable("That person does not offer this service");
  }
  const token = i.source === "public" || i.email ? randomBytes(32).toString("base64url") : null;
  const blocked = `[${start.toISOString()},${new Date(end.getTime() + svc.bufferMin * 60_000).toISOString()})`;
  let row: Booking;
  try {
    [row] = await ctx.db.insert(bookings).values({
      id: uuidv7(), tenantId: ctx.tenantId, serviceId: svc.id, hostId: hostId!, startsAt: start, endsAt: end, blocked, status: "confirmed",
      source: i.source, customerName: i.name, customerEmail: i.email?.toLowerCase() ?? null, customerPhone: i.phone || null, notes: i.notes || null,
      contactId: i.contactId ?? null, manageToken: token ? hashToken(token) : null, createdBy: ctx.actor.id,
    }).returning() as [Booking];
  } catch (e) {
    if (pgCode(e) === "23P01") throw E.conflict("That time was just taken. Pick another time.");
    throw e;
  }
  await ctx.audit.log("booking.created", { type: "scheduling.booking", id: row.id }, { serviceId: svc.id, hostId, startsAt: row.startsAt, source: i.source });
  await ctx.events.emit("scheduling.booking.created", eventPayload(row, svc.name));
  await notifyCustomer(ctx, row, svc, "confirmed", token);
  return { booking: row, token };
}

// ───────────────────────── customer emails ─────────────────────────
const when = (d: Date, tz: string) => `${new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d)} (${tz})`;
/** Queue an email to the customer (no-op without an address or when turned off). Sent after commit by the worker. */
export async function notifyCustomer(ctx: ModuleContext, b: Booking, svc: Pick<Svc, "name" | "location">, kind: "confirmed" | "cancelled" | "rescheduled", token?: string | null) {
  const s = settingsOf(ctx);
  if (!s.emailCustomers || !b.customerEmail) return;
  const org = s.pageTitle || "us";
  const lines = [`Hello ${b.customerName},`, ""];
  const subject = { confirmed: `Booking confirmed: ${svc.name}`, cancelled: `Booking cancelled: ${svc.name}`, rescheduled: `Booking moved: ${svc.name}` }[kind];
  if (kind === "confirmed") lines.push(`Your booking for ${svc.name} with ${org} is confirmed.`);
  if (kind === "rescheduled") lines.push(`Your booking for ${svc.name} has moved to a new time.`);
  if (kind === "cancelled") lines.push(`Your booking for ${svc.name} on ${when(b.startsAt, s.timezone)} has been cancelled.`);
  if (kind !== "cancelled") {
    lines.push("", `When: ${when(b.startsAt, s.timezone)}`, `Length: ${Math.round((b.endsAt.getTime() - b.startsAt.getTime()) / 60000)} minutes`);
    if (svc.location) lines.push(`Where: ${svc.location}`);
  }
  if (token) lines.push("", "To see or cancel this booking, open:", await ctx.mail.publicPageUrl(`/book/booking/${b.id}#${token}`));
  else if (kind === "cancelled" && s.publicBooking) lines.push("", "To book another time, open:", await ctx.mail.publicPageUrl("/book"));
  lines.push("", "Thank you.");
  await ctx.mail.send({ to: b.customerEmail, subject, text: lines.join("\n"), ...(s.pageTitle ? { fromName: s.pageTitle } : {}) });
}

export async function createInternalBooking(ctx: ModuleContext, i: z.infer<typeof BookingIn>) {
  const [svc] = await ctx.db.select().from(services).where(eq(services.id, i.serviceId));
  if (!svc) throw E.notFound("Service");
  let { name, email, phone } = i;
  if (i.contactId) {
    const c = await ctx.data.contacts.get(i.contactId) as unknown as { firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null };
    name ??= [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Contact";
    email ??= c.email ?? undefined; phone ??= c.phone ?? undefined;
  }
  if (!name) throw E.unprocessable("Enter who the booking is for, or pick a contact");
  const r = await book(ctx, svc, { ...i, name, email, phone, source: "internal" });
  return getBooking(ctx, r.booking.id);
}

const loadForUpdate = async (ctx: ModuleContext, id: string) => {
  const [b] = await ctx.db.select().from(bookings).where(eq(bookings.id, id)).for("update");
  if (!b) throw E.notFound("Booking");
  return b;
};
const svcName = async (ctx: ModuleContext, id: string) => (await ctx.db.select({ n: services.name }).from(services).where(eq(services.id, id)))[0]?.n ?? "";

export async function cancelBooking(ctx: ModuleContext, id: string, by: string, reason?: string) {
  const b = await loadForUpdate(ctx, id);
  if (b.status !== "confirmed") throw E.conflict(`Booking is ${b.status.replace("_", " ")}`);
  const [r] = await ctx.db.update(bookings).set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: by, cancelReason: reason?.trim() || null, updatedAt: new Date() })
    .where(eq(bookings.id, id)).returning();
  await ctx.audit.log("booking.cancelled", { type: "scheduling.booking", id }, { by, reason: reason ?? null });
  const [svc] = await ctx.db.select().from(services).where(eq(services.id, b.serviceId));
  await ctx.events.emit("scheduling.booking.cancelled", { ...eventPayload(r!, svc!.name), cancelledBy: by, reason: r!.cancelReason });
  await notifyCustomer(ctx, r!, svc!, "cancelled");
  return r!;
}
export async function setOutcome(ctx: ModuleContext, id: string, status: Extract<BookingStatus, "completed" | "no_show">) {
  const b = await loadForUpdate(ctx, id);
  if (b.status !== "confirmed") throw E.conflict(`Booking is ${b.status.replace("_", " ")}`);
  if (b.startsAt.getTime() > Date.now()) throw E.conflict("This booking has not started yet");
  const [r] = await ctx.db.update(bookings).set({ status, updatedAt: new Date() }).where(eq(bookings.id, id)).returning();
  await ctx.audit.log(`booking.${status}`, { type: "scheduling.booking", id });
  await ctx.events.emit(`scheduling.booking.${status}`, eventPayload(r!, await svcName(ctx, b.serviceId)));
  return r!;
}
export async function reschedule(ctx: ModuleContext, id: string, start: string, opts: { source: "internal" | "public"; outsideHours?: boolean }) {
  const b = await loadForUpdate(ctx, id);
  if (b.status !== "confirmed") throw E.conflict(`Booking is ${b.status.replace("_", " ")}`);
  const [svc] = await ctx.db.select().from(services).where(eq(services.id, b.serviceId));
  const st = new Date(start);
  if (Number.isNaN(st.getTime())) throw E.badRequest("Invalid start");
  // Free our own slot while checking, then take the new one (same host).
  await ctx.db.update(bookings).set({ blocked: "empty" }).where(eq(bookings.id, id));
  if (!opts.outsideHours) {
    const d = localDate(st, settingsOf(ctx).timezone);
    const ok = (await computeSlots(ctx, svc!, d, d, { hostId: b.hostId, enforceNotice: opts.source === "public" })).some((x) => x.start === st.toISOString());
    if (!ok) throw E.conflict("That time is not available. Pick another time.");
  }
  const en = new Date(st.getTime() + svc!.durationMin * 60_000);
  let r: Booking;
  try {
    [r] = await ctx.db.update(bookings).set({
      startsAt: st, endsAt: en, blocked: `[${st.toISOString()},${new Date(en.getTime() + svc!.bufferMin * 60_000).toISOString()})`, updatedAt: new Date(),
    }).where(eq(bookings.id, id)).returning() as [Booking];
  } catch (e) { if (pgCode(e) === "23P01") throw E.conflict("That time was just taken. Pick another time."); throw e; }
  await ctx.audit.log("booking.rescheduled", { type: "scheduling.booking", id }, { from: b.startsAt, to: st });
  await ctx.events.emit("scheduling.booking.rescheduled", { ...eventPayload(r, svc!.name), previousStartsAt: b.startsAt.toISOString() });
  await notifyCustomer(ctx, r, svc!, "rescheduled");
  return r;
}

/** Link a booking to a core contact by email (find or create). Runs as a system handler, never in public requests. */
export async function linkContact(ctx: ModuleContext, bookingId: string) {
  const [b] = await ctx.db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!b || b.contactId || !b.customerEmail) return;
  const found = await ctx.data.contacts.list({ q: b.customerEmail, limit: 25 }) as unknown as { data: { id: string; email: string | null }[] };
  let id = found.data.find((c) => c.email?.toLowerCase() === b.customerEmail)?.id;
  if (!id) {
    const [first, ...rest] = b.customerName.split(/\s+/);
    const c = await ctx.data.contacts.create({ firstName: first, lastName: rest.join(" ") || null, email: b.customerEmail, phone: b.customerPhone }) as unknown as { id: string };
    id = c.id;
  }
  await ctx.db.update(bookings).set({ contactId: id }).where(eq(bookings.id, bookingId));
}

export async function summary(ctx: ModuleContext) {
  const tz = settingsOf(ctx).timezone;
  const today = localDate(new Date(), tz);
  const { data } = await listBookings(ctx, { from: new Date().toISOString(), to: new Date(Date.now() + 7 * 86_400_000).toISOString(), status: "confirmed", limit: 200 });
  return {
    timezone: tz,
    today: data.filter((b) => localDate(new Date(b.startsAt), tz) === today),
    next7Days: data.length,
    mine: data.filter((b) => b.hostId === me(ctx)).slice(0, 5),
  };
}

export { addDays };
