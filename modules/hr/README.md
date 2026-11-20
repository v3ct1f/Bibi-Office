# HR (`hr`)

Everything about the people who work for the company:
- Profiles and a team directory, with an org chart.
- Vacation allowances and balances, filled automatically from approved time off in Schedule.
- Employee documents with expiry reminders.
- Onboarding and offboarding checklists.
- Pay history that only a few people can see.

Turned off by default. An owner or admin adds it under **Add features**. Turning it off hides the pages and makes the API answer 403, but keeps all data.

## Who can do what

| Permission | Lets you | Default roles |
|---|---|---|
| `hr:people.read` | See the directory and org chart; see your own profile, private details, leave, documents, checklists and pay; edit your own contact details and emergency contact; tick off tasks assigned to you | viewer, member, manager, admin, owner |
| `hr:people.manage` | Edit anyone's profile, private details and HR notes; manage leave entries, documents, checklist templates and checklists | manager, admin, owner |
| `hr:pay.manage` | See and change anyone's pay | admin, owner (grant it to another role, or a custom "HR" role, under **Settings → Roles**) |

**Employees are workspace members.** A profile is created the first time someone edits it. The module declares `core:members.read`.

**What colleagues can see:**

| Who | Sees |
|---|---|
| Any colleague | Name, email, job title, department, manager, employment type, start date, work phone, and birthday (day and month only) |
| HR managers and the person themself | Also the private details: date of birth, personal email and phone, address, emergency contact, hours per week, vacation allowance |
| HR managers only | HR notes |

Pay is never included in events, workflows or webhooks. `hr.pay.changed` only says that pay changed and from which date.

## Pages

**People** (`/people`) has four sections:
- **Directory**: searchable cards, a department filter, and (for HR) a "show people who left" option.
- **Org chart**: an expandable tree built from each person's manager. Reporting loops are refused.
- **Leave**: everyone's allowance, days taken, booked and left, and sick days per year. Non-HR people see only their own row.
- **Checklists**: checklists in progress and done, and the checklist templates.

**Profile** (`/people/:userId`) has these tabs:
- **Profile**: the work details, and private details when you're allowed to see them. "Edit profile" (HR) or "Edit my details" (yourself).
- **Leave**: the balance cards and the entries for the year. HR can add leave that wasn't booked in Schedule, carried-over days, or allowance adjustments.
- **Documents**: upload a PDF, photo or Word file (at most 7 MB) with a type and an optional expiry date. Documents show "Expires soon" or "Expired".
- **Checklists**: HR assigns a template with a start day. Each task gets an owner and a due date. Ticking the last task completes the checklist, and unticking reopens it.
- **Pay**: the current rate (hourly, monthly or yearly), the history, and upcoming changes. Only people with the pay permission can add or delete entries.

**Dashboard widget**: who's away today, birthdays and work anniversaries in the next 14 days, your open checklist tasks, and (for HR) documents expiring soon.

## Leave

- **Allowance:** the yearly vacation allowance is a setting (**Vacation days per year**, default 25). It can be changed per person.
- **From Schedule:** when time off is approved in the Schedule module, HR records it.
  - It counts working days, Monday to Friday, split across calendar years.
  - Vacation counts against the allowance. Sick, personal and other days are recorded but don't count against it.
  - When that time off is cancelled, the days come back.
  - These entries can't be deleted in HR. Cancel the time off in Schedule instead.
  - Only time off approved while HR is turned on is recorded. Add earlier days by hand.
- **Balance:** Left = allowance + adjustments and carried-over days − vacation (taken or booked).

## Checklists

Templates hold tasks, each with an owner and a due day relative to the start day (0 = the start day, −3 = three days before). The owner is one of:
- **the person**;
- **their manager**: falls back to whoever assigns the checklist when the person has no manager;
- **HR**: whoever assigns the checklist.

Each person sees the checklists about them and those with tasks they own.

## Documents and reminders

The `document_reminders` job runs every 6 hours. It sends one `hr.document.expiring` event per document once its expiry date is within **Remind before documents expire** days (default 30). Changing the expiry date re-arms the reminder.

To get an email, add a workflow on this event.

Uploads are checked: the file content must match its type.

## Events (for workflows)

| Event | When |
|---|---|
| `hr.employee.updated` | Profile fields change (names of the fields only) |
| `hr.pay.changed` | A pay change is added (no amounts) |
| `hr.document.expiring` | A document's expiry date is within the reminder window |
| `hr.checklist.assigned` / `hr.checklist.completed` | A checklist is assigned / its last task is done |

The module listens to `scheduling.time_off.approved` and `scheduling.time_off.cancelled`.

## Data

All tables have tenant row-level security:

| Table | Holds |
|---|---|
| `hr_employees` | Profile per member |
| `hr_pay` | Pay history |
| `hr_leave` | Leave ledger, with `ref_id` pointing to the Schedule time off |
| `hr_documents` | Files and expiry dates |
| `hr_templates` | Checklist templates |
| `hr_checklists` and `hr_tasks` | Assigned checklists and their tasks |

## Tests

- `modules/hr/tests/dates.test.ts`: working days across weekends and the new year.
- `apps/api/test/hr.test.ts`: privacy rules, reporting loops, pay restrictions, leave from Schedule approvals and cancellations, adjustments, documents and reminders, checklists and task ownership, the dashboard, isolation between companies, and switching off and on.
- `apps/web/e2e/hr.spec.ts`: the full flow in the browser.
