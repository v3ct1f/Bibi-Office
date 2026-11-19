-- Office core schema. Source of truth for DDL + RLS. Drizzle schema (src/schema.ts) mirrors it.
-- Runs as owner role. App role (office_app) never owns tables => RLS always applies.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'office_app') THEN
    CREATE ROLE office_app NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'office_relay') THEN
    CREATE ROLE office_relay NOLOGIN BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO office_app, office_relay;

-- Current tenant from transaction-local setting (set by withTenant()).
CREATE FUNCTION app_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- ───────────── Global (no RLS; core services only, never module ctx) ─────────────
CREATE TABLE tenants (
  id          uuid PRIMARY KEY,
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  plan        text NOT NULL DEFAULT 'free',
  region      text NOT NULL DEFAULT 'eu',
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  settings    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id           uuid PRIMARY KEY,
  idp_subject  text NOT NULL UNIQUE,
  email        text NOT NULL,
  name         text,
  locale       text NOT NULL DEFAULT 'en',
  tz           text NOT NULL DEFAULT 'UTC',
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

CREATE TABLE memberships (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','suspended')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE api_keys (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  hash          bytea NOT NULL,           -- HMAC-SHA256(pepper, secret)
  scopes        text[] NOT NULL DEFAULT '{}',
  created_by    uuid REFERENCES users(id),
  expires_at    timestamptz,
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_tenant_idx ON api_keys (tenant_id);

CREATE TABLE modules (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9-]{1,40}$'),
  version     text NOT NULL,
  manifest    jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ───────────── Tenant-scoped (RLS) ─────────────
CREATE TABLE roles (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key         text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_-]{1,40}$'),
  name        text NOT NULL,
  system      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key),
  UNIQUE (tenant_id, id)
);

CREATE TABLE role_permissions (
  tenant_id   uuid NOT NULL,
  role_id     uuid NOT NULL,
  permission  text NOT NULL CHECK (permission ~ '^(\*|[a-z][a-z0-9-]*:(\*|[a-z][a-z0-9_.-]*))$'),
  PRIMARY KEY (role_id, permission),
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE member_roles (
  tenant_id      uuid NOT NULL,
  membership_id  uuid NOT NULL,
  role_id        uuid NOT NULL,
  PRIMARY KEY (membership_id, role_id),
  FOREIGN KEY (tenant_id, membership_id) REFERENCES memberships(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE tenant_modules (
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module_key   text NOT NULL REFERENCES modules(key),
  enabled      boolean NOT NULL DEFAULT false,
  version      text NOT NULL,
  settings     jsonb NOT NULL DEFAULT '{}',
  enabled_at   timestamptz,
  enabled_by   uuid REFERENCES users(id),
  PRIMARY KEY (tenant_id, module_key)
);

CREATE TABLE companies (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 300),
  domain      text,
  tax_id      text,
  address     jsonb,
  custom      jsonb NOT NULL DEFAULT '{}',
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  search      tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(domain,''))) STORED,
  UNIQUE (tenant_id, id)
);
CREATE INDEX companies_tenant_idx ON companies (tenant_id, id) WHERE deleted_at IS NULL;
CREATE INDEX companies_search_idx ON companies USING gin (search);

