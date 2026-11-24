-- Owners who may set up their own business: someone who paid for a subscription (Stripe), or someone the
-- program owner invited by hand. They create their sign-in account from the emailed link, sign in with that
-- email address and then create the business themselves (name, web address, region) and become its owner.
-- Global, not per business (the business doesn't exist yet), so no tenant_id column and no RLS, like users.
CREATE TABLE owner_signups (
  id                     uuid PRIMARY KEY,
  email                  text NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 320),
  source                 text NOT NULL CHECK (source IN ('stripe','program_owner')),
  created_by             text NOT NULL,                 -- 'stripe' or the program owner's email
  stripe_customer_id     text,
  stripe_subscription_id text UNIQUE,                   -- a repeated webhook never makes a second one
  terms_version          text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  -- Set when the owner created their business with it (it can be used once).
  used_at                timestamptz,
  tenant_id              uuid REFERENCES tenants(id) ON DELETE CASCADE,
  -- The subscription ended (cancelled / unpaid) before a business was created: it can't be used then.
  ended_at               timestamptz,
  -- The program owner withdrew an invitation that hadn't been used.
  cancelled_at           timestamptz
);
CREATE INDEX owner_signups_open_idx ON owner_signups (email) WHERE used_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON owner_signups TO office_app;
