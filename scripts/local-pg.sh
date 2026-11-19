#!/usr/bin/env bash
# Starts a throwaway Postgres 16 (no Docker) for tests. Usage: scripts/local-pg.sh start|stop
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DIR=${PGDATA_DIR:-/tmp/office-pg}
PORT=${PGPORT:-55432}
RUN="sudo -u postgres"; [ "$(id -u)" != 0 ] && RUN=""
case "${1:-start}" in
  start)
    if [ ! -d "$DIR" ]; then
      mkdir -p "$DIR" && chown postgres "$DIR" 2>/dev/null || true
      $RUN $PGBIN/initdb -D "$DIR" -U postgres --auth=trust >/dev/null
    fi
    $RUN $PGBIN/pg_ctl -D "$DIR" -o "-p $PORT -k /tmp" -l "$DIR/log" -w start >/dev/null
    psql -h localhost -p $PORT -U postgres -q -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='office_owner') THEN CREATE ROLE office_owner LOGIN PASSWORD 'office_owner' CREATEDB CREATEROLE; END IF;
  ALTER ROLE office_owner CREATEROLE;  -- installer creates per-module roles (office_mod_*)
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='office_app') THEN CREATE ROLE office_app LOGIN PASSWORD 'office_app' NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='office_relay') THEN CREATE ROLE office_relay LOGIN PASSWORD 'office_relay' BYPASSRLS; END IF;
END \$\$;
SQL
    echo "postgres://office_owner:office_owner@localhost:$PORT/postgres" ;;
  stop) $RUN $PGBIN/pg_ctl -D "$DIR" -m fast stop ;;
esac
