# Office — Plan

## Goals
- Reusable business-automation platform for any company.
- Small secure core + per-tenant toggleable modules via a stable SDK.
- Production-grade: multi-tenant, secure by default, horizontally scalable.

## Key decisions (Session 1)
| # | Decision | Why |
|---|---|---|
| D1 | TypeScript monorepo (pnpm + Turborepo) | One language, shared types core <-> modules <-> UI |
| D2 | Modular monolith, modules as in-process packages | Simple ops now; ctx/events boundary allows split later |
| D3 | Shared DB + Postgres RLS on `tenant_id` | Cheap multi-tenancy with DB-enforced isolation |
| D4 | Keycloak for identity, own RBAC for permissions | Don't build login/MFA/SSO; keep authz module-aware |
| D5 | Outbox + NATS JetStream for events | Exactly-once-ish publish, durable replay |
| D6 | Temporal for workflow execution | Durable retries/timers without custom scheduler |
| D7 | Modules only use `ctx`; no cross-module imports | Isolation, permission enforcement, replaceability |
| D8 | v1 modules first-party + build-time UI slots; 3rd-party via iframe sandbox later | Safety before marketplace |
| D9 | REST + OpenAPI from Zod; signed webhooks | Standard, easy for integrators |
| D10 | Append-only hash-chained audit log | Compliance + e-sign evidence |

## Sessions
| # | Scope | Status |
|---|---|---|
| 1 | Architecture, stack, data model, SDK spec | ✅ done |
| 2 | Core backend: auth, tenants, RBAC, shared data, events/outbox, audit, API | ✅ done |
| 3 | Workflow engine + module loader (+ webhooks, `@office/sdk`) | ✅ done |
| 4 | Admin UI + design system | ✅ done |
| 5 | Module: Invoicing (+ SDK jobs/files/UI contract) | ✅ done (23 module + 36 api + 2 worker + 5 web unit + 11 E2E) |
| 6 | Module: CRM | ⏳ next |
| 7 | Module: Expenses | ☐ |
| 8 | Module: Scheduling | ☐ |
| 9 | Module: Support inbox | ☐ |
| 10 | Module: HR | ☐ |
| 11 | Module: Inventory | ☐ |
| 12 | Module: Docs & e-sign | ☐ |
| 13 | Module: AI email/meeting summaries | ☐ |
| 14 | Module: KPI dashboard | ☐ |

## Defaults chosen (Session 2, user said "go"; revisit anytime)
| Question | Default |
|---|---|
| Repo | github.com/v3ct1f/Bibi-Office. Sessions 1-3 on `main`; from Session 4 each session is a branch + PR. |
| Hosting / region | Cloud-agnostic containers (Docker → Helm/K8s), self-host possible. Tenant `region` field, default `eu`; `us` allowed. |
| Temporal + Keycloak | Keep both (recommended). Revisit only if ops cost hurts. |
| Billing | Not in core v1. Later as a module (Stripe) using `tenants.plan`. |
| 3rd-party marketplace | Not in v1. First-party modules only; sandboxed iframe UI in v2. |
| Currency / locale | Per-tenant settings; defaults EUR, `en`, UTC. |
| Email invites, document uploads | Later core pass (not Session 3). |

## Session rules
- Update PLAN.md + ARCHITECTURE.md at end of every session.
- Each module in `/modules/<name>` with its own README.
- End with 5-line handoff below.
- New session reads only PLAN.md, ARCHITECTURE.md, and its target folder.

## Handoff (Session 5)
1. Done: `modules/invoicing` (drafts, lines/tax, gapless numbering, issue/immutability in DB, payments, void, reminders, overdue job, PDF, summary, 8 events, 2 workflow actions, `crm.deal.won` → draft; UI list/editor/detail/widget/contact tab). SDK: `jobs`, `file()`, `ModuleError`, `@office/sdk/ui`; core migration 0003 `module_jobs` + worker loop.
2. Verify: `scripts/local-pg.sh start`; `TEST_DATABASE_URL=... pnpm test`; `pnpm --filter @office/web build:e2e && TEST_DATABASE_URL=... pnpm --filter @office/web e2e`.
3. Next (Session 6): `modules/crm` (deals, pipeline stages, activities; emit `crm.deal.won` with the v1 payload in `modules/invoicing/README.md`), `entity.tab:company` needs a companies page in the shell.
4. Open: email delivery (core email action) so `invoice.sent`/`reminder_requested` actually mail; Unicode PDF font; tenant time zone for due/overdue (UTC now).
5. Open: credit notes/refunds, quotes, recurring invoices, Stripe payment links: which matter first?

