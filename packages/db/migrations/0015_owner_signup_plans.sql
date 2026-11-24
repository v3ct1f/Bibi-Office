-- A sign-up remembers the plan the customer chose, so the business they create starts on it.
-- 'demo': a pretend payment on the demo checkout page (local / try-out only, nothing charged).
ALTER TABLE owner_signups ADD COLUMN plan text;
ALTER TABLE owner_signups ADD COLUMN plan_interval text CHECK (plan_interval IN ('monthly', 'yearly'));
ALTER TABLE owner_signups ADD COLUMN plan_test boolean NOT NULL DEFAULT false;
ALTER TABLE owner_signups DROP CONSTRAINT owner_signups_source_check;
ALTER TABLE owner_signups ADD CONSTRAINT owner_signups_source_check CHECK (source IN ('stripe', 'program_owner', 'demo'));
