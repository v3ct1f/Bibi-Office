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

Set `PLATFORM_ADMIN_EMAILS` to your own email before the first start: you're the program owner at `/admin`, where you can also add co-owners or transfer ownership. Business owners set up their own business: they pay on `/start` (Stripe, see `docs/stripe-setup.md`) or you invite them from `/admin` (**Invite business owner**); either way they get an email to create their account, sign in and create their business (name, web address, region) at `/new-business`. With `SELF_SIGNUP=false` (default), nobody else can create a business.

Local sign-in uses email + password accounts (`pnpm dev:oidc`). New people get a "Set your password" link in their invitation email; anyone can get one at `/forgot-password`. Put `MAIL_SMTP_URL` and `MAIL_FROM` in `.env.local` so those emails go out.

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
