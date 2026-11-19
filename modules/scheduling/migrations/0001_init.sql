-- Staff scheduling v1: positions, shifts (wall-clock times on a local date), time off, shift swaps and a time clock.
-- Shifts are planned in local time (date + start/end; end <= start means overnight). Clock entries are real instants;
-- week boundaries and local dates for them use the module setting "timezone".

CREATE TABLE scheduling_positions (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  color       text NOT NULL DEFAULT 'blue' CHECK (color IN ('blue','green','orange','purple','pink','teal','red','gray')),
  archived    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX scheduling_positions_name_idx ON scheduling_positions (tenant_id, lower(name)) WHERE NOT archived;

CREATE TABLE scheduling_shifts (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id    uuid NOT NULL,
  position_id    uuid,
  day            date NOT NULL,
  start_time     time NOT NULL,
  end_time       time NOT NULL CHECK (end_time <> start_time),
  break_minutes  integer NOT NULL DEFAULT 0 CHECK (break_minutes BETWEEN 0 AND 600),
  notes          text,
  published_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, position_id) REFERENCES scheduling_positions(tenant_id, id) ON DELETE SET NULL (position_id)
);
CREATE INDEX scheduling_shifts_day_idx ON scheduling_shifts (tenant_id, day);
CREATE INDEX scheduling_shifts_employee_idx ON scheduling_shifts (tenant_id, employee_id, day);

CREATE TABLE scheduling_time_off (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id       uuid NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('vacation','sick','personal','other')),
  start_date        date NOT NULL,
  end_date          date NOT NULL,
  reason            text,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by        uuid,
  decided_at        timestamptz,
  decision_comment  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (end_date >= start_date)
);
CREATE INDEX scheduling_time_off_idx ON scheduling_time_off (tenant_id, employee_id, start_date);

-- A swap offers one shift to a colleague, optionally in exchange for one of theirs.
-- pending (colleague decides) -> accepted (manager decides) -> approved | rejected; or declined / cancelled.
CREATE TABLE scheduling_swaps (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shift_id          uuid NOT NULL,
  from_employee_id  uuid NOT NULL,
  to_employee_id    uuid NOT NULL CHECK (to_employee_id <> from_employee_id),
  target_shift_id   uuid,
  message           text,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','approved','rejected','cancelled')),
  decided_by        uuid,
  decided_at        timestamptz,
  decision_comment  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, shift_id) REFERENCES scheduling_shifts(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, target_shift_id) REFERENCES scheduling_shifts(tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX scheduling_swaps_open_idx ON scheduling_swaps (tenant_id, shift_id) WHERE status IN ('pending','accepted');

CREATE TABLE scheduling_clock_entries (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL,
  shift_id     uuid,
  clock_in     timestamptz NOT NULL,
  clock_out    timestamptz,
  note         text,
  source       text NOT NULL DEFAULT 'clock' CHECK (source IN ('clock','manual')),
  edited_by    uuid,
  edited_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (clock_out IS NULL OR (clock_out > clock_in AND clock_out <= clock_in + interval '24 hours')),
  FOREIGN KEY (tenant_id, shift_id) REFERENCES scheduling_shifts(tenant_id, id) ON DELETE SET NULL (shift_id)
);
-- At most one open (clocked-in) entry per person.
CREATE UNIQUE INDEX scheduling_clock_open_idx ON scheduling_clock_entries (tenant_id, employee_id) WHERE clock_out IS NULL;
CREATE INDEX scheduling_clock_entries_idx ON scheduling_clock_entries (tenant_id, clock_in);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['scheduling_positions','scheduling_shifts','scheduling_time_off','scheduling_swaps','scheduling_clock_entries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduling_positions, scheduling_shifts, scheduling_time_off, scheduling_swaps, scheduling_clock_entries TO office_app;
