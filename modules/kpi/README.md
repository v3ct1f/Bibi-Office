# KPI dashboard (`kpi`)

Dashboards of key numbers from the other modules: revenue, overdue invoices, pipeline, spend, tickets, stock, signatures and more. You pick the period; each number is compared with the previous period of the same length, can show a trend, and can have a target.

## How it works
- **Modules publish metrics** (`ModuleDefinition.metrics`, SDK). Each metric has a label, unit (`count | money | percent | hours`), kind (`flow` = over the period, `stock` = now), `lowerIsBetter`, a permission, and a read-only `compute(ctx, range)`.
- **Core computes them live** (`GET /api/v1/metrics`, `GET /api/v1/metrics/values`). Nothing is copied or cached, so numbers always match the module pages and respect RLS.
- Only metrics of **enabled modules** that the **viewer has permission for** are listed or computed. A tile you can't see is hidden (admins see a placeholder that says which module to turn on).
- Each metric runs in its own savepoint: one failing metric shows as "couldn't be calculated" and the rest still load.
- This module stores only the dashboard layout.

## Model
`kpi_dashboards`: name (unique per tenant), position, tiles (≤24) `[{id, metric, view: number | line | bar, target}]`. An "Overview" dashboard is created on enable.

## Periods
Presets: this month, last month, last 30/90 days, this quarter, this year, last 12 months, or custom dates (organization time zone, ≤3 years). Points per day (≤31 days), week (≤190 days, Monday start) or month. Comparison: the same number of days just before.

## Money
Minor units in each module's default currency. Rows in other currencies aren't converted (the tile says how many were left out). Targets are entered in major units (e.g. 5000 = €5,000).

## Metrics (v1)
| Key | Unit | Kind |
|---|---|---|
| `invoicing.revenue` (payments received), `invoicing.invoiced` | money | flow |
| `invoicing.outstanding`, `invoicing.overdue`↓ | money | stock |
| `crm.won_value` | money | flow |
| `crm.win_rate` | percent | flow |
| `crm.pipeline` | money | stock |
| `expenses.spend` | money | flow |
| `expenses.to_approve`↓ | count | stock |
| `scheduling.bookings` | count | flow |
| `support.new_tickets` | count | flow |
| `support.first_response`↓ (median hours) | hours | flow |
| `support.open_tickets`↓ | count | stock |
| `hr.headcount`, `hr.off_today` | count | stock |
| `inventory.stock_value` | money | stock |
| `inventory.low_stock`↓ | count | stock |
| `docs.signed` | count | flow |
| `docs.waiting` | count | stock |
| `ai.summaries` | count | flow |

↓ = lower is better. Each uses its module's read permission (e.g. `crm:deal.read`, `expenses:expense.read_all`).

## Permissions
| Key | Default roles |
|---|---|
| `kpi:dashboards.read` | member, admin |
| `kpi:dashboards.manage` (arrange, targets, add/delete dashboards) | admin |

## API
Module (`/api/v1/m/kpi`): `GET|POST /dashboards`, `GET|PATCH|DELETE /dashboards/:id`.
Core: `GET /metrics` (catalog), `GET /metrics/values?keys=a.b,c.d&from=YYYY-MM-DD&to=YYYY-MM-DD[&bucket=day|week|month][&compare=false]` (≤30 keys).

## UI
Nav "KPIs" (`/m/kpi/dashboards`): dashboard tabs, period picker, stat tiles (value, change vs previous period with ▲▼ and colour, sparkline, line or bar chart with hover/keyboard readout and a screen-reader table, target meter). Edit mode: add, remove, reorder, view, target, rename, new/delete dashboard. Home widget "KPIs this month".

## Adding a metric to a module
```ts
import { flowSum, metric } from "@office/sdk";
metrics: {
  "mymod.things": metric({ label: "Things", permission: P.read, unit: "count", kind: "flow",
    compute: (ctx, r) => flowSum(ctx, r, { from: "mymod_things", at: "created_at", value: "1" }) }),
}
```
Keep it to a few indexed queries; it runs on every dashboard view.
