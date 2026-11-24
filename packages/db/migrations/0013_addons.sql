-- Paid extras a business has turned on (e.g. "workmail"), so we know what to bill and what to stop billing.
ALTER TABLE tenants ADD COLUMN addons text[] NOT NULL DEFAULT '{}';
