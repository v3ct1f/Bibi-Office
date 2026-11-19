#!/usr/bin/env bash
# Full-stack smoke test: real images + Postgres, NATS, Keycloak, Temporal (infra/docker-compose.yml).
# Builds the api/worker images, migrates, installs modules, logs in through Keycloak and drives
# tenant → modules → time zone → metrics → workflow (run by the worker on Temporal) → API key.
# Needs: docker (compose v2), pnpm, curl, jq. Uses host networking (Linux). Runs in CI (job "smoke").
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f infra/docker-compose.yml -p office-smoke"
API=http://localhost:3000/api/v1
KC=http://localhost:8080
OWNER_URL=postgres://office_owner:office_owner@localhost:5432/office
PEPPER=$(head -c 32 /dev/urandom | base64)
SECRETS_KEY=$(head -c 32 /dev/urandom | base64)
PASS=$(head -c 18 /dev/urandom | base64 | tr -d '/+=')

log() { printf '\n▶ %s\n' "$*"; }
fail() { echo "✗ $*" >&2; docker logs office-smoke-api 2>&1 | tail -50 >&2 || true; docker logs office-smoke-worker 2>&1 | tail -50 >&2 || true; exit 1; }
wait_for() { local n=0; until eval "$2" >/dev/null 2>&1; do n=$((n+1)); [ $n -gt "$3" ] && fail "timeout waiting for $1"; sleep 2; done; echo "  $1 ready"; }
cleanup() { docker rm -f office-smoke-api office-smoke-worker >/dev/null 2>&1 || true; [ "${KEEP:-}" = 1 ] || $COMPOSE down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT

log "Build images"
docker build -q --build-arg APP=api -t office-api:smoke . >/dev/null
docker build -q --build-arg APP=worker -t office-worker:smoke . >/dev/null

log "Start infra"
$COMPOSE up -d postgres nats keycloak temporal
wait_for postgres "$COMPOSE exec -T postgres pg_isready -U office_owner -d office" 60
wait_for keycloak "curl -fsS $KC/realms/office/.well-known/openid-configuration" 120

log "Migrate + install modules (module DB roles on)"
DATABASE_URL=$OWNER_URL pnpm -s db:migrate
DATABASE_URL=$OWNER_URL pnpm -s modules:install

log "Start api + worker containers"
COMMON=(--network host -e NODE_ENV=production -e SECRETS_KEY="$SECRETS_KEY" -e FILES_DIR=/tmp/files
  -e DATABASE_URL_APP=postgres://office_app:office_app@localhost:5432/office)
docker run -d --name office-smoke-api "${COMMON[@]}" -e PORT=3000 \
  -e OIDC_ISSUER=$KC/realms/office -e OIDC_AUDIENCE=office-api -e API_KEY_PEPPER="$PEPPER" office-api:smoke >/dev/null
wait_for temporal "$COMPOSE exec -T temporal sh -c 'temporal operator cluster health --address \$(hostname -i):7233 || tctl --address \$(hostname -i):7233 cluster health' | grep -q SERVING" 90
docker run -d --name office-smoke-worker "${COMMON[@]}" -e TEMPORAL_ADDRESS=localhost:7233 -e NATS_URL=nats://localhost:4222 \
  -e DATABASE_URL_RELAY=postgres://office_relay:office_relay@localhost:5432/office office-worker:smoke dist/main.js >/dev/null
wait_for api "curl -fsS localhost:3000/healthz" 30

log "Keycloak: test client + user"
ADMIN=$(curl -fsS $KC/realms/master/protocol/openid-connect/token -d grant_type=password -d client_id=admin-cli \
  -d username=admin -d password=admin | jq -r .access_token)
kc() { curl -fsS -H "Authorization: Bearer $ADMIN" -H 'content-type: application/json' "$@"; }
kc $KC/admin/realms/office/clients -d '{"clientId":"office-smoke","publicClient":true,"directAccessGrantsEnabled":true,"standardFlowEnabled":false,
  "protocolMappers":[{"name":"aud","protocol":"openid-connect","protocolMapper":"oidc-audience-mapper","config":{"included.custom.audience":"office-api","access.token.claim":"true"}}]}'
kc $KC/admin/realms/office/users -d "{\"username\":\"smoke\",\"email\":\"smoke@example.com\",\"emailVerified\":true,\"enabled\":true,
  \"firstName\":\"Smoke\",\"lastName\":\"Test\",\"credentials\":[{\"type\":\"password\",\"value\":\"$PASS\",\"temporary\":false}]}"
TOKEN=$(curl -fsS $KC/realms/office/protocol/openid-connect/token -d grant_type=password -d client_id=office-smoke \
  -d username=smoke -d "password=$PASS" -d scope=openid | jq -r .access_token)
[ -n "$TOKEN" ] && [ "$TOKEN" != null ] || fail "no token"

api() {
  local m=$1 p=$2 h=(-H "Authorization: Bearer $TOKEN"); shift 2
  [ -n "${TENANT:-}" ] && h+=(-H "x-tenant-id: $TENANT")
  [ $# -gt 0 ] && h+=(-H 'content-type: application/json')
  curl -fsS -X "$m" "$API$p" "${h[@]}" "$@" || fail "$m $p"
}
check() { [ "$(jq -r "$2" <<<"$1")" = "$3" ] || fail "expected $2 = $3, got: $1"; echo "  ✓ $4"; }

log "Login + tenant"
check "$(api GET /me)" .email smoke@example.com "OIDC login"
TENANT=$(api POST /tenants -d '{"slug":"smoke-co","name":"Smoke Co"}' | jq -r .id)
check "$(api PATCH /tenant -d '{"timeZone":"America/Los_Angeles"}')" .timeZone America/Los_Angeles "organization time zone"

log "Modules"
for m in invoicing crm kpi; do api POST /modules/$m/enable >/dev/null; done
check "$(api GET /modules | jq '[.[] | select(.enabled)] | length')" . 3 "3 modules enabled"
check "$(api GET /m/kpi/dashboards | jq '.data[0].name')" . Overview "kpi dashboard seeded (module DB role)"
check "$(api GET '/metrics/values?keys=invoicing.revenue,crm.pipeline&from=2026-01-01&to=2026-01-31' | jq '[.data[] | select(.ok)] | length')" . 2 "metrics computed"

log "Workflow on Temporal"
WF=$(api POST /workflows -d '{"name":"Smoke","trigger":{"event":"core.contact.created"},"actions":[{"key":"core.create_task","input":{"title":"Call back"}}]}' | jq -r .id)
api POST /contacts -d '{"firstName":"Ada","email":"ada@example.com"}' >/dev/null
wait_for "workflow run" "curl -fsS '$API/workflows/$WF/runs' -H 'Authorization: Bearer $TOKEN' -H 'x-tenant-id: $TENANT' | jq -e '.[0].status == \"succeeded\"'" 30
check "$(api GET /tasks | jq '[.data[] | select(.title == "Call back")] | length')" . 1 "task created by the workflow"

log "API key"
KEY=$(api POST /api-keys -d '{"name":"smoke","scopes":["core:contacts.read"]}' | jq -r .token)
check "$(curl -fsS $API/contacts -H "Authorization: Bearer $KEY" | jq '.data | length')" . 1 "API key reads contacts"

log "Smoke test passed"
