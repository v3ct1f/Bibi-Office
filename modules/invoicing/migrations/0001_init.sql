-- Invoicing v1: invoices, lines, payments, per-tenant number sequences.
-- Money = bigint minor units (cents). Quantities = bigint thousandths. Tax rates = basis points.

CREATE TABLE invoicing_invoices (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number          text,                                   -- assigned on issue, gapless per sequence scope
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'paid', 'void')),
  contact_id      uuid,
  company_id      uuid,
  currency        char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  issue_date      date,
  due_date        date,
  notes           text CHECK (length(notes) <= 4000),
  customer        jsonb,                                  -- snapshot on issue (name, email, address, taxId)
  seller          jsonb,                                  -- snapshot on issue (from settings)
  subtotal        bigint NOT NULL DEFAULT 0,
  tax_total       bigint NOT NULL DEFAULT 0,
  total           bigint NOT NULL DEFAULT 0,
  amount_paid     bigint NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  source          text,                                   -- idempotency for automated creation, e.g. "crm.deal:<id>"
  sent_at         timestamptz,
  overdue_at      timestamptz,
  paid_at         timestamptz,
  voided_at       timestamptz,
  void_reason     text,
  reminder_count  int NOT NULL DEFAULT 0,
  last_reminded_at timestamptz,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, number),
  UNIQUE (tenant_id, source),
  FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts(tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies(tenant_id, id),
  CHECK (status = 'draft' OR (number IS NOT NULL AND issue_date IS NOT NULL AND due_date IS NOT NULL AND customer IS NOT NULL)),
  CHECK (due_date IS NULL OR issue_date IS NULL OR due_date >= issue_date),
  CHECK (amount_paid <= total OR status = 'void')
);
CREATE INDEX invoicing_invoices_list ON invoicing_invoices (tenant_id, id DESC);
CREATE INDEX invoicing_invoices_open ON invoicing_invoices (tenant_id, due_date) WHERE status = 'open';
CREATE INDEX invoicing_invoices_contact ON invoicing_invoices (tenant_id, contact_id);
CREATE INDEX invoicing_invoices_company ON invoicing_invoices (tenant_id, company_id);

CREATE TABLE invoicing_invoice_lines (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id      uuid NOT NULL,
  position        int NOT NULL CHECK (position >= 0),
  description     text NOT NULL CHECK (length(description) BETWEEN 1 AND 1000),
  quantity_milli  bigint NOT NULL CHECK (quantity_milli > 0),
  unit_price      bigint NOT NULL,                        -- may be negative (discount line)
  tax_rate_bp     int NOT NULL DEFAULT 0 CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  net             bigint NOT NULL,
  tax             bigint NOT NULL,
  UNIQUE (tenant_id, invoice_id, position),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoicing_invoices(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE invoicing_payments (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id      uuid NOT NULL,
  amount          bigint NOT NULL CHECK (amount > 0),
  paid_on         date NOT NULL,
  method          text NOT NULL CHECK (method IN ('bank_transfer', 'card', 'cash', 'other')),
  reference       text CHECK (length(reference) <= 200),
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoicing_invoices(tenant_id, id)
);
CREATE INDEX invoicing_payments_invoice ON invoicing_payments (tenant_id, invoice_id);

CREATE TABLE invoicing_sequences (
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope           text NOT NULL,                          -- format with date parts expanded, e.g. "INV-2026-"
  last_value      bigint NOT NULL,
  PRIMARY KEY (tenant_id, scope)
);

-- Issued invoices are immutable documents: only lifecycle columns may change after leaving draft,
-- and lines can only be written while the invoice is a draft. Enforced in the DB, not just the API.
CREATE FUNCTION invoicing_guard_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'issued invoice % cannot be deleted', OLD.id USING ERRCODE = '23514'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'draft' AND (
       NEW.number IS DISTINCT FROM OLD.number OR NEW.contact_id IS DISTINCT FROM OLD.contact_id
    OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.issue_date IS DISTINCT FROM OLD.issue_date OR NEW.due_date IS DISTINCT FROM OLD.due_date
    OR NEW.notes IS DISTINCT FROM OLD.notes OR NEW.customer IS DISTINCT FROM OLD.customer
    OR NEW.seller IS DISTINCT FROM OLD.seller OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
    OR NEW.tax_total IS DISTINCT FROM OLD.tax_total OR NEW.total IS DISTINCT FROM OLD.total
    OR NEW.status = 'draft' OR OLD.status = 'void'
  ) THEN
    RAISE EXCEPTION 'issued invoice % is immutable', OLD.id USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER invoicing_guard_invoice BEFORE UPDATE OR DELETE ON invoicing_invoices
  FOR EACH ROW EXECUTE FUNCTION invoicing_guard_invoice();

CREATE FUNCTION invoicing_guard_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  SELECT status INTO s FROM invoicing_invoices
   WHERE tenant_id = coalesce(NEW.tenant_id, OLD.tenant_id) AND id = coalesce(NEW.invoice_id, OLD.invoice_id);
  -- s IS NULL: parent is being deleted (cascade from a draft delete).
  IF s IS NOT NULL AND s <> 'draft' THEN
    RAISE EXCEPTION 'lines of issued invoice are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER invoicing_guard_line BEFORE INSERT OR UPDATE OR DELETE ON invoicing_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION invoicing_guard_line();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['invoicing_invoices', 'invoicing_invoice_lines', 'invoicing_payments', 'invoicing_sequences'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON invoicing_invoices, invoicing_invoice_lines TO office_app;
GRANT SELECT, INSERT ON invoicing_payments TO office_app;
GRANT SELECT, INSERT, UPDATE ON invoicing_sequences TO office_app;
