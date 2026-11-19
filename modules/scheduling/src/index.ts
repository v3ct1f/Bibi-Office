import { fileURLToPath } from "node:url";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { action, defineModule, moduleErrors as E, publicRoute, route, type ModuleContext } from "@office/sdk";
import { bookings, services } from "./schema.ts";
import {
  addTimeOff, BookingIn, BookingQuery, book, cancelBooking, computeSlots, createInternalBooking, createService, getBooking, getHours,
  getService, HoursIn, linkContact, listBookings, listServices, listTimeOff, localDate, P, PublicBookIn, removeTimeOff, reschedule,
  ServiceIn, ServicePatch, setHoursFor, setOutcome, SETTINGS_SCHEMA, settingsOf, SlotQuery, summary, TimeOffIn, tokenMatches, updateService,
} from "./service.ts";
import { metrics } from "./metrics.ts";

const Id = z.object({ id: z.uuid() });
const Slug = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,60}$/) });

/** Public pages only see public, active services, and only when the tenant turned the page on. */
async function publicService(ctx: ModuleContext, slug: string) {
  if (!settingsOf(ctx).publicBooking) throw E.notFound("Page");
  const [svc] = await ctx.db.select().from(services).where(eq(services.slug, slug));
  if (!svc || !svc.active || !svc.isPublic) throw E.notFound("Service");
  return svc;
}
const publicView = (b: typeof bookings.$inferSelect, serviceName: string, location: string | null) => ({
  id: b.id, service: serviceName, location, startsAt: b.startsAt, endsAt: b.endsAt, status: b.status, name: b.customerName,
});
async function publicBooking(ctx: ModuleContext, id: string, token: string) {
  if (!settingsOf(ctx).publicBooking) throw E.notFound("Page");
  const [b] = await ctx.db.select().from(bookings).where(eq(bookings.id, id));
  if (!b || !tokenMatches(b, token)) throw E.notFound("Booking");   // same answer for wrong id and wrong token
  const [svc] = await ctx.db.select().from(services).where(eq(services.id, b.serviceId));
  return { b, svc: svc! };
}

