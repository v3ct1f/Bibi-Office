#!/bin/sh
# Runs once, on an empty database volume. Passwords come from .env (hex, no quoting needed).
set -eu
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<SQL
CREATE ROLE office_app LOGIN PASSWORD '$APP_DB_PASSWORD' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE office_relay LOGIN PASSWORD '$RELAY_DB_PASSWORD' NOSUPERUSER BYPASSRLS;
CREATE ROLE keycloak LOGIN PASSWORD '$KEYCLOAK_DB_PASSWORD' NOSUPERUSER;
CREATE DATABASE keycloak OWNER keycloak;
SQL
