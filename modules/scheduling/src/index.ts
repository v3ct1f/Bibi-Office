import { metrics } from "./metrics.ts";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { defineModule, route } from "@office/sdk";
import {
  addEntry, approveSwap, approveTimeOff, cancelSwap, cancelTimeOff, clockIn, ClockInput, clockOut, clockStatus, copyWeek, CopyBody,
  createPosition, createShift, DecisionInput, deleteEntry, deletePosition, deleteShift, EntryInput, EntryPatch, listPositions,
  listSwaps, listTimeOff, myShifts, P, PositionInput, PositionPatch, publishWeek, RangeQuery, rejectSwap, rejectTimeOff, RejectInput,
  requestSwap, requestTimeOff, respondSwap, ShiftInput, ShiftPatch, summary, SwapInput, timesheet, timesheetCsv, TimeOffInput,
  TimeOffQuery, tzOf, updateEntry, updatePosition, updateShift, week, WeekBody, WeekQuery,
} from "./service.ts";
import { nowIn } from "./time.ts";

const Id = z.object({ id: z.uuid() });
const EVENTS = [
  "scheduling.shifts.published", "scheduling.time_off.requested", "scheduling.time_off.approved", "scheduling.time_off.rejected", "scheduling.time_off.cancelled",
  "scheduling.swap.requested", "scheduling.swap.approved", "scheduling.clock.in", "scheduling.clock.out",
];

