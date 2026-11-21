-- The program owner creates businesses and invites their first owner. Such invitations come from the
-- platform, not from a member, so accepting them doesn't depend on an inviter's permissions.
ALTER TABLE invitations ADD COLUMN by_platform boolean NOT NULL DEFAULT false;
