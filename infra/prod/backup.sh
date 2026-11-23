#!/bin/sh
# Daily database backup (Office and the sign-in service). Keeps 14 days in /var/backups/office.
# Installed by the README as a cron job. Restore: see README.md. Copy these files OFF the server regularly too.
set -eu
dir=/var/backups/office
cd /opt/office/current/infra/prod
day=$(date +%F)
docker compose --env-file .env exec -T postgres pg_dump -U office_owner -Fc office > "$dir/office-$day.dump"
docker compose --env-file .env exec -T postgres pg_dump -U office_owner -Fc keycloak > "$dir/keycloak-$day.dump"
chmod 600 "$dir"/*.dump
find "$dir" -name '*.dump' -mtime +14 -delete
echo "Backup written to $dir ($day)."
