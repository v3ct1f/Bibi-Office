-- Invoice details: customer reference / PO number, delivery or service date, and a snapshot of the
-- seller's business details taken when the invoice is finalized (issued invoices never change).
ALTER TABLE invoicing_invoices
  ADD COLUMN reference    text,
  ADD COLUMN service_date date,
  ADD COLUMN seller       jsonb;
