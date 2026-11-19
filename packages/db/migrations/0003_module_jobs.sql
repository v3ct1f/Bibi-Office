-- Scheduled module jobs (SDK `jobs`): one row per (tenant, module, job) holding when it runs next.
-- The worker (office_relay, BYPASSRLS) seeds rows for tenants with the module enabled, claims due rows
-- with SKIP LOCKED, then runs each job in a normal tenant transaction as office_app.
CREATE TABLE module_job_state (
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module_key       text NOT NULL,
  job_key          text NOT NULL,
  next_run_at      timestamptz NOT NULL DEFAULT now(),
  last_started_at  timestamptz,
  last_finished_at timestamptz,
  last_error       text,
  PRIMARY KEY (tenant_id, module_key, job_key)
);
CREATE INDEX module_job_state_due_idx ON module_job_state (next_run_at);

ALTER TABLE module_job_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE module_job_state FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON module_job_state USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT ON module_job_state TO office_app;
GRANT SELECT, INSERT, UPDATE (next_run_at, last_started_at, last_finished_at, last_error) ON module_job_state TO office_relay;
GRANT SELECT (tenant_id, module_key, enabled) ON tenant_modules TO office_relay;
