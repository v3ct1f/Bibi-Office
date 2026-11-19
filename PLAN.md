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
| 5 | Module: Invoicing | ✅ done (75 unit/integration + 16 E2E green) |
| 6 | Module: CRM | ✅ done (84 unit/integration + 23 E2E green) |
| 6b | Feature modules: Add features page, Manager role, per-role grants, 403 while off | ✅ done |
| 7 | Module: Invoices & Expenses (receipt OCR, approvals, CSV) | ✅ done (105 unit/integration + 32 E2E green) |
| 8 | Module: Staff Scheduling & Time Clock (shifts, publish/copy week, time off, swaps, clock, hours CSV) | ✅ done (120 unit/integration + 38 E2E green) |
| 9 | Module: Support inbox (real IMAP/SMTP per company, threaded replies, notes, assignment, saved replies, Contact link + history, response-time targets) | ✅ done (149 unit/integration + 50 E2E green) |
| 10 | Module: HR | ☐ |
| 11 | Module: Inventory & Purchasing (items, stock moves with reasons, low-stock alerts, POs per supplier, receiving) | ✅ done (129 unit/integration + 44 E2E green) |
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

## Handoff (Session 12, Support inbox)
1. Done: `modules/support`.
   - Each company connects its own mailbox (IMAP + SMTP; passwords sealed). A job fetches new mail every minute into tickets. Auto-replies, own mail and duplicates are skipped.
   - Threading uses In-Reply-To/References, then `[#n]` plus the same sender. Quoted history is trimmed. Attachments up to 10 MB are kept.
   - Replies are emailed threaded (`Re: subject [#n]`). Failed sends are kept with the reason, with Retry and a retry job.
   - Internal notes, assignment, priority, open/pending/solved, and search (`#n`, text).
   - Saved replies with `{{customer.firstName}}` and other tags.
   - Each sender is matched to a core Contact or one is created; the customer's other tickets are shown.
   - Response-time targets per priority, an Overdue view, and a dashboard widget. Workflow labels for 5 events.
2. Verify:
   - `pnpm typecheck`.
   - `TEST_DATABASE_URL=... pnpm test`: api 96, including 11 support tests; module-support 8, run against in-memory IMAP/SMTP from `modules/support/tests/mail-servers.ts`.
   - `pnpm e2e`: 50 flows, including 6 support.
3. Next on the original list: HR (row 10), then Docs & e-sign, AI summaries, KPI dashboard.
4. Open:
   - OAuth sign-in for Gmail/Microsoft 365 (today: app passwords).
   - Business-hours targets (today: clock time).
   - Attachments on outgoing replies.
   - Collision warning when two agents reply at once.
   - Notifying the assignee on a customer reply (wire `support.ticket.customer_replied` to core `notify`).

## Handoff (Session 11, archived)
1. Done: `modules/inventory`.
   - Items with stock, minimum, reorder amount, supplier (core Companies) and unit cost.
   - Stock changes with a reason (delivery, usage, waste, count), each logged with person and stock after.
   - Low-stock banner and dashboard widget.
   - "Order low stock" creates one draft PO per supplier. POs can be edited, sent, received (partial amounts allowed; updates stock and unit cost), cancelled, or deleted while draft.
   - Stock history page; workflow labels for 5 events.
2. Verify: `pnpm typecheck`; `TEST_DATABASE_URL=... pnpm test` (api 85 incl. 8 inventory); `pnpm e2e` (44 flows incl. 6 inventory).
3. All three Feature Modules modules are done (Expenses, Scheduling, Inventory). Next on the original list: Support inbox.
4. Open: emailing POs to suppliers (core `send_email`), barcode scanning for counts, stock value report/CSV.

## Handoff (Session 8, archived)
1. Done: `modules/scheduling`.
   - Positions; week grid with draft and published shifts, overnight shifts and clash checks.
   - Copy last week; time off with approval; colleague-then-manager shift swaps.
   - Time clock; manager time entries; Hours page with planned vs worked hours and CSV export; dashboard widget.
   - Workflow labels for its 8 events.
2. Verify: `pnpm typecheck`; `TEST_DATABASE_URL=... pnpm test` (api 77 incl. 10 scheduling, 4 time helpers); `pnpm e2e` (38 flows incl. 6 scheduling).
3. Next: Inventory & Purchasing (items, stock moves with reasons, low-stock alerts, purchase orders per supplier from core Companies, receiving updates stock).
4. Open: notifications to staff when a week is published or a request is decided (core `send_email`); geofenced or PIN clock-in for shared tablets.

## Handoff (Session 6, archived)
1. Done: `modules/crm` (pipelines + ordered stages with open/won/lost kind and probability, deals, activity timeline, next steps, board/list/detail/editor pages, pipeline settings, company/contact Deals tab, dashboard widget, 3 workflow actions, 8 events; `crm.deal.won` feeds Invoicing). Local NATS-free worker (`pnpm dev:local-worker`, also started by E2E) so workflows and module handlers run locally. Workflow vocabulary + recipes for deals.
2. Verify: Postgres on :55432; `TEST_DATABASE_URL=... pnpm test` (52 api incl. 7 crm, 2 worker, 8 ui, 14 web, 8 invoicing); `pnpm typecheck`; `pnpm e2e` (23 flows incl. 7 CRM). Local stack: `pnpm dev:oidc`, `pnpm dev:local`, `pnpm dev:local-worker`, `pnpm dev:web`.
3. Next (Session 7): `modules/expenses` (receipts, categories, approval, reimbursement; may emit events Invoicing/KPI can use).
4. Open: deal owners in the UI, email/next-step reminders (core `send_email`), invoice email delivery, uploads for receipts/PDFs.
5. Open: same as Session 4 (Windows Postgres script, Docker smoke test, email invites, per-module DB roles).

## Handoff (Session 5, archived)
1. Done: `modules/invoicing` (business details + logo settings page, customer billing details, reference/service date, seller snapshot at finalize, guided editor/detail pages, drafts, gapless numbering, payments, void, reminders, overdue job, events, 2 workflow actions, `crm.deal.won` handler, UI pages/tab/widget/print view); SDK scheduled `jobs` + `module_job_state` + worker loop; `ModuleError`; core prefix search; E2E DB installs modules; workflow builder in plain language (trigger names, field picker, value chips, summary, recipes); `pnpm dev:local` one-command local API.
2. Verify: Postgres on :55432; `TEST_DATABASE_URL=... pnpm test` (36+9 api incl. invoicing, 2 worker, 8 ui, 12 web, 8 invoicing money); `pnpm typecheck`; `pnpm e2e` (16 flows).
3. Next (Session 6): `modules/crm` (pipelines, deals, stages, activities). Must emit `crm.deal.won` with payload `{ id, title, valueCents, currency, companyId?, contactId? }` so Invoicing drafts invoices (contract in modules/invoicing/README.md).
4. Open: email delivery for invoices + reminders needs core `send_email`; invoice PDFs into Documents need uploads; due dates use UTC (tenant time zone later).
5. Open: same as Session 4 (Windows Postgres script, Docker smoke test, email invites, per-module DB roles).

## Handoff (Session 4, archived)
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
