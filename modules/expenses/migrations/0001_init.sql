-- Expenses v1: categories + expense claims (one receipt each) with an approval flow.
-- Money = bigint minor units. Receipts are module-private documents (documents.module = 'expenses').

CREATE TABLE expenses_categories (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  code        text CHECK (length(code) <= 40),            -- ledger / GL account for exports
  position    int NOT NULL DEFAULT 0,
  archived    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX expenses_categories_name ON expenses_categories (tenant_id, lower(name));

CREATE TABLE expenses_expenses (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  submitter_id    uuid NOT NULL,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'reimbursed')),
  spent_on        date NOT NULL,
  merchant        text NOT NULL CHECK (length(merchant) BETWEEN 1 AND 200),
  category_id     uuid,
  amount          bigint NOT NULL CHECK (amount >= 0 AND amount <= 1000000000000),
  tax             bigint NOT NULL DEFAULT 0 CHECK (tax >= 0 AND tax <= amount),
  currency        char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  description     text CHECK (length(description) <= 2000),
  receipt_id      uuid,
  receipt_name    text CHECK (length(receipt_name) <= 255),
  receipt_mime    text,
  submitted_at    timestamptz,
  decided_by      text,                                     -- actor id (user, api key or workflow)
  decided_at      timestamptz,
  decision_note   text CHECK (length(decision_note) <= 1000),
  reimbursed_at   timestamptz,
  reimbursed_by   text,
  reimbursement_ref text CHECK (length(reimbursement_ref) <= 200),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, submitter_id) REFERENCES memberships(tenant_id, user_id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES expenses_categories(tenant_id, id),
  FOREIGN KEY (tenant_id, receipt_id) REFERENCES documents(tenant_id, id),
  CHECK (status = 'draft' OR submitted_at IS NOT NULL),
  CHECK (status NOT IN ('approved', 'rejected', 'reimbursed') OR decided_at IS NOT NULL),
  CHECK ((status = 'reimbursed') = (reimbursed_at IS NOT NULL))
);
CREATE INDEX expenses_list ON expenses_expenses (tenant_id, id DESC);
CREATE INDEX expenses_mine ON expenses_expenses (tenant_id, submitter_id, id DESC);
CREATE INDEX expenses_queue ON expenses_expenses (tenant_id, status) WHERE status IN ('submitted', 'approved');

-- Decided expenses are a record: only status moves forward (approved -> reimbursed) and nothing else changes.
CREATE FUNCTION expenses_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('approved', 'reimbursed') AND (
    NEW.amount, NEW.tax, NEW.currency, NEW.spent_on, NEW.merchant, NEW.category_id, NEW.receipt_id, NEW.submitter_id, NEW.description
  ) IS DISTINCT FROM (
    OLD.amount, OLD.tax, OLD.currency, OLD.spent_on, OLD.merchant, OLD.category_id, OLD.receipt_id, OLD.submitter_id, OLD.description
  ) THEN
    RAISE EXCEPTION 'expense % is %, it cannot be edited', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'reimbursed' AND NEW.status <> 'reimbursed' THEN
    RAISE EXCEPTION 'expense % is reimbursed', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER expenses_guard_bu BEFORE UPDATE ON expenses_expenses FOR EACH ROW EXECUTE FUNCTION expenses_guard();

CREATE FUNCTION expenses_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status NOT IN ('draft', 'rejected') THEN
    RAISE EXCEPTION 'expense % is %, it cannot be deleted', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER expenses_no_delete_bd BEFORE DELETE ON expenses_expenses FOR EACH ROW EXECUTE FUNCTION expenses_no_delete();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['expenses_categories', 'expenses_expenses'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO office_app', t);
  END LOOP;
END $$;
