-- A business paused because a payment failed (as opposed to paused by hand by the program owner). Paying
-- resumes only a business paused for billing reasons, and a manual pause is never undone by a payment.
ALTER TABLE tenants ADD COLUMN billing_paused_at timestamptz;
