# Staff Scheduling & Time Clock (`scheduling`)

Plan the week's shifts, let staff clock in and out, and approve time off and shift swaps. Hours per person export as CSV for payroll.

Turned off by default. An owner or admin adds it under **Add features**. Turning it off hides the pages and makes the API answer 403, but keeps all data; adding it again brings everything back.

## Who can do what

| Permission | Lets you | Default roles |
|---|---|---|
| `scheduling:schedule.read` | See the published schedule | viewer, member, manager, admin, owner |
| `scheduling:self.use` | Clock in/out, ask for time off and swaps | member, manager, admin, owner |
| `scheduling:schedule.manage` | Build and publish schedules, approve requests, fix time entries, see and export hours | manager, admin, owner |

Employees are the workspace's members (Settings → Members). The module reads them through `ctx.people`, so it declares `core:members.read`.

## Pages

- **Schedule** (`/schedule`): a week grid with people as rows and Monday to Sunday as columns.
  - Managers add shifts by clicking a cell. A shift has a person, an optional position, a day, start and end times, a break and notes.
  - An end time at or before the start means the shift runs past midnight.
  - New shifts are drafts until **Publish week**. **Copy last week** makes drafts from the previous week and skips any that would clash.
  - **Positions** (Bar, Kitchen…) give shifts a colour.
  - Staff see only published shifts. They click one of their own upcoming shifts to ask a colleague to take or swap it.
- **Time clock** (`/clock`): a Clock in / Clock out button with a running timer, today's shift, and this week's entries and total.
- **Time off & swaps** (`/requests`):
  - Staff ask for time off and accept or decline swaps colleagues send them.
  - Managers approve or reject (with a reason) time off and accepted swaps.
  - Pending time off lists the shifts the person already has in that period.
- **Hours** (`/hours`, managers): planned vs worked hours per person for a week or a date range.
  - Expand a person to edit or delete entries, or add one for a missed clock-in.
  - **Export CSV** gives one row per entry, totals per person, decimal hours, and whether a manager changed it.
- **Dashboard widget**: everyone sees their next shift and whether they're clocked in. Managers also see requests waiting for them and who is working now.

## Rules the API enforces

- One person can't have overlapping shifts, including an overnight shift running into the next day. They also can't get a shift on approved time off. The 409 error says what clashes.
- Breaks must be shorter than the shift.
- Time-off requests can't overlap your own pending or approved ones. They can be at most a year long. Only pending or upcoming approved time off can be cancelled.
- Swap flow:
  1. The employee asks a colleague (optionally in exchange for one of the colleague's shifts). Only one open request is allowed per shift.
  2. The colleague accepts or declines.
  3. A manager approves or rejects.
  4. On approval, both people are re-checked for clashes and the shifts change hands.
- Clock entries:
  - Only one open entry per person.
  - At most 24 hours long.
  - Never in the future.
  - Manual entries can't overlap existing ones.
- Times are wall-clock times in the module's **Time zone** setting (default `Europe/Madrid`). Weeks start on Monday.
- Every table has `tenant_id` with row-level security, so one company never sees another's data.

## Events

`scheduling.shifts.published`, `scheduling.time_off.requested|approved|rejected`, `scheduling.swap.requested|approved`, `scheduling.clock.in|out`. All of them can trigger workflows.

## Tests

- `tests/time.test.ts`: date and time helpers.
- `apps/api/test/scheduling.test.ts`: roles, clashes, publish/copy, time off, swaps, clock, manual entries, CSV, company isolation.
- `apps/web/e2e/scheduling.spec.ts`: the whole flow in a browser.
