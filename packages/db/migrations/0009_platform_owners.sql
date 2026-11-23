-- Program owners (the people who run this Office installation), managed in the app.
-- Global, not per business, so no tenant_id and no RLS (like users).
-- On first start the table is filled from PLATFORM_ADMIN_EMAILS; after that it is managed from Program admin.
CREATE TABLE platform_admins (
  id         uuid PRIMARY KEY,
  email      text NOT NULL UNIQUE CHECK (email = lower(email)),
  added_by   text NOT NULL,              -- email of the owner who added them, or 'config'
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only history of program-owner changes (who added, removed or transferred).
CREATE TABLE platform_audit (
  id         uuid PRIMARY KEY,
  actor      text NOT NULL,
  action     text NOT NULL,
  detail     jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON platform_admins TO office_app;
GRANT SELECT, INSERT ON platform_audit TO office_app;
