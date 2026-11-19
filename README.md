# Office

Modular business-automation platform. Start with PLAN.md and ARCHITECTURE.md.

## Dev quickstart
```bash
pnpm install
pnpm infra:up                         # postgres, nats, keycloak, minio, temporal (needs Docker)
cp .env.example .env && set -a && . ./.env && set +a
pnpm db:migrate                       # as office_owner
pnpm dev:api                          # http://localhost:3000/docs
pnpm dev:worker                       # outbox -> NATS relay
```

## Tests (real Postgres, no Docker needed)
```bash
scripts/local-pg.sh start             # throwaway PG16 on :55432
TEST_DATABASE_URL=postgres://office_owner:office_owner@localhost:55432/postgres pnpm test
```

## Layout
- `packages/db` SQL migrations (source of truth, RLS), Drizzle schema, `withTenant()`
- `packages/core` tenants, users, RBAC, API keys, shared entities, audit, outbox events
- `packages/testing` per-test-file database
- `apps/api` Fastify REST API + OpenAPI (`/docs`)
- `apps/worker` outbox relay to NATS JetStream
- `modules/` plug-in modules (Session 5+)
