#!/usr/bin/env bash
# CI check for the test install (infra/trial): setup on DOMAIN=localhost, then sign in through HTTPS and use the API.
set -euo pipefail
cd "$(dirname "$0")/.."
T=infra/trial
export OFFICE_DOMAIN=localhost OFFICE_OWNER_EMAIL=owner@example.com OFFICE_OWNER_NAME="Olive Owner"
dc() { docker compose --project-directory $T -f $T/docker-compose.yml --env-file $T/.env "$@"; }
fail() { echo "✗ $*" >&2; dc logs --tail 60 api keycloak caddy >&2 || true; exit 1; }
ok() { echo "  ✓ $*"; }

$T/office.sh setup | tee /tmp/setup.log
grep -q "One-time password" /tmp/setup.log || fail "no owner password printed"

curl -fsSk https://localhost/ | grep -q '<div id="root"' && ok "web app served over HTTPS" || fail "web app"
curl -fsSk https://localhost/login >/dev/null && ok "SPA fallback" || fail "SPA fallback"
iss=$(curl -fsSk https://localhost/id/realms/office/.well-known/openid-configuration | jq -r .issuer)
[ "$iss" = https://localhost/id/realms/office ] && ok "login service issuer $iss" || fail "issuer $iss"
[ "$(curl -sk -o /dev/null -w '%{http_code}' https://localhost/id/admin/)" = 404 ] && ok "admin console hidden" || fail "admin console reachable"
[ "$(curl -sk -o /dev/null -w '%{http_code}' https://localhost/api/v1/me)" = 401 ] && ok "API needs sign-in" || fail "API auth"

$T/office.sh add-user staff@example.com "Sam Staff" | grep -q "One-time password" && ok "add-user" || fail "add-user"
$T/office.sh add-user staff@example.com "Sam Staff" | grep -q "already has a login" && ok "add-user is idempotent" || fail "add-user twice"
$T/office.sh setup >/dev/null && ok "setup re-run is safe" || fail "setup re-run"

# Sign in as a user without the browser: a CI-only client with password grant.
set -a; . $T/.env; set +a
kc() { dc exec -T keycloak /opt/keycloak/bin/kcadm.sh "$@" --config /tmp/kcadm.config; }
kc create clients -r office -s clientId=ci -s publicClient=true -s directAccessGrantsEnabled=true -s standardFlowEnabled=false \
  -s 'protocolMappers=[{"name":"aud","protocol":"openid-connect","protocolMapper":"oidc-audience-mapper","config":{"included.custom.audience":"office-api","access.token.claim":"true"}}]' >/dev/null
kc set-password -r office --username staff@example.com --new-password Ci-Pass-12345 >/dev/null
TOKEN=$(curl -fsSk https://localhost/id/realms/office/protocol/openid-connect/token -d grant_type=password -d client_id=ci \
  -d username=staff@example.com -d password=Ci-Pass-12345 -d scope=openid | jq -r .access_token)
[ "$(curl -fsSk https://localhost/api/v1/me -H "Authorization: Bearer $TOKEN" | jq -r .email)" = staff@example.com ] && ok "signed-in API call" || fail "API with token"
T_ID=$(curl -fsSk https://localhost/api/v1/tenants -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"slug":"ci-bakery","name":"CI Bakery"}' | jq -r .id)
curl -fsSk -X POST https://localhost/api/v1/modules/invoicing/enable -H "Authorization: Bearer $TOKEN" -H "x-tenant-id: $T_ID" >/dev/null && ok "organization + module" || fail "enable module"

$T/office.sh reset-password staff@example.com | grep -q "New one-time password" && ok "reset-password" || fail "reset-password"
$T/office.sh backup | grep -q "Saved" && ls $T/backups/*.tar.gz >/dev/null && ok "backup" || fail "backup"
echo "Test install check passed"
