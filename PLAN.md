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
| 3 | Workflow engine + module loader (+ webhooks, `@office/sdk`) | ✅ done (37 tests green) |
| 4 | Admin UI + design system | ✅ done (55 unit/integration + 9 E2E green) |
| 5 | Module: Invoicing | ⏳ next |
| 6 | Module: CRM | ☐ |
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
| Repo | "Bibi Office" on GitHub (not reachable yet: needs GitHub connected + Claude app installed). Code in project files `office/` with local git history until then. |
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

## Handoff (Session 4)
1. Done: `apps/web` admin UI (OIDC PKCE login, onboarding, workspace switcher, dashboard, contacts/companies/tasks, workflow builder, settings: members/roles/modules/webhooks/API keys/audit), `@office/ui` design system + `SchemaForm` + module UI contract, slot host, `/me/access`, dev OIDC provider, CORS fix, CI E2E job.
2. Verify: Postgres on :55432 with roles (`scripts/local-pg.sh start`; on Windows see note below); `TEST_DATABASE_URL=... pnpm test` (36 api + 2 worker + 8 ui + 9 web); `pnpm typecheck && pnpm build`; `pnpm e2e` (9 Playwright flows, starts API + dev OIDC + Vite itself).
3. Next (Session 5): `modules/invoicing` (manifest per ARCHITECTURE §4, migrations w/ RLS, routes, events, actions) + its UI package via `defineModuleUi` (nav page, company tab, dashboard widget, global create).
4. Open: Windows has no `local-pg.sh` equivalent (used `embedded-postgres` with `--encoding=UTF8 --locale=C`; a WIN1252 cluster breaks tests); clone needs `core.longpaths=true`. Real Keycloak/Temporal/NATS smoke test still needs a Docker host.
5. Open: email invites (members must sign in once before being added), per-module DB roles, iframe sandbox for 3rd-party UI (v2).

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
