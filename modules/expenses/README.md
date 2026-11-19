# Expenses (`expenses`)

Expense claims with receipts. Members submit, approvers approve or send back, finance marks them reimbursed and exports a CSV.

## Model
- `expenses_categories`: name (unique per tenant, case-insensitive), optional account `code`, `archived`. Six defaults seeded on enable.
- `expenses_expenses`: one claim = one receipt. `amount`/`tax` in minor units, `currency`, `spent_on`, `merchant`, `category_id`, `submitter_id` (FK to memberships), receipt (`documents` row with `module = 'expenses'`).
- Status: `draft → submitted → approved → reimbursed`; `submitted → rejected → (edit) draft → submitted`.
- DB triggers: approved/reimbursed rows can't change (except approved → reimbursed); only draft/rejected rows can be deleted.

## Rules
- Only the submitter edits, deletes, attaches receipts, and only while draft/rejected.
- Submit needs amount > 0, a category, and a receipt when `amount > receiptRequiredOver`.
- Approvers can't decide their own claims unless `allowSelfApproval`. Rejection needs a reason.
- Members see only their own claims; `read_all`, `approve` or `reimburse` see everyone's.
- Reimburse is a batch (`POST /reimburse {ids, reference}`), all-or-nothing.

## Permissions
| Key | Default roles |
|---|---|
| `expenses:expense.submit` | member, admin |
| `expenses:expense.read_all` | admin |
| `expenses:expense.approve` | admin |
| `expenses:expense.reimburse` | admin |
| `expenses:category.manage` | admin |

Requires `core:documents.read`, `core:documents.write` (receipts).

## Settings
`currency` (EUR), `receiptRequiredOver` (2500 minor units), `allowSelfApproval` (false).

## API (`/api/v1/m/expenses`)
- `GET/POST /categories`, `PATCH /categories/:id`
- `GET /expenses?status&mine&submitterId&categoryId&from&to&cursor&limit`, `POST /expenses`, `GET/PATCH/DELETE /expenses/:id`
- `POST /expenses/:id/receipt?filename=` (raw file body), `GET|DELETE /expenses/:id/receipt`
- `POST /expenses/:id/submit|approve|reject`, `POST /reimburse`
- `GET /summary`, `GET /export.csv?from&to&status` (formula-safe, UTF-8 BOM)

## Events (v1)
`expenses.expense.submitted|approved|rejected|reimbursed` — `{ id, submitterId, spentOn, merchant, categoryId, amount, tax, currency }` (+ `note` / `reference`).

## Workflow action
`expenses.approve { id, note? }` — e.g. trigger `expenses.expense.submitted`, condition `{"<": [{"var": "payload.amount"}, 5000]}`, input `{ "id": "{{payload.id}}" }` to auto-approve small claims.

## UI
`/m/expenses/expenses`: tabs My expenses / To approve / To reimburse / All; detail page with receipt preview; categories and CSV export dialogs. Dashboard card `ExpensesWidget`.

## Tests
`tests/expenses.test.ts` (18), E2E `apps/web/e2e/spend.spec.ts`.
