# Invoices & Expenses (`@office/module-expenses`)

Money the business spends: receipts employees paid for, and supplier invoices to pay.
Employees snap or upload the document, check the details that were read from it, and submit. Managers approve or reject
(with a comment), then mark it paid. Filters and CSV export for bookkeeping.

## Flow

```
draft ──submit──▶ submitted ──approve──▶ approved ──pay──▶ paid
  ▲                   │
  └──edit+submit── rejected (comment required)
```

- Only the person who paid (`employee_id`, the creator) submits. Reviewers can correct a draft/submitted/rejected expense;
  approved and paid ones are locked (409). Drafts and rejected ones can be deleted (with their file).
- Decisions are guarded against two managers acting at once (status-checked update). Every step lands in `expenses_history`
  and the audit log, and emits `expenses.expense.{created,submitted,approved,rejected,paid}`.
- Amounts are integer cents. `total = subtotal + tax`. Line items are optional; if present they must add up to the total
  (prices including tax, common in Spain) or to the amount before tax.

## Receipt reading (OCR)

Runs **in the browser** with Tesseract.js (English + Spanish), so receipts are not sent to any outside service. The web app
serves the engine and language data from `/ocr/` (see `apps/web/vite.config.ts`), no CDN. Photos are shrunk to max 2000 px JPEG
before upload. `src/receipt.ts` turns the text into suggested vendor, date, number, currency, lines, tax and total
(`tests/receipt.test.ts`). Everything is shown for review before saving. PDFs are attached as-is (no OCR).

## Files

`expenses_files` (bytea, max 5 MB, JPEG/PNG/WEBP/PDF, content checked against magic bytes). Employees can open files of their own
expenses; reviewers any. Uploads never attached to an expense are removed after a day (job `purge_orphan_files`).

## Permissions (granted on enable)

| Permission | Manager | Member |
|---|---|---|
| `expenses:expense.read` (own; everyone's with review) | ✓ | ✓ |
| `expenses:expense.submit` | ✓ | ✓ |
| `expenses:expense.review` (see all, approve, reject, pay, export all) | ✓ | |

Owner and Admin have everything.

## API (`/api/v1/m/expenses`)

| Method | Path | Notes |
|---|---|---|
| GET | `/config` · `/summary` | settings, what the caller may do; dashboard counts |
| GET | `/expenses?status&from&to&vendor&employeeId&category&q&mine&limit&offset` | employees: own only |
| GET | `/export?…same filters` | `{ filename, rows, csv }` (UTF-8 BOM, formulas neutralised) |
| POST/PATCH/DELETE | `/expenses` · `/expenses/:id` | |
| POST | `/expenses/:id/submit` · `/approve {comment?}` · `/reject {comment}` · `/pay` | |
| POST/GET | `/files` `{ name, contentType, data(base64) }` · `/files/:id` | 8 MB body limit |
| GET | `/people` | reviewers: employee filter |

## Settings

`currency` (default EUR), `categories` (list shown in the form).

## Not yet

Paying through a bank, multi-currency conversion, mileage/per-diem, approval limits per amount, email notifications.