CREATE TABLE contacts (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id  uuid,
  first_name  text,
  last_name   text,
  email       text,
  phone       text,
  custom      jsonb NOT NULL DEFAULT '{}',
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  search      tsvector GENERATED ALWAYS AS (to_tsvector('simple',
                coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' || coalesce(email,''))) STORED,
  UNIQUE (tenant_id, id),
  CHECK (coalesce(first_name, last_name, email) IS NOT NULL),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies(tenant_id, id)
);
CREATE INDEX contacts_tenant_idx ON contacts (tenant_id, id) WHERE deleted_at IS NULL;
CREATE INDEX contacts_email_idx ON contacts (tenant_id, lower(email));
CREATE INDEX contacts_search_idx ON contacts USING gin (search);

CREATE TABLE documents (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title        text NOT NULL,
  storage_key  text,                       -- set once upload confirmed
  mime         text,
  size         bigint CHECK (size >= 0),
  sha256       text,
  owner_id     uuid,
  folder       text NOT NULL DEFAULT '/',
  custom       jsonb NOT NULL DEFAULT '{}',
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  UNIQUE (tenant_id, id)
);
CREATE INDEX documents_tenant_idx ON documents (tenant_id, folder, id) WHERE deleted_at IS NULL;

CREATE TABLE tasks (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title        text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  description  text,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','cancelled')),
  priority     smallint NOT NULL DEFAULT 2 CHECK (priority BETWEEN 0 AND 4),
  due_at       timestamptz,
  assignee_id  uuid REFERENCES users(id),
  custom       jsonb NOT NULL DEFAULT '{}',
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  UNIQUE (tenant_id, id)
);
CREATE INDEX tasks_assignee_idx ON tasks (tenant_id, assignee_id, status) WHERE deleted_at IS NULL;

CREATE TABLE links (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_type   text NOT NULL,
  from_id     uuid NOT NULL,
  to_type     text NOT NULL,
  to_id       uuid NOT NULL,
  rel         text NOT NULL DEFAULT 'related',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, from_type, from_id, to_type, to_id, rel)
);
CREATE INDEX links_to_idx ON links (tenant_id, to_type, to_id);

CREATE TABLE tags (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       text NOT NULL,
  UNIQUE (tenant_id, name),
  UNIQUE (tenant_id, id)
);

CREATE TABLE taggings (
  tenant_id    uuid NOT NULL,
  tag_id       uuid NOT NULL,
  entity_type  text NOT NULL,
  entity_id    uuid NOT NULL,
  PRIMARY KEY (tag_id, entity_type, entity_id),
  FOREIGN KEY (tenant_id, tag_id) REFERENCES tags(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE notes (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type  text NOT NULL,
  entity_id    uuid NOT NULL,
  body         text NOT NULL,
  author_id    uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notes_entity_idx ON notes (tenant_id, entity_type, entity_id);

-- Transactional outbox. Written in the same tx as the change; relayed to NATS.
CREATE TABLE outbox (
  id              uuid PRIMARY KEY,           -- uuidv7 => time ordered; used as NATS msg id (dedupe)
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type            text NOT NULL CHECK (type ~ '^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  version         int  NOT NULL DEFAULT 1,
  payload         jsonb NOT NULL,
  actor_type      text,
  actor_id        uuid,
  causation_id    uuid,
  correlation_id  uuid,
  depth           int  NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 16),
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz,
  attempts        int NOT NULL DEFAULT 0,
  last_error      text
);
CREATE INDEX outbox_pending_idx ON outbox (id) WHERE published_at IS NULL;

-- Append-only, hash-chained audit log. Chain computed by trigger so app cannot forge it.
CREATE TABLE audit_log (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  seq          bigint NOT NULL,
  actor_type   text NOT NULL CHECK (actor_type IN ('user','api_key','system','module')),
  actor_id     text,
  action       text NOT NULL,
  entity_type  text,
  entity_id    uuid,
  diff         jsonb,
  ip           inet,
  user_agent   text,
  request_id   text,
  at           timestamptz NOT NULL DEFAULT now(),
  prev_hash    bytea,
  hash         bytea NOT NULL,
  UNIQUE (tenant_id, seq)
);
CREATE INDEX audit_entity_idx ON audit_log (tenant_id, entity_type, entity_id);

CREATE FUNCTION audit_row_digest(a audit_log, prev bytea) RETURNS bytea LANGUAGE sql STABLE AS $$
  SELECT sha256(coalesce(prev, '\x'::bytea) || convert_to(concat_ws('|',
    a.id, a.tenant_id, a.seq, a.actor_type, a.actor_id, a.action, a.entity_type, a.entity_id,
    a.diff::text, host(a.ip), a.request_id, to_char(a.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
  ), 'UTF8'))
$$;

CREATE FUNCTION audit_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE last audit_log;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('audit:' || NEW.tenant_id::text, 0));
  SELECT * INTO last FROM audit_log WHERE tenant_id = NEW.tenant_id ORDER BY seq DESC LIMIT 1;
  NEW.seq := coalesce(last.seq, 0) + 1;
  NEW.at := now();
  NEW.prev_hash := last.hash;
  NEW.hash := audit_row_digest(NEW, last.hash);
  RETURN NEW;
END $$;
CREATE TRIGGER audit_chain_bi BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_chain();

-- Returns first broken seq for current tenant, or NULL if chain intact.
CREATE FUNCTION audit_verify() RETURNS bigint LANGUAGE plpgsql STABLE AS $$
DECLARE r audit_log; prev bytea := NULL;
BEGIN
  FOR r IN SELECT * FROM audit_log WHERE tenant_id = app_tenant_id() ORDER BY seq LOOP
    IF r.prev_hash IS DISTINCT FROM prev OR r.hash <> audit_row_digest(r, prev) THEN RETURN r.seq; END IF;
    prev := r.hash;
  END LOOP;
  RETURN NULL;
END $$;

-- ───────────── updated_at triggers ─────────────
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['tenants','users','memberships','roles','companies','contacts','documents','tasks','notes'] LOOP
    EXECUTE format('CREATE TRIGGER %I_updated BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;

-- ───────────── RLS ─────────────
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['roles','role_permissions','member_roles','tenant_modules','companies','contacts',
                           'documents','tasks','links','tags','taggings','notes','outbox','audit_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;

-- ───────────── Grants (least privilege) ─────────────
GRANT SELECT, INSERT, UPDATE ON tenants, users, memberships, api_keys TO office_app;
GRANT DELETE ON memberships, api_keys TO office_app;
GRANT SELECT ON modules TO office_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON roles, role_permissions, member_roles, tenant_modules,
  companies, contacts, documents, tasks, links, tags, taggings, notes TO office_app;
GRANT SELECT, INSERT ON outbox TO office_app;
GRANT SELECT, INSERT ON audit_log TO office_app;           -- no UPDATE/DELETE: append-only
GRANT EXECUTE ON FUNCTION app_tenant_id(), audit_verify() TO office_app;

GRANT SELECT, UPDATE (published_at, attempts, last_error) ON outbox TO office_relay;