export default defineModule({
  manifest: {
    key: "scheduling",
    name: "Staff Scheduling & Time Clock",
    version: "1.0.0",
    office: "^1.0",
    description: "Plan the week's shifts by person and position, publish them, and let staff clock in and out, ask for time off and swap shifts. Hours per week with CSV export for payroll.",
    icon: "calendar-clock",
    category: "team",
    permissions: {
      declares: [
        { key: P.READ, label: "See the published schedule" },
        { key: P.SELF, label: "Clock in and out, ask for time off and shift swaps" },
        { key: P.MANAGE, label: "Build schedules, approve requests, fix time entries, export hours" },
      ],
      requires: ["core:members.read"],
    },
    roles: { manager: [P.READ, P.SELF, P.MANAGE], member: [P.READ, P.SELF], viewer: [P.READ] },
    entities: ["shift", "time_off", "swap", "time_entry"],
    events: { emits: EVENTS.map((type) => ({ type })), subscribes: [] },
    workflow: { triggers: EVENTS, actions: [] },
    ui: {
      slots: [
        { slot: "nav.main", label: "Schedule", icon: "calendar", route: "/schedule", permission: P.READ },
        { slot: "nav.main", label: "Time clock", icon: "clock", route: "/clock", permission: P.SELF },
        { slot: "nav.main", label: "Time off & swaps", icon: "inbox", route: "/requests", permission: P.SELF },
        { slot: "nav.main", label: "Hours", icon: "chart", route: "/hours", permission: P.MANAGE },
        { slot: "dashboard.widget", label: "Schedule", component: "ScheduleWidget", permission: P.READ },
      ],
    },
    settings: {
      type: "object",
      properties: {
        timezone: { type: "string", title: "Time zone", description: "Used for the time clock and for where a week starts and ends, e.g. Europe/Madrid.", default: "Europe/Madrid", maxLength: 60 },
      },
      additionalProperties: false,
    },
    api: { basePath: "/scheduling" },
  },
  migrationsDir: fileURLToPath(new URL("../migrations", import.meta.url)),
  metrics,
  routes: [
    route({
      method: "GET", path: "/config", permission: P.READ,
      handler: async (ctx) => {
        const tz = tzOf(ctx);
        return { timezone: tz, today: nowIn(tz).date, me: ctx.actor.userId ?? null, canSelf: ctx.authz.can(P.SELF), canManage: ctx.authz.can(P.MANAGE) };
      },
    }),
    route({ method: "GET", path: "/people", permission: P.READ, handler: async (ctx) => (await ctx.people.list()).map((p) => ({ userId: p.userId, name: p.name })) }),
    route({ method: "GET", path: "/summary", permission: P.READ, handler: (ctx) => summary(ctx) }),

    route({ method: "GET", path: "/positions", permission: P.READ, handler: (ctx) => listPositions(ctx) }),
    route({ method: "POST", path: "/positions", permission: P.MANAGE, status: 201, body: PositionInput, handler: (ctx, { body }) => createPosition(ctx, body) }),
    route({ method: "PATCH", path: "/positions/:id", permission: P.MANAGE, params: Id, body: PositionPatch, handler: (ctx, { params, body }) => updatePosition(ctx, params.id, body) }),
    route({ method: "DELETE", path: "/positions/:id", permission: P.MANAGE, params: Id, status: 204, handler: (ctx, { params }) => deletePosition(ctx, params.id) }),

    route({ method: "GET", path: "/week", permission: P.READ, query: WeekQuery, handler: (ctx, { query }) => week(ctx, query.start) }),
    route({ method: "POST", path: "/week/publish", permission: P.MANAGE, body: WeekBody, handler: (ctx, { body }) => publishWeek(ctx, body.start) }),
    route({ method: "POST", path: "/week/copy", permission: P.MANAGE, body: CopyBody, handler: (ctx, { body }) => copyWeek(ctx, body.from, body.to) }),
    route({ method: "POST", path: "/shifts", permission: P.MANAGE, status: 201, body: ShiftInput, handler: (ctx, { body }) => createShift(ctx, body) }),
    route({ method: "PATCH", path: "/shifts/:id", permission: P.MANAGE, params: Id, body: ShiftPatch, handler: (ctx, { params, body }) => updateShift(ctx, params.id, body) }),
    route({ method: "DELETE", path: "/shifts/:id", permission: P.MANAGE, params: Id, status: 204, handler: (ctx, { params }) => deleteShift(ctx, params.id) }),
    route({ method: "GET", path: "/my-shifts", permission: P.SELF, query: RangeQuery, handler: (ctx, { query }) => myShifts(ctx, query) }),

    route({ method: "GET", path: "/time-off", permission: P.SELF, query: TimeOffQuery, handler: (ctx, { query }) => listTimeOff(ctx, query) }),
    route({ method: "POST", path: "/time-off", permission: P.SELF, status: 201, body: TimeOffInput, handler: (ctx, { body }) => requestTimeOff(ctx, body) }),
    route({ method: "POST", path: "/time-off/:id/cancel", permission: P.SELF, params: Id, handler: (ctx, { params }) => cancelTimeOff(ctx, params.id) }),
    route({ method: "POST", path: "/time-off/:id/approve", permission: P.MANAGE, params: Id, body: DecisionInput, handler: (ctx, { params, body }) => approveTimeOff(ctx, params.id, body.comment) }),
    route({ method: "POST", path: "/time-off/:id/reject", permission: P.MANAGE, params: Id, body: RejectInput, handler: (ctx, { params, body }) => rejectTimeOff(ctx, params.id, body.comment) }),

    route({ method: "GET", path: "/swaps", permission: P.SELF, handler: (ctx) => listSwaps(ctx) }),
    route({ method: "POST", path: "/swaps", permission: P.SELF, status: 201, body: SwapInput, handler: (ctx, { body }) => requestSwap(ctx, body) }),
    route({ method: "POST", path: "/swaps/:id/accept", permission: P.SELF, params: Id, handler: (ctx, { params }) => respondSwap(ctx, params.id, true) }),
    route({ method: "POST", path: "/swaps/:id/decline", permission: P.SELF, params: Id, handler: (ctx, { params }) => respondSwap(ctx, params.id, false) }),
    route({ method: "POST", path: "/swaps/:id/cancel", permission: P.SELF, params: Id, handler: (ctx, { params }) => cancelSwap(ctx, params.id) }),
    route({ method: "POST", path: "/swaps/:id/approve", permission: P.MANAGE, params: Id, body: DecisionInput, handler: (ctx, { params, body }) => approveSwap(ctx, params.id, body.comment) }),
    route({ method: "POST", path: "/swaps/:id/reject", permission: P.MANAGE, params: Id, body: RejectInput, handler: (ctx, { params, body }) => rejectSwap(ctx, params.id, body.comment) }),

    route({ method: "GET", path: "/clock", permission: P.SELF, handler: (ctx) => clockStatus(ctx) }),
    route({ method: "POST", path: "/clock/in", permission: P.SELF, body: ClockInput, handler: (ctx, { body }) => clockIn(ctx, body.note) }),
    route({ method: "POST", path: "/clock/out", permission: P.SELF, body: ClockInput, handler: (ctx, { body }) => clockOut(ctx, body.note) }),
    route({ method: "GET", path: "/timesheet", permission: P.MANAGE, query: RangeQuery, handler: (ctx, { query }) => timesheet(ctx, query) }),
    route({ method: "GET", path: "/timesheet/export", permission: P.MANAGE, query: RangeQuery, handler: (ctx, { query }) => timesheetCsv(ctx, query) }),
    route({ method: "POST", path: "/entries", permission: P.MANAGE, status: 201, body: EntryInput, handler: (ctx, { body }) => addEntry(ctx, body) }),
    route({ method: "PATCH", path: "/entries/:id", permission: P.MANAGE, params: Id, body: EntryPatch, handler: (ctx, { params, body }) => updateEntry(ctx, params.id, body) }),
    route({ method: "DELETE", path: "/entries/:id", permission: P.MANAGE, params: Id, status: 204, handler: (ctx, { params }) => deleteEntry(ctx, params.id) }),
  ],
});
