-- Expenses v1: receipts and supplier invoices that employees submit and managers approve.
-- Money is integer minor units (cents). Files (photos / PDFs) live in expenses_files, scoped like everything else.

CREATE TABLE expenses_files (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  content_type  text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes    integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  data          bytea NOT NULL,
  uploaded_by   uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE expenses_expenses (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind              text NOT NULL DEFAULT 'receipt' CHECK (kind IN ('receipt', 'invoice')),
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'paid')),
  employee_id       uuid NOT NULL,
  vendor            text NOT NULL,
  doc_date          date NOT NULL,
  due_date          date,
  invoice_number    text,
  category          text,
  description       text,
  currency          char(3) NOT NULL,
  subtotal_cents    bigint NOT NULL CHECK (subtotal_cents >= 0),
  tax_cents         bigint NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents       bigint NOT NULL CHECK (total_cents >= 0),
  file_id           uuid,
  ocr_text          text,
  submitted_at      timestamptz,
  decided_by        uuid,
  decided_at        timestamptz,
  decision_comment  text,
  paid_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (total_cents = subtotal_cents + tax_cents),
  FOREIGN KEY (tenant_id, file_id) REFERENCES expenses_files(tenant_id, id) ON DELETE SET NULL (file_id)
);
CREATE INDEX expenses_expenses_list_idx ON expenses_expenses (tenant_id, doc_date DESC, id DESC);
CREATE INDEX expenses_expenses_status_idx ON expenses_expenses (tenant_id, status);
CREATE INDEX expenses_expenses_employee_idx ON expenses_expenses (tenant_id, employee_id);

CREATE TABLE expenses_lines (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expense_id    uuid NOT NULL,
  position      integer NOT NULL,
  description   text NOT NULL,
  quantity      numeric(12, 3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  amount_cents  bigint NOT NULL CHECK (amount_cents >= 0),
  FOREIGN KEY (tenant_id, expense_id) REFERENCES expenses_expenses(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX expenses_lines_expense_idx ON expenses_lines (tenant_id, expense_id, position);

-- What happened to an expense, in order (status changes with comments, edits).
CREATE TABLE expenses_history (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expense_id  uuid NOT NULL,
  action      text NOT NULL CHECK (action IN ('created', 'edited', 'submitted', 'approved', 'rejected', 'paid')),
  actor_id    uuid,
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, expense_id) REFERENCES expenses_expenses(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX expenses_history_expense_idx ON expenses_history (tenant_id, expense_id, created_at);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['expenses_files','expenses_expenses','expenses_lines','expenses_history'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON expenses_files, expenses_expenses, expenses_lines, expenses_history TO office_app;
