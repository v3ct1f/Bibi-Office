-- Session 3: workflows, webhooks, event consumption dedupe, module settings secrets.

-- At-least-once delivery from NATS => consumers dedupe here.
CREATE TABLE event_consumptions (
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id     uuid NOT NULL,
  consumer     text NOT NULL,                -- "module:<key>", "workflows", "webhooks"
  consumed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, event_id, consumer)
);

ALTER TABLE tenant_modules ADD COLUMN secrets bytea;   -- AES-256-GCM sealed JSON of x-secret settings

CREATE TABLE workflows (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  enabled     boolean NOT NULL DEFAULT true,
  trigger     jsonb NOT NULL,             -- {"event": "core.contact.created"}
  conditions  jsonb,                      -- JSONLogic over {event, payload}
  actions     jsonb NOT NULL,             -- [{"key": "core.create_task", "input": {...}}]
  version     int NOT NULL DEFAULT 1,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  trigger_event text GENERATED ALWAYS AS (trigger->>'event') STORED,
  UNIQUE (tenant_id, id),
  CHECK (jsonb_typeof(actions) = 'array' AND jsonb_array_length(actions) BETWEEN 1 AND 50)
);
CREATE INDEX workflows_trigger_idx ON workflows (tenant_id, trigger_event) WHERE enabled AND deleted_at IS NULL;

CREATE TABLE workflow_runs (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL,
  workflow_id     uuid NOT NULL,
  workflow_version int NOT NULL,
  event_id        uuid NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','running','succeeded','failed','skipped','cancelled')),
  plan            jsonb NOT NULL,                -- snapshot: {event, actions} so edits don't affect running runs
  steps           jsonb NOT NULL DEFAULT '[]',   -- [{key, status, output|error, at}]
  error           text,
  engine_run_id   text,                          -- Temporal run id when using Temporal
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  UNIQUE (workflow_id, event_id),                -- idempotent per event
  FOREIGN KEY (tenant_id, workflow_id) REFERENCES workflows(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX workflow_runs_wf_idx ON workflow_runs (tenant_id, workflow_id, id DESC);

CREATE TABLE webhook_endpoints (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  url         text NOT NULL CHECK (url ~ '^https?://'),
  description text,
  secret_enc  bytea NOT NULL,                -- AES-256-GCM sealed signing secret
  events      text[] NOT NULL CHECK (cardinality(events) BETWEEN 1 AND 100),
  active      boolean NOT NULL DEFAULT true,
  failure_streak int NOT NULL DEFAULT 0,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE webhook_deliveries (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL,
  endpoint_id   uuid NOT NULL,
  event_id      uuid NOT NULL,
  event_type    text NOT NULL,
  body          jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed')),
  attempts      int NOT NULL DEFAULT 0,
  status_code   int,
  last_error    text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (endpoint_id, event_id),
  FOREIGN KEY (tenant_id, endpoint_id) REFERENCES webhook_endpoints(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX webhook_deliveries_due_idx ON webhook_deliveries (next_attempt_at) WHERE status = 'pending';

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['workflows','webhook_endpoints'] LOOP
    EXECUTE format('CREATE TRIGGER %I_updated BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['event_consumptions','workflows','workflow_runs','webhook_endpoints','webhook_deliveries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON event_consumptions TO office_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON workflows, workflow_runs, webhook_endpoints TO office_app;
GRANT SELECT, INSERT, UPDATE ON webhook_deliveries TO office_app;

-- Delivery worker claims due deliveries across tenants (BYPASSRLS role, narrow grants).
GRANT SELECT, UPDATE (status, attempts, status_code, last_error, next_attempt_at, delivered_at) ON webhook_deliveries TO office_relay;
GRANT SELECT, UPDATE (failure_streak, active) ON webhook_endpoints TO office_relay;
GRANT SELECT (id, tenant_id, status, started_at) ON workflow_runs TO office_relay;  -- stale-run sweep

-- Verifies a module's tables (prefix <key>_) are tenant-isolated. Returns offending table names.
CREATE FUNCTION module_tables_missing_rls(prefix text) RETURNS SETOF text LANGUAGE sql STABLE AS $$
  SELECT c.relname::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE prefix || '\_%'
    AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity
         OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
         OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped))
$$;
