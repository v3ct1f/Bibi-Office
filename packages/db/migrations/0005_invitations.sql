-- Invitations: people join a company only by accepting an invitation sent to their own email address.
-- The link carries a random token; only its SHA-256 hash is stored.
CREATE TABLE invitations (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email        text NOT NULL CHECK (email = lower(email)),
  roles        text[] NOT NULL DEFAULT '{}',
  token_hash   bytea NOT NULL UNIQUE,
  invited_by   uuid REFERENCES users(id),
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  accepted_by  uuid REFERENCES users(id),
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitations_tenant_idx ON invitations (tenant_id, created_at DESC);
-- At most one open invitation per person and company.
CREATE UNIQUE INDEX invitations_open_idx ON invitations (tenant_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invitations USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE ON invitations TO office_app;
