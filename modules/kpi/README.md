# KPI dashboard (`kpi`)

The company's key numbers on shared boards, worked out live from the other features. Nothing is copied: every number is asked from its feature each time a board is opened.

- **Boards:** shared by the whole company. A new board can start with suggested numbers from the features that are turned on. Each tile shows the value for the period, a comparison, a target and a small bar or line chart of earlier periods.
- **Periods:** week (starting Monday), month, quarter or year, with arrows to step back and **Back to now**. Days start at midnight in the module's time zone.
- **Compare with** the period before, the same period last year, or nothing. For a period that is still running, numbers that add up (revenue, tickets…) are compared over the same number of days ("1 Oct–21 Oct"), so half a month isn't measured against a whole one.
- **Targets:** one per number and period length (for example 10,000 € revenue each month). The tile shows met, on track, behind or missed, with a pace marker for the running period.
- **Your own numbers:** anything counted by hand (visitors, followers, reviews). Values are typed in per date; over a period they are either added up or the latest one is used.
- **Weekly email:** per board, on a chosen weekday and hour, to chosen team members. Each person only gets the numbers they are allowed to see. Needs the SMTP settings.
- **Dashboard widget:** the first four numbers of the first board.

Turned off by default. An owner or admin adds it under **Add features**.

## Numbers available

| Feature | Numbers |
|---|---|
| Core | New contacts, Overdue tasks, Team members |
| Invoicing | Revenue, Invoiced (incl. tax), Payments received, Unpaid invoices, Overdue invoices |
| Expenses | Expenses, Expenses before tax, Expenses to approve |
| KPI | Profit = Revenue − Expenses before tax (only when both use the same currency) |
| CRM | Deals won (value), Deals won, New deals, Win rate, Open pipeline |
| Inventory | Items low on stock (current period only), Purchases received |
| Scheduling | Hours worked, Hours scheduled |
| Support | New tickets, Tickets solved, Open tickets, First response time, Response targets missed |
| HR | Leave days, Sick days |

Money numbers count only amounts in each feature's default currency; nothing is converted.

A number whose feature is turned off, or that the viewer may not see, shows as "not available" instead of a value. Permissions come from the number's own feature: for example expenses need the expense review permission, hours and leave need the manager permission of Scheduling and HR.

## Who can do what

| Permission | Lets you | Default roles |
|---|---|---|
| `kpi:board.read` | See boards, targets and your own numbers (each number still needs access to its feature) | viewer, member, manager, admin, owner |
| `kpi:board.manage` | Make and change boards, set targets, add hand-typed numbers, set up and send the weekly email | manager, admin, owner |
| `kpi:values.write` | Type in values for hand-typed numbers | manager, admin, owner |

## Settings

Under **Add features → KPI dashboard → Settings**:
- **Time zone** (default UTC): where days, weeks and months start, and the hour of the weekly email.
- **Send from**, **Sender name**, **SMTP server, port, security, user, password** (password stored encrypted). In production, private or local mail servers are refused unless `KPI_ALLOW_PRIVATE_MAIL_HOSTS=true` (in development they are allowed unless it is `false`).

The weekly email job runs every 15 minutes and sends each board at most once a day, when its weekday and hour have come in the time zone. It covers the period that contains yesterday.

## API

All under `/api/v1/m/kpi`:

| Route | |
|---|---|
| `GET /config` | Time zone, whether email is set up, what the caller may do |
| `POST /email/test` | Check the SMTP settings |
| `GET/POST /boards`, `GET/PATCH/DELETE /boards/:id` | Boards, tiles and email settings |
| `GET /boards/:id/values?period=&date=&compare=&tiles=&chart=` | The values for one period |
| `POST /boards/:id/email` | Send the weekly email now |
| `GET/PUT /targets` | Targets (PUT with `value: null` removes one) |
| `GET/POST /manual`, `GET/PATCH/DELETE /manual/:id` | Your own numbers |
| `PUT /manual/:id/values` | Set or remove (`value: null`) the value of one date |

## Data

All tables have tenant row-level security:

| Table | Holds |
|---|---|
| `kpi_boards` | Boards: name, default period, comparison, weekly email settings and last send |
| `kpi_tiles` | The numbers on a board, in order, with an optional label and chart type |
| `kpi_targets` | One target per number and period length |
| `kpi_manual_metrics` | Hand-typed numbers: name, unit, currency, add up or latest, which way is good |
| `kpi_manual_values` | One value per hand-typed number and date, with a note |

## Platform pieces this module added

- **Metrics contract:** modules publish numbers with `metrics: [metric({ key, label, unit, kind, permission, compute })]`, and readers call `ctx.metrics.list()` / `ctx.metrics.get(key, range)` (needs `core:metrics.read`). See ARCHITECTURE 4.2.
- `ctx.people.can(userId, permission)`, used to leave out numbers a digest reader may not see.
- `metricRange`, `startOfDay`, `todayIn` and `isTimeZone` in `@office/sdk`.
