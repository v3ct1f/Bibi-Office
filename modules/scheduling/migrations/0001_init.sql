-- Scheduling v1: services offered by team members (hosts), weekly availability, time off, bookings.
-- Double-booking is impossible: an exclusion constraint on (host, blocked time range) for confirmed bookings.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE scheduling_services (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug          text NOT NULL CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$'),
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description   text CHECK (length(description) <= 2000),
  duration_min  int NOT NULL CHECK (duration_min BETWEEN 5 AND 720),
  buffer_min    int NOT NULL DEFAULT 0 CHECK (buffer_min BETWEEN 0 AND 240),   -- kept free after each booking
  location      text CHECK (length(location) <= 300),
  is_public     boolean NOT NULL DEFAULT true,
  active        boolean NOT NULL DEFAULT true,
  position      int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, slug)
);

CREATE TABLE scheduling_service_hosts (
  tenant_id   uuid NOT NULL,
  service_id  uuid NOT NULL,
  host_id     uuid NOT NULL,
  PRIMARY KEY (tenant_id, service_id, host_id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES scheduling_services(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, host_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE
);

-- Weekly hours per host, in the module's time zone (setting). weekday: 1 = Monday ... 7 = Sunday.
CREATE TABLE scheduling_hours (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  host_id     uuid NOT NULL,
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_min   int NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min     int NOT NULL CHECK (end_min BETWEEN 1 AND 1440),
  CHECK (end_min > start_min),
  FOREIGN KEY (tenant_id, host_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE
);
CREATE INDEX scheduling_hours_host ON scheduling_hours (tenant_id, host_id, weekday);

CREATE TABLE scheduling_time_off (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  host_id     uuid NOT NULL,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  reason      text CHECK (length(reason) <= 200),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  FOREIGN KEY (tenant_id, host_id) REFERENCES memberships(tenant_id, user_id) ON DELETE CASCADE
);
CREATE INDEX scheduling_time_off_host ON scheduling_time_off (tenant_id, host_id, starts_at);

CREATE TABLE scheduling_bookings (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_id      uuid NOT NULL,
  host_id         uuid NOT NULL,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  blocked         tstzrange NOT NULL,                     -- [starts_at, ends_at + buffer)
  status          text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no_show')),
  source          text NOT NULL CHECK (source IN ('internal', 'public')),
  customer_name   text NOT NULL CHECK (length(customer_name) BETWEEN 1 AND 200),
  customer_email  text CHECK (length(customer_email) <= 320),
  customer_phone  text CHECK (length(customer_phone) <= 50),
  notes           text CHECK (length(notes) <= 2000),
  contact_id      uuid,
  manage_token    bytea,                                  -- sha256 of the customer's manage-link token
  cancelled_at    timestamptz,
  cancelled_by    text,
  cancel_reason   text CHECK (length(cancel_reason) <= 500),
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (ends_at > starts_at),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, service_id) REFERENCES scheduling_services(tenant_id, id),
  FOREIGN KEY (tenant_id, host_id) REFERENCES memberships(tenant_id, user_id),
  FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts(tenant_id, id) ON DELETE SET NULL (contact_id),
  EXCLUDE USING gist (tenant_id WITH =, host_id WITH =, blocked WITH &&) WHERE (status <> 'cancelled')
);
CREATE INDEX scheduling_bookings_time ON scheduling_bookings (tenant_id, starts_at);
CREATE INDEX scheduling_bookings_contact ON scheduling_bookings (tenant_id, contact_id);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['scheduling_services', 'scheduling_service_hosts', 'scheduling_hours', 'scheduling_time_off', 'scheduling_bookings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO office_app', t);
  END LOOP;
END $$;
