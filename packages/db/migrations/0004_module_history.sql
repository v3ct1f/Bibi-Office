-- Feature modules: remember who turned a module off and when (enabled_at/enabled_by already exist).
-- Data of a disabled module is never deleted; re-enabling restores access to it.
ALTER TABLE tenant_modules ADD COLUMN disabled_at timestamptz;
ALTER TABLE tenant_modules ADD COLUMN disabled_by uuid;
