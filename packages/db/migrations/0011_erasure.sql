-- Permanent erasure of a business and everything in it.
--  * A business deleted by the program owner is erased 30 days later (a grace period for mistakes), or at once
--    when the program owner asks for it (a privacy request).
--  * A business whose paid subscription ended (cancelled or unpaid) is erased 90 days after it ended (the Terms).
-- Only this function may do it: the app role has no DELETE on tenants, and the function refuses any business
-- that isn't due. Everything else (contacts, invoices, files, audit rows, ...) goes through ON DELETE CASCADE.
ALTER TABLE tenants ADD COLUMN deleted_at timestamptz;
ALTER TABLE tenants ADD COLUMN subscription_ended_at timestamptz;
UPDATE tenants SET deleted_at = updated_at WHERE status = 'deleted';

-- What was erased and why, without any of its content (kept to show the erasure happened).
CREATE TABLE erasure_log (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL,          -- no foreign key: the business is gone
  reason        text NOT NULL CHECK (reason IN ('deleted', 'requested', 'subscription_ended')),
  users_erased  integer NOT NULL,
  erased_at     timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON erasure_log TO office_app;

-- Returns the sign-in subjects of people whose accounts were erased too (people who belonged to no other
-- business), so the sign-in service can delete them as well.
CREATE FUNCTION erase_tenant(p_id uuid, p_now boolean DEFAULT false) RETURNS TABLE (idp_subject text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t tenants;
  why text;
  uids uuid[];
  uid uuid;
  sub text;
  n integer := 0;
BEGIN
  PERFORM set_config('app.tenant_id', p_id::text, true);
  SELECT * INTO t FROM tenants WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF t.status = 'deleted' AND p_now THEN why := 'requested';
  ELSIF t.status = 'deleted' AND t.deleted_at IS NOT NULL AND t.deleted_at <= now() - interval '30 days' THEN why := 'deleted';
  ELSIF t.status <> 'active' AND t.subscription_ended_at IS NOT NULL AND t.subscription_ended_at <= now() - interval '90 days' THEN why := 'subscription_ended';
  ELSE RAISE EXCEPTION 'business % is not due for erasure', p_id USING ERRCODE = 'check_violation';
  END IF;

  SELECT coalesce(array_agg(DISTINCT user_id), '{}') INTO uids FROM memberships WHERE tenant_id = p_id;
  DELETE FROM tenants WHERE id = p_id;   -- cascades to every table that holds the business's data

  FOREACH uid IN ARRAY uids LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM memberships WHERE user_id = uid);
    CONTINUE WHEN EXISTS (SELECT 1 FROM users u JOIN platform_admins a ON a.email = lower(u.email) WHERE u.id = uid);
    BEGIN
      DELETE FROM users WHERE id = uid RETURNING users.idp_subject INTO sub;
      IF sub IS NOT NULL THEN n := n + 1; idp_subject := sub; RETURN NEXT; END IF;
    EXCEPTION WHEN foreign_key_violation THEN
      NULL;  -- still referenced from another business's records: keep the person
    END;
  END LOOP;

  INSERT INTO erasure_log (id, tenant_id, reason, users_erased) VALUES (gen_random_uuid(), p_id, why, n);
END $$;

REVOKE ALL ON FUNCTION erase_tenant(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erase_tenant(uuid, boolean) TO office_app;
