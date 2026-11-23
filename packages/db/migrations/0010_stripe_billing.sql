-- Paid sign-up: a business that came from a Stripe subscription remembers which one, so a cancelled or
-- unpaid subscription pauses it, a repeated webhook never creates it twice, and the subscription id is unique.
ALTER TABLE tenants ADD COLUMN stripe_customer_id text;
ALTER TABLE tenants ADD COLUMN stripe_subscription_id text;
CREATE UNIQUE INDEX tenants_stripe_subscription_idx ON tenants (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
