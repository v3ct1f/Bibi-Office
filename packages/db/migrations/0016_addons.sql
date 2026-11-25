-- Paid extras a business has turned on (e.g. "workmail"), so we know what to bill and what to stop billing.
-- (Was 0013_addons.sql on its own branch; renumbered when merged. IF NOT EXISTS keeps databases that already ran it working.)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS addons text[] NOT NULL DEFAULT '{}';
