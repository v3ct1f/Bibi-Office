# Scheduling (`scheduling`)

Appointments: services offered by team members, weekly working hours, time off, bookings that can never overlap, and a public booking page customers use without signing in.

## Model
- `scheduling_services`: name, URL `slug`, `duration_min`, `buffer_min` (kept free after each booking), location, `is_public`, `active`. Hosts in `scheduling_service_hosts` (members).
- `scheduling_hours`: per host, weekday (1 = Mon) + `start_min`/`end_min` in the module's time zone.
- `scheduling_time_off`: per host, instant ranges.
- `scheduling_bookings`: service, host, `starts_at`/`ends_at`, `blocked` = `[start, end + buffer)`, status `confirmed | cancelled | completed | no_show`, source `internal | public`, customer fields, `contact_id`, `manage_token` (SHA-256 only).
- Exclusion constraint (btree_gist): no two non-cancelled bookings of one host overlap. The slot finder is a convenience; the database is the guard.

## Slots
Hours → instants in SQL (`(day + minutes) AT TIME ZONE tz`, DST-correct), minus bookings (with buffers) and time off, stepping every `slotStepMin`. Public requests also apply `minNoticeMin` and `maxDaysAhead`. Max 6 weeks per query. Public results hide hosts.

## Booking rules
- Public bookings must hit an offered slot; host = least-busy free host that day. Email required, honeypot field `website`, max 3 upcoming public bookings per email, per-IP rate limit (platform).
- Team bookings may set `outsideHours` (never overlaps). Book for a core contact (`contactId`) or a new person.
- Reschedule keeps the host; cancel needs status confirmed; outcomes (completed / no-show) only after start.
- A handler on `scheduling.booking.created` links the booking to a core contact by email (creates one if needed).

## Permissions
| Key | Default roles |
|---|---|
| `scheduling:booking.read` | member, admin |
| `scheduling:booking.write` | member, admin |
| `scheduling:availability.own` | member, admin |
| `scheduling:availability.manage` | admin |
| `scheduling:service.manage` | admin |

Requires `core:contacts.read`, `core:contacts.write`.

## Settings
`timezone` (UTC), `slotStepMin` (30), `minNoticeMin` (120), `maxDaysAhead` (60), `publicBooking` (true), `pageTitle`.

## API
Team (`/api/v1/m/scheduling`): `GET/POST /services`, `PATCH /services/:id`, `GET /services/:id/slots?from&to&hostId`, `GET/PUT /hours`, `GET/POST /time-off`, `DELETE /time-off/:id`, `GET /summary`, `GET/POST /bookings`, `GET /bookings/:id`, `POST /bookings/:id/reschedule|cancel|outcome`.

Public (`/api/v1/public/<tenantSlug>/m/scheduling`): `GET /info`, `GET /services/:slug/slots?from&to`, `POST /services/:slug/book` (returns `token` once), `GET /bookings/:id?token=`, `POST /bookings/:id/cancel {token}`.

## Events (v1)
`scheduling.booking.created|rescheduled|cancelled|completed|no_show` — `{ id, serviceId, serviceName, hostId, startsAt, endsAt, customerName, customerEmail, source, contactId }` (+ `previousStartsAt`, `cancelledBy`, `reason`).

## Workflow action
`scheduling.cancel_booking { id, reason? }`.

## UI
Team: `/m/scheduling/calendar` (week agenda, booking dialog, new booking, My hours + time off, Services). Contact tab `BookingsTab`, dashboard `TodayWidget`.
Public: `/p/<tenantSlug>/scheduling/book` → service → day/time → details → confirmation; manage link `/book/booking/<id>#<token>`.

## Tests
`tests/scheduling.test.ts` (15), E2E `apps/web/e2e/timetable.spec.ts`.
