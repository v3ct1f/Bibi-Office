-- Subscription plans (Starter / Business / Complete). tenants.plan already exists: it now holds the plan key.
-- Older businesses keep "free" / "paid" and have no limits.
ALTER TABLE tenants ADD COLUMN plan_interval text NOT NULL DEFAULT 'monthly' CHECK (plan_interval IN ('monthly', 'yearly'));
-- true while payment is only a pretend one (test mode): nothing was charged. Cleared when real payment takes over.
ALTER TABLE tenants ADD COLUMN plan_test boolean NOT NULL DEFAULT false;
ALTER TABLE tenants ADD COLUMN plan_changed_at timestamptz;
