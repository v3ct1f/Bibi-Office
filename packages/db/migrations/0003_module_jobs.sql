-- Scheduled per-tenant module jobs (SDK `jobs`). The worker (office_relay) seeds and claims rows;
-- each run itself happens as office_app inside the tenant (RLS).
CREATE TABLE module_jobs (
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module_key    text NOT NULL,
  job           text NOT NULL,
  next_run_at   timestamptz NOT NULL DEFAULT now(),
  running_until timestamptz,                 -- lease; expired lease => claimable again
  last_run_at   timestamptz,
  last_error    text,
  PRIMARY KEY (tenant_id, module_key, job)
);
CREATE INDEX module_jobs_due ON module_jobs (next_run_at);
ALTER TABLE module_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE module_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON module_jobs USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT ON module_jobs TO office_app;
GRANT SELECT, INSERT, UPDATE ON module_jobs TO office_relay;
GRANT SELECT (tenant_id, module_key, enabled) ON tenant_modules TO office_relay;
