-- HR v1: employee records (optionally linked to a member), managers, leave types, company holidays,
-- leave requests with approval, and employee documents (module-private core documents).

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE hr_employees (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id           uuid,                                   -- linked member account (optional)
  first_name        text NOT NULL CHECK (length(first_name) BETWEEN 1 AND 100),
  last_name         text NOT NULL DEFAULT '' CHECK (length(last_name) <= 100),
  work_email        text CHECK (length(work_email) <= 320),
  job_title         text CHECK (length(job_title) <= 120),
  department        text CHECK (length(department) <= 120),
  manager_id        uuid,
  employment_type   text NOT NULL DEFAULT 'full_time' CHECK (employment_type IN ('full_time', 'part_time', 'contractor', 'intern')),
  start_date        date NOT NULL,
  end_date          date,
  annual_allowance  numeric(5,1) CHECK (annual_allowance BETWEEN 0 AND 365),   -- null = module default
  -- private (hr:employees.manage or the employee themself)
  birth_date        date,
  phone             text CHECK (length(phone) <= 50),
  address           text CHECK (length(address) <= 500),
  emergency_contact text CHECK (length(emergency_contact) <= 300),
  notes             text CHECK (length(notes) <= 5000),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT hr_employees_dates CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK (manager_id IS NULL OR manager_id <> id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE SET NULL (user_id),
  FOREIGN KEY (tenant_id, manager_id) REFERENCES hr_employees(tenant_id, id) ON DELETE SET NULL (manager_id)
);
CREATE UNIQUE INDEX hr_employees_user ON hr_employees (tenant_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX hr_employees_email ON hr_employees (tenant_id, lower(work_email)) WHERE work_email IS NOT NULL;
CREATE INDEX hr_employees_manager ON hr_employees (tenant_id, manager_id);
CREATE INDEX hr_employees_name ON hr_employees (tenant_id, lower(last_name), lower(first_name));

-- No management loops (A manages B manages A).
CREATE FUNCTION hr_no_manager_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.manager_id IS NOT NULL AND EXISTS (
    WITH RECURSIVE up(id, depth) AS (
      SELECT NEW.manager_id, 1
      UNION ALL
      SELECT e.manager_id, up.depth + 1 FROM hr_employees e JOIN up ON e.id = up.id
      WHERE e.tenant_id = NEW.tenant_id AND e.manager_id IS NOT NULL AND up.depth < 100
    ) SELECT 1 FROM up WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'manager loop' USING ERRCODE = 'check_violation', CONSTRAINT = 'hr_manager_cycle';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hr_no_manager_cycle_biu BEFORE INSERT OR UPDATE OF manager_id ON hr_employees FOR EACH ROW EXECUTE FUNCTION hr_no_manager_cycle();

CREATE TABLE hr_leave_types (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  uses_allowance boolean NOT NULL DEFAULT true,           -- counts against the yearly allowance
  needs_approval boolean NOT NULL DEFAULT true,
  paid          boolean NOT NULL DEFAULT true,
  position      int NOT NULL DEFAULT 0,
  archived      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX hr_leave_types_name ON hr_leave_types (tenant_id, lower(name));

CREATE TABLE hr_holidays (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  day        date NOT NULL,
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  UNIQUE (tenant_id, day)
);

CREATE TABLE hr_leave_requests (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id    uuid NOT NULL,
  type_id        uuid NOT NULL,
  start_date     date NOT NULL,
  end_date       date NOT NULL,
  half_day       boolean NOT NULL DEFAULT false,           -- only for single-day requests
  days           numeric(5,1) NOT NULL CHECK (days > 0),   -- working days, computed at request time
  status         text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'rejected', 'cancelled')),
  note           text CHECK (length(note) <= 1000),
  requested_by   text NOT NULL,
  decided_by     text,
  decided_at     timestamptz,
  decision_note  text CHECK (length(decision_note) <= 1000),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (end_date >= start_date),
  CHECK (extract(year FROM start_date) = extract(year FROM end_date)),
  CHECK (NOT half_day OR start_date = end_date),
  CHECK ((status IN ('approved', 'rejected')) = (decided_at IS NOT NULL) OR status = 'cancelled'),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES hr_employees(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, type_id) REFERENCES hr_leave_types(tenant_id, id),
  -- one live request per employee per day
  EXCLUDE USING gist (tenant_id WITH =, employee_id WITH =, daterange(start_date, end_date, '[]') WITH &&) WHERE (status IN ('requested', 'approved'))
);
CREATE INDEX hr_leave_dates ON hr_leave_requests (tenant_id, start_date, end_date) WHERE status IN ('requested', 'approved');
CREATE INDEX hr_leave_employee ON hr_leave_requests (tenant_id, employee_id, start_date DESC);

-- Decided requests are a record: dates, type and days never change; status only moves to cancelled.
CREATE FUNCTION hr_leave_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.employee_id, NEW.type_id, NEW.start_date, NEW.end_date, NEW.half_day, NEW.days, NEW.requested_by)
     IS DISTINCT FROM (OLD.employee_id, OLD.type_id, OLD.start_date, OLD.end_date, OLD.half_day, OLD.days, OLD.requested_by) THEN
    RAISE EXCEPTION 'leave requests cannot be edited; cancel and request again' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('rejected', 'cancelled') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'leave request is %', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER hr_leave_guard_bu BEFORE UPDATE ON hr_leave_requests FOR EACH ROW EXECUTE FUNCTION hr_leave_guard();

CREATE TABLE hr_documents (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL,
  document_id  uuid NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('contract', 'identity', 'certificate', 'review', 'other')),
  title        text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  uploaded_by  text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES hr_employees(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, document_id) REFERENCES documents(tenant_id, id)
);
CREATE INDEX hr_documents_employee ON hr_documents (tenant_id, employee_id, created_at DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['hr_employees', 'hr_leave_types', 'hr_holidays', 'hr_leave_requests', 'hr_documents'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON hr_employees, hr_leave_types, hr_leave_requests TO office_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_holidays, hr_documents TO office_app;
