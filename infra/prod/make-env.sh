#!/bin/sh
# Creates /opt/office/.env from .env.example and fills in every secret that can be generated (random, never reused).
# Run once on the server:  sh make-env.sh        It refuses to overwrite an existing .env.
# Afterwards open the file and fill in RESEND_API_KEY (and, when going live, the Stripe keys). Do not paste them in chat.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
dest=${1:-/opt/office/.env}
[ -e "$dest" ] && { echo "$dest already exists; not touching it."; exit 1; }
hex() { openssl rand -hex "$1"; }
sed \
  -e "s|^DB_OWNER_PASSWORD=.*|DB_OWNER_PASSWORD=$(hex 24)|" \
  -e "s|^DB_APP_PASSWORD=.*|DB_APP_PASSWORD=$(hex 24)|" \
  -e "s|^DB_RELAY_PASSWORD=.*|DB_RELAY_PASSWORD=$(hex 24)|" \
  -e "s|^KEYCLOAK_DB_PASSWORD=.*|KEYCLOAK_DB_PASSWORD=$(hex 24)|" \
  -e "s|^KC_ADMIN_PASSWORD=.*|KC_ADMIN_PASSWORD=$(hex 16)|" \
  -e "s|^OFFICE_ADMIN_CLIENT_SECRET=.*|OFFICE_ADMIN_CLIENT_SECRET=$(hex 32)|" \
  -e "s|^API_KEY_PEPPER=.*|API_KEY_PEPPER=$(hex 32)|" \
  -e "s|^SECRETS_KEY=.*|SECRETS_KEY=$(openssl rand -base64 32)|" \
  "$here/.env.example" > "$dest"
chmod 600 "$dest"
echo "Created $dest (readable only by its owner)."
echo "Next: edit it and fill in RESEND_API_KEY. Keep a copy of the whole file in your password manager."
