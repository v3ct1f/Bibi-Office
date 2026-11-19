# Invoicing (`@office/module-invoicing`)

Invoices with line items and tax, gapless numbering, PDF, payments, overdue tracking and reminders.

## Model
| Table | Notes |
|---|---|
| `invoicing_invoices` | `draft → open → paid`, or `open → void`. Customer = contact and/or company (core). Snapshots of customer + seller taken on issue. |
| `invoicing_invoice_lines` | `quantity_milli` (thousandths), `unit_price` (minor units, may be negative), `tax_rate_bp` (basis points), stored `net`/`tax`. |
| `invoicing_payments` | Append-only (no update/delete grant). Sum can't exceed total. |
| `invoicing_sequences` | Per tenant + scope counter. Incremented in the issuing tx (row lock), so numbers are gapless and never reused. |

- Money: integers in minor units everywhere (API too: `unitPrice: 12000` = €120.00). Per-line rounding half away from zero, then sums.
- Immutability: after issue, a DB trigger blocks changes to number, customer, dates, amounts, lines; only lifecycle columns (status, paid, sent, reminders, void) change. Corrections = void + new invoice.
- Tenant isolation: all tables `tenant_id` + forced RLS; FKs composite `(tenant_id, id)` to contacts/companies.

## API (`/api/v1/m/invoicing`)
| Method | Path | Permission |
|---|---|---|
| GET | `/invoices?status=draft\|open\|overdue\|paid\|void&contactId&companyId&q&limit&cursor` | `invoicing:invoice.read` |
| GET | `/invoices/:id`, `/invoices/:id/pdf`, `/summary` | `invoicing:invoice.read` |
| POST / PUT / DELETE | `/invoices`, `/invoices/:id` (drafts only) | `invoicing:invoice.write` |
| POST | `/invoices/:id/issue`, `/send`, `/remind` | `invoicing:invoice.send` |
| POST | `/invoices/:id/void` `{reason}` (open, no payments) | `invoicing:invoice.void` |
| POST | `/invoices/:id/payments` `{amount, paidOn?, method?, reference?}` | `invoicing:payment.write` |

Errors: 404 not found / other tenant, 409 wrong state, 422 business rule (overpayment, no customer/lines).

## Events (payload `v: 1`: `id, number, status, currency, total, amountPaid, balance, issueDate, dueDate, contactId, companyId, customer{name,email}, source` — `source` added in 1.1.0)
`invoicing.invoice.created|issued|sent(+to)|paid|overdue(+daysOverdue)|voided(+reason)|reminder_requested(+reminderCount)`, `invoicing.payment.recorded(+payment)`. All except `created` are workflow triggers.

Consumes `crm.deal.won` v1 `{dealId, title, amount (minor), currency?, contactId?, companyId?}` → one draft per deal (`source = crm.deal:<dealId>`), if setting `draftOnDealWon`.

## Workflow actions
- `invoicing.create_invoice` `{contactId?, companyId?, currency?, notes?, lines[], issue?}` → `{id, number, total, status}`
- `invoicing.send_reminder` `{invoiceId}` → `{id, reminderCount}` (throttled by `reminderIntervalDays`)

## Job
`mark-overdue` hourly per tenant: flags open invoices past due once, emits `invoicing.invoice.overdue`.

## Settings
`currency` (EUR), `numberFormat` (`INV-{YYYY}-{seq:5}`; tokens `{YYYY} {YY} {MM} {seq[:N]}`, counter restarts when the text around `{seq}` changes), `paymentTermDays` (30), seller name/address/tax ID/email, `paymentInstructions`, `footer`, `draftOnDealWon` (true), `reminderIntervalDays` (7).

## UI (`./ui`)
Page `/m/invoicing/invoices` (list with status filters + search, `/new`, `/:id`, `/:id/edit`), `OutstandingWidget` (dashboard), `InvoicesTab` (contact and company pages).

## Not yet
Email delivery (events carry the recipient; needs core email action), credit notes/refunds, quotes, recurring invoices, multi-currency FX, Stripe payment links, Unicode fonts in PDF (non-Latin-1 chars print as `?`), tenant time zone for due dates (UTC now).

## Tests
`TEST_DATABASE_URL=... pnpm --filter @office/module-invoicing test` (money math + API integration: numbering, immutability, payments, isolation, job, PDF, CRM hook, workflows). E2E: `apps/web/e2e/invoicing.spec.ts`.
