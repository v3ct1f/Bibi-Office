#!/bin/sh
# Runs once, the first time the database starts. Creates the restricted roles Office uses (they can never see
# other businesses' data: row-level security applies to them) and a separate database for Keycloak.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE office_app   LOGIN PASSWORD '${DB_APP_PASSWORD}'   NOSUPERUSER NOBYPASSRLS;
CREATE ROLE office_relay LOGIN PASSWORD '${DB_RELAY_PASSWORD}' NOSUPERUSER BYPASSRLS;
CREATE ROLE keycloak     LOGIN PASSWORD '${KEYCLOAK_DB_PASSWORD}' NOSUPERUSER;
CREATE DATABASE keycloak OWNER keycloak;
SQL
