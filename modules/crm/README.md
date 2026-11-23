# CRM (`@office/module-crm`)

Sales pipeline: deals move through the stages of a pipeline, with a timeline of notes, calls, meetings and emails.
Winning a deal emits `crm.deal.won`, which Invoicing turns into a draft invoice.

## Model

```
pipeline ─< stage (ordered; kind open | won | lost; probability 0-100)
              └─< deal (status = kind of its stage) ─< activity (note | call | meeting | email | stage | system)
```

- A new tenant gets a **Sales** pipeline on enable (`lifecycle.enable`, idempotent): Lead 10%, Qualified 25%, Proposal sent 50%,
  Negotiation 75%, Won 100%, Lost 0%. Every pipeline needs at least one open, one won and one lost stage.
- **Moving** a deal (`POST /deals/:id/move`) sets its status from the target stage's kind, stamps `closed_at` when it becomes won/lost
  (cleared when reopened), keeps `lost_reason` only while lost, and writes a `stage` activity. Moving across pipelines is allowed.
- Stages with deals cannot be removed or change kind (409); move the deals first. Only empty pipelines can be deleted; the last one cannot.
- Deals link to a core company and/or contact (FKs `ON DELETE SET NULL`). DTOs include `companyName` / `contactName`, resolved per request.
- `next_step` + `next_step_date`: open deals with a due next step are highlighted and counted in `/summary.nextStepsDue`.
- Money is integer cents per deal currency. Weighted value = value × stage probability.

## Settings

| Key | Default | Notes |
|---|---|---|
| `currency` | `EUR` | Default for new deals |

Pipelines and stages are data, edited on the module's **Pipeline settings** page (`/settings`, needs `crm:pipeline.manage`).

## API (`/api/v1/m/crm`)

| Method | Path | Permission |
|---|---|---|
| GET | `/config` · `/pipelines` · `/board?pipelineId` · `/summary` · `/deals?pipelineId&status&companyId&contactId&q&limit&cursor` · `/deals/:id` | `crm:deal.read` |
| POST/PATCH/DELETE | `/deals` · `/deals/:id` | `crm:deal.write` |
| POST | `/deals/:id/move` `{ stageId, lostReason? }` · `/deals/:id/activities` `{ kind, body }` | `crm:deal.write` |
| POST/PATCH/DELETE | `/pipelines` · `/pipelines/:id` (`stages` replaces the list; keep `id` for existing stages) | `crm:pipeline.manage` |

The board returns every stage of one pipeline with its open deals plus deals closed in the last 30 days.

## Events (payload v1)

`crm.deal.{created,updated,stage_changed,won,lost,reopened,deleted}`, `crm.activity.logged`.
Deal payload: `{ id, title, valueCents, currency, status, stage, stageId, pipelineId, companyId, contactId, ownerId, expectedClose }`;
`stage_changed` adds `fromStage`, `fromStageId`; `lost` adds `lostReason`; `updated` adds `changes` (field names).
`crm.deal.won` is emitted every time a deal enters a won stage; Invoicing drafts at most one invoice per deal id.

Subscribes to `leads.lead.converted`: when the payload has `deal: { title, valueCents, currency }`, CRM opens that deal in the first open stage for the new contact/company, with a "Created from a lead" note.

## Workflow actions

- `crm.create_deal` `{ title, amount?, currency?, companyId?, contactId?, stage? }` → `{ dealId, stage }`
- `crm.move_deal` `{ dealId, stage (name, or won / lost / open), lostReason? }` → `{ dealId, status, stage }`
- `crm.log_activity` `{ dealId, body }` → `{ activityId }`

## UI slots

Deals board (`nav.main`, drag and drop plus a "Move" select per card for keyboard users, list view with filters),
"+ New → Deal" (`global.create`), Deals tab on companies and contacts, "Sales pipeline" dashboard widget, Pipeline settings (`nav.settings`).

## Not yet

Deal owners in the UI (API stores `ownerId`), products/line items on deals, email sync into the timeline, reminders for due next steps
(use a workflow), multi-currency forecast conversion.
