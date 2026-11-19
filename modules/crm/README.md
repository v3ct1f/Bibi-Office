# CRM (`@office/module-crm`)

Sales pipeline: deals move through ordered stages and close as won or lost; activities (notes, calls, emails, meetings, tasks) on deals, contacts and companies.

## Model
| Table | Notes |
|---|---|
| `crm_stages` | One pipeline per tenant. Ordered by `position`, `probability` (0-100) weights the forecast. Defaults seeded on first enable: Lead 10, Qualified 25, Proposal 50, Negotiation 75. Won/lost are outcomes, not stages. |
| `crm_deals` | `value` in minor units, `currency`, `status open/won/lost`, contact/company (core), `owner_id` must be a member of the tenant (composite FK to memberships, cleared if they leave). `stage_changed_at` drives the "stale" flag. |
| `crm_activities` | `type note/call/email/meeting/task`, linked to deal and/or contact/company (activities on a deal inherit its contact/company). Notes etc. are done on creation; tasks have `due_at` and are completed later. |

All tables: `tenant_id` + forced RLS, composite FKs `(tenant_id, id)`.

## API (`/api/v1/m/crm`)
| Method | Path | Permission |
|---|---|---|
| GET | `/stages`, `/board`, `/summary`, `/deals?status&stageId&contactId&companyId&ownerId&q&limit&cursor`, `/deals/:id`, `/activities?dealId\|contactId\|companyId&open=true` | `crm:deal.read` |
| POST / PATCH / DELETE | `/deals`, `/deals/:id`; POST `/deals/:id/move {stageId}`, `/won`, `/lost {reason?}`, `/reopen` | `crm:deal.write` |
| POST / PATCH / DELETE | `/activities`, `/activities/:id` (`{done: true}` completes a task) | `crm:activity.write` |
| POST / PATCH / DELETE / PUT | `/stages`, `/stages/:id`, `/stages/order {ids}` | `crm:pipeline.manage` |

Closed deals can't be moved (reopen first). A stage with deals can't be deleted; the last stage can't be deleted.

## Events (payload `v: 1`: `id, dealId, title, amount, value, currency, status, stageId, contactId, companyId, ownerId, expectedClose`)
`crm.deal.created`, `crm.deal.stage_changed (+fromStageId, toStageName)`, `crm.deal.won`, `crm.deal.lost (+reason)`, `crm.deal.reopened`, `crm.activity.created|completed` (`id, type, subject, dealId, contactId, companyId, dueAt, doneAt`). All but `reopened` are workflow triggers.

`crm.deal.won` matches the contract invoicing consumes (`dealId, title, amount, currency, contactId, companyId`) → invoicing drafts one invoice per won deal. CRM consumes `invoicing.invoice.paid` and, when its `source` is `crm.deal:<id>`, logs "Invoice … paid" on that deal. Neither module imports the other.

## Workflow actions
- `crm.create_deal` `{title, value?, currency?, contactId?, companyId?, stageId?}` → `{id, stageId, value}`
- `crm.log_activity` `{type, subject, body?, dealId?, contactId?, companyId?, dueInDays?}` → `{id, dueAt}`

## Settings
`currency` (EUR), `staleAfterDays` (30).

## UI (`./ui`)
Page `/m/crm/deals` (board with drag and drop + list view, stage editor), `/m/crm/deals/:id` (stage stepper, won/lost/reopen, edit, activity timeline). `DealsTab` and `ActivityTab` on contacts and companies, `PipelineWidget` on the dashboard.

## Not yet
Multiple pipelines, deal products/line items, email sync into the timeline, task reminders (needs core notifications), owner picker in the UI (API supports `ownerId`), forecasting by expected close month.

## Tests
`TEST_DATABASE_URL=... pnpm --filter @office/module-crm test` (stages, deals, won → invoice draft → paid → note, activities, summary, isolation, permissions, workflows). E2E: `apps/web/e2e/sales.spec.ts`.
