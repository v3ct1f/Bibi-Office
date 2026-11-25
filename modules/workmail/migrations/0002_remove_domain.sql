-- Removing a domain: its mailboxes are switched off (mail kept, no longer billed) with the reason "domain_removed",
-- and the domain keeps when it was removed. A bought domain stays registered to the business until it expires (not renewed).
ALTER TABLE workmail_mailboxes DROP CONSTRAINT IF EXISTS workmail_mailboxes_suspend_reason_check;
ALTER TABLE workmail_mailboxes ADD CONSTRAINT workmail_mailboxes_suspend_reason_check
  CHECK (suspend_reason IS NULL OR suspend_reason IN ('colleague_removed', 'feature_off', 'by_hand', 'domain_removed'));
ALTER TABLE workmail_domains ADD COLUMN removed_at timestamptz;
