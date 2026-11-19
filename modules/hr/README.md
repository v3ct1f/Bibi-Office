# HR (`hr`, shown as "People")

Employee records, who manages whom, employee documents, and time off with balances, approvals and a team calendar.

## Model
- `hr_employees`: name, work email (unique), title, team, `manager_id` (no loops: trigger), optional `user_id` (member account, unique), employment type, start/end date, `annual_allowance` (null = setting), private: birth date, phone, address, emergency contact, HR notes.
- `hr_leave_types`: name, `uses_allowance`, `needs_approval`, `paid`, archived. Seeded on enable: Vacation (allowance, approval), Sick leave (no allowance, auto-approved), Unpaid leave (approval).
- `hr_holidays`: company holidays (not counted as time off).
- `hr_leave_requests`: employee, type, start/end date, `half_day` (single day only), `days` (working days at request time), status `requested | approved | rejected | cancelled`, note, decision. Exclusion constraint: one live request per person per day. Dates/type/days are immutable; a request may not cross a year.
- `hr_documents`: link to a module-private core document + kind (contract, identity, certificate, review, other).

## Rules
- Working days = settings `workDays` (default Mon–Fri) minus holidays. Half day = 0.5.
- Balance per year: allowance (prorated by days employed that year, rounded to 0.5) − approved − pending, for types that use the allowance. Requests over the remaining balance are refused.
- Deciding: the person's direct manager or anyone with `hr:leave.approve`; never your own request. Rejections need a reason.
- Cancel: the person while requested or before the start; HR anytime.
- Emails (setting `emailNotifications`): manager's work email on a new request; the person's work email on the decision.
- Privacy: directory info for everyone with `hr:directory.read`; private fields and documents only for HR and the person (document views are audited); leave type/notes/balance only for HR, approvers, the person and their manager; others see "Away".

## Permissions
| Key | Default roles |
|---|---|
| `hr:directory.read` | member, admin |
| `hr:leave.request` | member, admin |
| `hr:leave.approve` | admin |
| `hr:employees.manage` | admin |

Requires `core:documents.read`, `core:documents.write`, `core:mail.send`.

## Events / workflow
`hr.employee.created`, `.updated`, `.left`; `hr.leave.requested`, `.approved`, `.rejected`, `.cancelled` (all triggers). Action `hr.decide_leave {id, decision: approve|reject, note?}`.

## API (`/api/v1/m/hr`)
`GET|POST /employees`, `GET|PATCH /employees/:id`, `GET|PATCH /me`, `GET|POST /employees/:id/documents`, `GET|DELETE /employees/:id/documents/:docId`, `GET|POST /leave` (`scope=mine|approvals|all`), `POST /leave/:id/approve|reject|cancel`, `GET /calendar?from&to` (≤ 3 months), `GET /summary`, `GET|POST|PATCH /leave-types`, `GET|POST|DELETE /holidays`.

## UI
Nav "People" (`/m/hr/people`): Directory, My time off, Approvals, Who's away (month), Setup (leave types, holidays). Person page: work, personal, time off, documents. Dashboard widget "Who's away".

## Settings
`defaultAllowance` (25), `workDays` ([1..5]), `timezone` (for "today"), `emailNotifications`.