export default defineModule({
  manifest: {
    key: "scheduling",
    name: "Scheduling",
    version: "1.0.0",
    office: "^1.0",
    description: "Appointments: services, team availability and time off, bookings without double-booking, and a public booking page.",
    permissions: {
      declares: [
        { key: P.read, label: "View bookings", defaultRoles: ["member"] },
        { key: P.write, label: "Create, move and cancel bookings", defaultRoles: ["member"] },
        { key: P.own, label: "Set own working hours and time off", defaultRoles: ["member"] },
        { key: P.manage, label: "Set anyone's working hours and time off" },
        { key: P.services, label: "Manage services and who offers them" },
      ],
      requires: ["core:contacts.read", "core:contacts.write", "core:mail.send"],
    },
    entities: ["service", "booking"],
    events: {
      emits: [
        { type: "scheduling.booking.created" }, { type: "scheduling.booking.rescheduled" }, { type: "scheduling.booking.cancelled" },
        { type: "scheduling.booking.completed" }, { type: "scheduling.booking.no_show" },
      ],
      subscribes: ["scheduling.booking.created"],
    },
    workflow: {
      triggers: ["scheduling.booking.created", "scheduling.booking.rescheduled", "scheduling.booking.cancelled", "scheduling.booking.completed", "scheduling.booking.no_show"],
      actions: [{ key: "scheduling.cancel_booking", label: "Cancel booking" }],
    },
    ui: {
      slots: [
        { slot: "nav.main", label: "Calendar", icon: "calendar", route: "/calendar", permission: P.read },
        { slot: "entity.tab:contact", label: "Bookings", component: "BookingsTab", permission: P.read },
        { slot: "dashboard.widget", label: "Today", component: "TodayWidget", permission: P.read },
      ],
    },
    settings: SETTINGS_SCHEMA as unknown as Record<string, unknown>,
    api: { basePath: "/scheduling" },
    lifecycle: [],
  },
  metrics,
  migrationsDir: fileURLToPath(new URL("../migrations", import.meta.url)),
  routes: [
    // services
    route({ method: "GET", path: "/services", permission: P.read, handler: async (ctx) => ({ data: await listServices(ctx) }) }),
    route({ method: "POST", path: "/services", permission: P.services, body: ServiceIn, status: 201, handler: (ctx, { body }) => createService(ctx, body) }),
    route({ method: "PATCH", path: "/services/:id", permission: P.services, params: Id, body: ServicePatch, handler: (ctx, { params, body }) => updateService(ctx, params.id, body) }),
    route({
      method: "GET", path: "/services/:id/slots", permission: P.read, params: Id, query: SlotQuery,
      handler: async (ctx, { params, query }) => {
        const svc = await getService(ctx, params.id);
        const names = await ctx.people.names(svc.hosts.map((h) => h.id));
        const slots = await computeSlots(ctx, svc, query.from, query.to, { hostId: query.hostId, enforceNotice: false });
        return { timezone: settingsOf(ctx).timezone, data: slots.map((s) => ({ ...s, hostNames: s.hosts.map((h) => names[h] ?? h) })) };
      },
    }),
    // availability (own: P.own; anyone: P.manage — checked in the service)
    route({ method: "GET", path: "/hours", permission: P.read, query: z.object({ hostId: z.uuid().optional() }), handler: (ctx, { query }) => getHours(ctx, query.hostId) }),
    route({ method: "PUT", path: "/hours", permission: P.read, body: HoursIn, handler: (ctx, { body }) => setHoursFor(ctx, body) }),
    route({ method: "GET", path: "/time-off", permission: P.read, query: z.object({ hostId: z.uuid().optional() }), handler: async (ctx, { query }) => ({ data: await listTimeOff(ctx, query.hostId) }) }),
    route({ method: "POST", path: "/time-off", permission: P.read, body: TimeOffIn, status: 201, handler: (ctx, { body }) => addTimeOff(ctx, body) }),
    route({ method: "DELETE", path: "/time-off/:id", permission: P.read, params: Id, handler: async (ctx, { params }) => { await removeTimeOff(ctx, params.id); } }),
    // bookings
    route({ method: "GET", path: "/summary", permission: P.read, handler: (ctx) => summary(ctx) }),
    route({ method: "GET", path: "/bookings", permission: P.read, query: BookingQuery, handler: (ctx, { query }) => listBookings(ctx, query) }),
    route({ method: "POST", path: "/bookings", permission: P.write, body: BookingIn, status: 201, handler: (ctx, { body }) => createInternalBooking(ctx, body) }),
    route({ method: "GET", path: "/bookings/:id", permission: P.read, params: Id, handler: (ctx, { params }) => getBooking(ctx, params.id) }),
    route({
      method: "POST", path: "/bookings/:id/reschedule", permission: P.write, params: Id,
      body: z.object({ start: z.iso.datetime({ offset: true }), outsideHours: z.boolean().default(false) }),
      handler: async (ctx, { params, body }) => { await reschedule(ctx, params.id, body.start, { source: "internal", outsideHours: body.outsideHours }); return getBooking(ctx, params.id); },
    }),
    route({
      method: "POST", path: "/bookings/:id/cancel", permission: P.write, params: Id, body: z.object({ reason: z.string().max(500).optional() }).default({}),
      handler: async (ctx, { params, body }) => { await cancelBooking(ctx, params.id, ctx.actor.id, body.reason); return getBooking(ctx, params.id); },
    }),
    route({
      method: "POST", path: "/bookings/:id/outcome", permission: P.write, params: Id, body: z.object({ status: z.enum(["completed", "no_show"]) }),
      handler: async (ctx, { params, body }) => { await setOutcome(ctx, params.id, body.status); return getBooking(ctx, params.id); },
    }),
  ],
  publicRoutes: [
    publicRoute({
      method: "GET", path: "/info",
      handler: async (ctx) => {
        const s = settingsOf(ctx);
        if (!s.publicBooking) throw E.notFound("Page");
        const svcs = (await listServices(ctx, true)).filter((x) => x.isPublic && x.hosts.length);
        return {
          title: s.pageTitle || null, timezone: s.timezone,
          services: svcs.map((x) => ({ slug: x.slug, name: x.name, description: x.description, durationMin: x.durationMin, location: x.location })),
        };
      },
    }),
    publicRoute({
      method: "GET", path: "/services/:slug/slots", params: Slug, query: SlotQuery.omit({ hostId: true }),
      handler: async (ctx, { params, query }) => {
        const svc = await publicService(ctx, params.slug);
        const slots = await computeSlots(ctx, svc, query.from, query.to, { enforceNotice: true });
        return { timezone: settingsOf(ctx).timezone, data: slots.map(({ start, end }) => ({ start, end })) };   // no host ids in public
      },
    }),
    publicRoute({
      method: "POST", path: "/services/:slug/book", params: Slug, body: PublicBookIn, status: 201,
      handler: async (ctx, { params, body }) => {
        if (body.website) throw E.badRequest("Invalid request");   // honeypot filled: a bot
        const svc = await publicService(ctx, params.slug);
        // at most 3 upcoming public bookings per email (simple abuse limit)
        const mine = await listBookings(ctx, { from: new Date().toISOString(), status: "confirmed", limit: 500 });
        if (mine.data.filter((b) => b.source === "public" && b.customerEmail === body.email.toLowerCase()).length >= 3) {
          throw E.conflict("You already have 3 upcoming bookings. Cancel one first, or contact us.");
        }
        const { booking, token } = await book(ctx, svc, { start: body.start, source: "public", name: body.name, email: body.email, phone: body.phone, notes: body.notes });
        return { ...publicView(booking, svc.name, svc.location), token };
      },
    }),
    publicRoute({
      method: "GET", path: "/bookings/:id", params: Id, query: z.object({ token: z.string().max(100) }),
      handler: async (ctx, { params, query }) => { const { b, svc } = await publicBooking(ctx, params.id, query.token); return publicView(b, svc.name, svc.location); },
    }),
    publicRoute({
      method: "POST", path: "/bookings/:id/cancel", params: Id, body: z.object({ token: z.string().max(100), reason: z.string().max(500).optional() }),
      handler: async (ctx, { params, body }) => {
        const { b, svc } = await publicBooking(ctx, params.id, body.token);
        if (b.startsAt.getTime() < Date.now()) throw E.conflict("This booking has already started");
        const r = await cancelBooking(ctx, b.id, "customer", body.reason);
        return publicView(r, svc.name, svc.location);
      },
    }),
  ],
  handlers: {
    // Every booking with an email ends up linked to a core contact (found by email or created).
    "scheduling.booking.created": async (ctx, e) => {
      const id = (e.payload as { id?: unknown }).id;
      if (typeof id === "string") await linkContact(ctx, id);
    },
  },
  actions: {
    "scheduling.cancel_booking": action({
      label: "Cancel booking",
      input: z.object({ id: z.uuid().describe("booking id, e.g. {{payload.id}}"), reason: z.string().max(500).optional() }),
      run: async (ctx, i) => { const r = await cancelBooking(ctx, i.id, "workflow", i.reason); return { id: r.id, status: r.status }; },
    }),
  },
});

export { localDate, settingsOf, book };
