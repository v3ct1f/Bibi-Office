-- HR: employee profiles, pay history, leave allowances and ledger, documents, checklists.
-- Employees are workspace members (user_id); a profile row is created on first edit.

CREATE TABLE hr_employees (
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL,
  job_title         text CHECK (char_length(job_title) <= 120),
  department        text CHECK (char_length(department) <= 80),
  manager_id        uuid,
  employment_type   text CHECK (employment_type IN ('full_time','part_time','temporary','freelance','intern')),
  weekly_hours      numeric(5,2) CHECK (weekly_hours >= 0 AND weekly_hours <= 168),
  start_date        date,
  end_date          date,
  work_phone        text CHECK (char_length(work_phone) <= 40),
  -- Private: visible to HR managers and the person themself.
  birth_date        date,
  personal_email    text CHECK (char_length(personal_email) <= 320),
  personal_phone    text CHECK (char_length(personal_phone) <= 40),
  address           text CHECK (char_length(address) <= 500),
  emergency_name    text CHECK (char_length(emergency_name) <= 200),
  emergency_relation text CHECK (char_length(emergency_relation) <= 80),
  emergency_phone   text CHECK (char_length(emergency_phone) <= 40),
  notes             text CHECK (char_length(notes) <= 5000),
  allowance_days    numeric(5,1) CHECK (allowance_days >= 0 AND allowance_days <= 366),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id),
  CHECK (manager_id IS NULL OR manager_id <> user_id),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

-- Pay history: the current rate is the latest effective_from on or before today.
CREATE TABLE hr_pay (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL,
  effective_from  date NOT NULL,
  basis           text NOT NULL CHECK (basis IN ('hourly','monthly','yearly')),
  amount_cents    bigint NOT NULL CHECK (amount_cents > 0 AND amount_cents < 100000000000),
  currency        text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  note            text CHECK (char_length(note) <= 500),
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, effective_from)
);

-- Leave ledger per person and year. Entries from approved Schedule time off carry its id (ref_id).
CREATE TABLE hr_leave (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL,
  year         integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  kind         text NOT NULL CHECK (kind IN ('vacation','sick','personal','other','adjustment','carry_over')),
  days         numeric(5,1) NOT NULL CHECK (days <> 0 AND days BETWEEN -366 AND 366),
  start_date   date,
  end_date     date,
  source       text NOT NULL CHECK (source IN ('schedule','manual')),
  ref_id       uuid,
  note         text CHECK (char_length(note) <= 500),
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hr_leave_idx ON hr_leave (tenant_id, user_id, year);
CREATE UNIQUE INDEX hr_leave_ref_idx ON hr_leave (tenant_id, ref_id, year) WHERE ref_id IS NOT NULL;

CREATE TABLE hr_documents (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  category      text NOT NULL CHECK (category IN ('contract','id','certificate','other')),
  content_type  text NOT NULL,
  size_bytes    integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  data          bytea NOT NULL,
  expires_on    date,
  reminded_at   timestamptz,
  uploaded_by   uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hr_documents_idx ON hr_documents (tenant_id, user_id);
CREATE INDEX hr_documents_expiry_idx ON hr_documents (tenant_id, expires_on) WHERE expires_on IS NOT NULL;

CREATE TABLE hr_templates (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  kind        text NOT NULL CHECK (kind IN ('onboarding','offboarding','other')),
  -- [{ title, owner: "employee"|"manager"|"hr", dueDays }]
  items       jsonb NOT NULL DEFAULT '[]',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX hr_templates_name_idx ON hr_templates (tenant_id, lower(name));

CREATE TABLE hr_checklists (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  kind        text NOT NULL CHECK (kind IN ('onboarding','offboarding','other')),
  start_date  date NOT NULL,
  completed_at timestamptz,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX hr_checklists_idx ON hr_checklists (tenant_id, user_id);

CREATE TABLE hr_tasks (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  checklist_id  uuid NOT NULL,
  position      integer NOT NULL,
  title         text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  owner_id      uuid,
  due_date      date,
  done_at       timestamptz,
  done_by       uuid,
  FOREIGN KEY (tenant_id, checklist_id) REFERENCES hr_checklists(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX hr_tasks_idx ON hr_tasks (tenant_id, checklist_id, position);
CREATE INDEX hr_tasks_owner_idx ON hr_tasks (tenant_id, owner_id) WHERE done_at IS NULL;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['hr_employees','hr_pay','hr_leave','hr_documents','hr_templates','hr_checklists','hr_tasks'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_employees, hr_pay, hr_leave, hr_documents, hr_templates, hr_checklists, hr_tasks TO office_app;
