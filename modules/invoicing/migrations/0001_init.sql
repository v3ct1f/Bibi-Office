-- Invoicing v1: invoices, lines, payments, gapless number sequences.
-- Money is integer minor units (cents). Quantities have 3 decimals, tax rates 2 decimals.

CREATE TABLE invoicing_invoices (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number              text,                                   -- assigned when sent; NULL while draft
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'void')),
  company_id          uuid,
  contact_id          uuid,
  bill_to             jsonb NOT NULL DEFAULT '{}',            -- snapshot: name, email, address, taxId
  currency            char(3) NOT NULL,
  issue_date          date NOT NULL,
  due_date            date NOT NULL,
  notes               text,
  subtotal_cents      bigint NOT NULL DEFAULT 0,
  tax_cents           bigint NOT NULL DEFAULT 0,
  total_cents         bigint NOT NULL DEFAULT 0,
  paid_cents          bigint NOT NULL DEFAULT 0,
  source              text NOT NULL DEFAULT 'manual',         -- manual | workflow | crm.deal
  source_ref          text,
  sent_at             timestamptz,
  paid_at             timestamptz,
  voided_at           timestamptz,
  void_reason         text,
  overdue_at          timestamptz,                            -- set once by the mark_overdue job
  reminder_count      integer NOT NULL DEFAULT 0,
  last_reminded_at    timestamptz,
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (due_date >= issue_date),
  CHECK (paid_cents >= 0 AND paid_cents <= total_cents),
  CHECK ((status = 'draft') = (number IS NULL)),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies(tenant_id, id) ON DELETE SET NULL (company_id),
  FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts(tenant_id, id) ON DELETE SET NULL (contact_id)
);
CREATE UNIQUE INDEX invoicing_invoices_number_uq ON invoicing_invoices (tenant_id, number) WHERE number IS NOT NULL;
CREATE UNIQUE INDEX invoicing_invoices_source_uq ON invoicing_invoices (tenant_id, source, source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX invoicing_invoices_company_idx ON invoicing_invoices (tenant_id, company_id);
CREATE INDEX invoicing_invoices_contact_idx ON invoicing_invoices (tenant_id, contact_id);
CREATE INDEX invoicing_invoices_overdue_idx ON invoicing_invoices (tenant_id, due_date) WHERE status = 'sent' AND overdue_at IS NULL;

CREATE TABLE invoicing_invoice_lines (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id        uuid NOT NULL,
  position          integer NOT NULL,
  description       text NOT NULL,
  quantity          numeric(12, 3) NOT NULL CHECK (quantity > 0),
  unit_price_cents  bigint NOT NULL,
  tax_rate          numeric(5, 2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  net_cents         bigint NOT NULL,
  tax_cents         bigint NOT NULL,
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoicing_invoices(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX invoicing_invoice_lines_invoice_idx ON invoicing_invoice_lines (tenant_id, invoice_id, position);

CREATE TABLE invoicing_payments (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id    uuid NOT NULL,
  amount_cents  bigint NOT NULL CHECK (amount_cents > 0),
  paid_on       date NOT NULL,
  method        text,
  reference     text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoicing_invoices(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX invoicing_payments_invoice_idx ON invoicing_payments (tenant_id, invoice_id);

-- One counter per tenant and period ('2026' for yearly formats, '' otherwise). Row lock keeps numbers gapless.
CREATE TABLE invoicing_sequences (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period      text NOT NULL,
  last_value  integer NOT NULL,
  PRIMARY KEY (tenant_id, period)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['invoicing_invoices','invoicing_invoice_lines','invoicing_payments','invoicing_sequences'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON invoicing_invoices, invoicing_invoice_lines, invoicing_payments, invoicing_sequences TO office_app;