## Handoff (Session 4, archived)
1. Done: `packages/ui` design system (tokens, light/dark, 12 components); `apps/web` admin app (OIDC PKCE, org switcher + onboarding, contacts, modules + settings form, members, roles, API keys, workflows editor + runs, webhooks + deliveries, audit log); module UI slot host; `/me/permissions` API.
2. Verify: `scripts/local-pg.sh start`; `pnpm test`; `pnpm --filter @office/web build:e2e && TEST_DATABASE_URL=... pnpm --filter @office/web e2e`.
3. Next (Session 5): `modules/invoicing` (package `@office/module-invoicing`): migrations, manifest per §4.5, routes, actions, events, UI (`nav.main` page, `entity.tab:company`, dashboard widget), register in `packages/modules` + `apps/web/src/modules/registry.ts`.
4. Open: real Keycloak login not yet exercised (needs Docker host); bundle is ~500 KB, add route code-splitting when modules land.
5. Open: generate API types from OpenAPI instead of hand-written `apps/web/src/lib/types.ts`.

## Handoff (Session 3, archived)
1. Done: `@office/sdk`, `@office/platform` (module install/enable/settings+secrets, ctx, dispatcher, workflows w/ inline + Temporal runners, webhooks w/ signing, retries, SSRF guard), `@office/modules`, API routes, worker loops, sample module fixture (`apps/api/test/fixtures/sample`).
2. Verify: `scripts/local-pg.sh start`; `TEST_DATABASE_URL=... pnpm test` (35 api + 2 worker); `pnpm typecheck && pnpm build`.
3. Next (Session 4): `apps/web` admin UI (React+Vite+TanStack, shadcn design system in `packages/ui`), OIDC PKCE login, tenant switcher, modules toggle/settings, members/roles, workflows builder, webhooks, audit viewer, UI slot host.
4. Open: push to GitHub once access exists; Temporal + NATS + Keycloak end-to-end smoke test needs a Docker host.
5. Open: per-module DB roles (stronger isolation) before third-party modules; email action + inbound webhooks timing.

## Handoff (Session 2, archived)
1. Done: monorepo (pnpm/turbo), infra compose, `packages/db` (SQL+RLS+audit chain), `packages/core`, `apps/api` (OIDC/API keys, RBAC, tenants, members, roles, entities, audit), `apps/worker` (outbox→NATS), tests, CI, Dockerfile.
2. Verify: `scripts/local-pg.sh start` then `TEST_DATABASE_URL=... pnpm test` (22 tests); `pnpm build`.
3. Next (Session 3): `packages/sdk` (manifest Zod schema, `defineModule`, ctx), module loader (registry, enable/disable, migrations, permissions), workflow tables + Temporal worker, webhooks (tables, signing, delivery).
4. Open: GitHub repo to push to; real Keycloak smoke test (needs Docker host); Redis-backed rate limiting.
5. Open: email invite flow + S3 upload for documents — Session 3 or a later core pass?

## Handoff (Session 1, archived)
1. Done: ARCHITECTURE.md (diagram, stack, data model, SDK spec + invoicing manifest, workflow, security, folders); PLAN.md.
2. Next: Session 2 — scaffold monorepo, `infra/docker-compose.yml`, `packages/db` (core schema + RLS), `packages/core`, `apps/api` (auth, tenants, RBAC, shared data, outbox, audit, OpenAPI).
3. Open: repo location/name; hosting target (cloud vs self-host) and data region(s).
4. Open: Temporal + Keycloak ops cost OK, or prefer lighter (BullMQ-only workflows, Better Auth)?
5. Open: billing/subscriptions in core? third-party module marketplace in scope? default currency/locale?
