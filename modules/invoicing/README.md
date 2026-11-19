# Invoicing (`@office/module-invoicing`)

Invoices with gapless numbering, partial payments, overdue tracking and reminders.

## Lifecycle

```
draft ──send──> sent ──payments = total──> paid
  │              │  └─(due date passed)──> shown as "overdue" (job emits invoicing.invoice.overdue once)
  └─delete       └─void (only without payments; number stays used)
```

- **Drafts** are freely editable and have no number. Deleting a draft never leaves a gap.
- **Send** assigns the next number for the period (row-locked counter in `invoicing_sequences`) and locks the invoice.
  Email delivery is not built yet: print / save as PDF from the invoice page, or hook `invoicing.invoice.sent` to a webhook.
- **Payments** can be partial; the invoice becomes `paid` when the balance reaches zero. Overpayment is refused.
- **Display status** (API `displayStatus`): `draft | sent | partially_paid | overdue | paid | void`, computed from stored status, due date and payments.

## Money

Integer minor units (cents) everywhere. Line amount = round(quantity × unit price), tax = round(net × rate) per line,
half away from zero, BigInt arithmetic (`src/money.ts`, shared by API and UI so the editor preview matches exactly).
Quantity ≤ 3 decimals, tax rate ≤ 2 decimals, negative unit prices allowed (discount lines), invoice total must be > 0 to send.

## Settings

| Key | Default | Notes |
|---|---|---|
| `currency` | `EUR` | Default for new invoices; each invoice keeps its own currency |
| `numberFormat` | `INV-{YYYY}-{seq:5}` | Tokens `{YYYY} {YY} {MM} {seq:N}`; counter restarts per year/month when the format contains it |
| `paymentTermDays` | `30` | Default due date |
| `defaultTaxRate` | `0` | Percent, prefilled on new lines |
| `sellerName`, `sellerAddress`, `sellerTaxId`, `paymentInstructions` | — | Printed on the invoice |

## API (`/api/v1/m/invoicing`)

| Method | Path | Permission |
|---|---|---|
| GET | `/invoices?status=&companyId=&contactId=&q=&limit=&cursor=` | `invoicing:invoice.read` |
| GET | `/invoices/:id` (with lines + payments), `/summary`, `/config` | `invoicing:invoice.read` |
| POST | `/invoices` · PATCH `/invoices/:id` · DELETE `/invoices/:id` (drafts) | `invoicing:invoice.write` |
| POST | `/invoices/:id/payments` · `/invoices/:id/void` | `invoicing:invoice.write` |
| POST | `/invoices/:id/send` · `/invoices/:id/remind` | `invoicing:invoice.send` |

`status` filter values: `draft | sent | outstanding | overdue | paid | void`.

## Events (payload v1)

`invoicing.invoice.{created,sent,paid,overdue,voided,reminded}` and `invoicing.payment.recorded`, all usable as workflow triggers.
Payload: `{ id, number, status, currency, totalCents, paidCents, balanceCents, dueDate, companyId, contactId, customerName }`
plus `daysOverdue` (overdue), `reminderCount` (reminded), `reason` (voided), `paymentId, amountCents` (payment.recorded).

## Workflow actions

- `invoicing.create_invoice` `{ companyId? | contactId?, description, amount (major units), taxRate?, dueInDays?, send? }` → `{ invoiceId, number, totalCents }`
- `invoicing.send_reminder` `{ invoiceId }` → `{ invoiceId, reminderCount }`

## Subscriptions

- `crm.deal.won` (from the CRM module, Session 6): drafts one invoice per deal. Expected payload v1:
  `{ id, title?, valueCents, currency?, companyId?, contactId? }`. Idempotent per deal id.

## Jobs

- `mark_overdue` (hourly): flags sent invoices past their due date once and emits `invoicing.invoice.overdue`.

## UI slots

Invoices page (`nav.main`), "+ New → Invoice" (`global.create`), Invoices tab on companies and contacts,
outstanding/overdue dashboard widget. Print view prints only the invoice sheet.

## Not yet

Email delivery (needs core `send_email`), PDF files in Documents (needs uploads), credit notes, recurring invoices,
Stripe payment links, multi-currency reporting conversion, tenant time zones for due dates (UTC today).
