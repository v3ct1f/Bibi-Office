-- Work email chosen during sign-up: how many work mailboxes, and the company domain the owner would like.
-- The domain is only a wish here; it is bought after the owner has created their business.
ALTER TABLE owner_signups ADD COLUMN workmail_mailboxes integer CHECK (workmail_mailboxes IS NULL OR workmail_mailboxes BETWEEN 1 AND 500);
ALTER TABLE owner_signups ADD COLUMN workmail_domain text CHECK (workmail_domain IS NULL OR length(workmail_domain) <= 253);
