CREATE TABLE sample_notes (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL,
  text        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts(tenant_id, id)
);
ALTER TABLE sample_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sample_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sample_notes USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON sample_notes TO office_app;
