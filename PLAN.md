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
| 5 | Module: Invoicing (+ SDK jobs/files/UI contract) | ✅ done |
| 6 | Module: CRM (+ companies pages in shell) | ✅ done (12 crm + 23 invoicing + 36 api + 2 worker + 5 web unit + 13 E2E) |
| 7 | Module: Expenses (+ core file uploads) | ✅ done (18 expenses + 12 crm + 23 invoicing + 45 api + 2 worker + 5 web unit + 16 E2E) |
| 8 | Module: Scheduling (+ public module pages) | ✅ done (15 scheduling + 18 expenses + 12 crm + 23 invoicing + 45 api + 2 worker + 5 web unit + 20 E2E) |
| 9 | Module: Support inbox (+ core email) | ✅ done (20 support + 16 scheduling + 18 expenses + 12 crm + 23 invoicing + 60 api + 2 worker + 5 web unit + 24 E2E) |
| 10 | Module: HR ("People") | ✅ done (20 hr + 20 support + 16 scheduling + 18 expenses + 12 crm + 23 invoicing + 60 api + 2 worker + 5 web unit + 28 E2E) |
| 11 | Module: Inventory | ✅ done (15 inventory + 20 hr + 20 support + 16 scheduling + 18 expenses + 12 crm + 23 invoicing + 60 api + 2 worker + 5 web unit + 31 E2E) |
| 12 | Module: Docs & e-sign | ✅ done (14 docs + 15 inventory + 20 hr + 20 support + 16 scheduling + 18 expenses + 12 crm + 23 invoicing + 60 api + 2 worker + 5 web unit + 34 E2E) |
| 13 | Module: AI email/meeting summaries | ✅ done (14 ai + 14 docs + 15 inventory + 20 hr + 20 support + 16 scheduling + 18 expenses + 12 crm + 23 invoicing + 60 api + 2 worker + 5 web unit + 37 E2E) |
| 14 | Module: KPI dashboard (+ SDK metrics, core metrics API) | ✅ done (14 kpi + 14 ai + 14 docs + 15 inventory + 20 hr + 20 support + 16 scheduling + 18 expenses + 12 crm + 23 invoicing + 60 api + 2 worker + 5 web unit + 42 E2E) |

## Defaults chosen (Session 2, user said "go"; revisit anytime)
| Question | Default |
|---|---|
| Repo | github.com/v3ct1f/Bibi-Office. Sessions 1-3 on `main`; from Session 4 each session is a branch + PR. |
| Hosting / region | Cloud-agnostic containers (Docker → Helm/K8s), self-host possible. Tenant `region` field, default `eu`; `us` allowed. |
| Temporal + Keycloak | Keep both (recommended). Revisit only if ops cost hurts. |
| Billing | Not in core v1. Later as a module (Stripe) using `tenants.plan`. |
| 3rd-party marketplace | Not in v1. First-party modules only; sandboxed iframe UI in v2. |
| Currency / locale | Per-tenant settings; defaults EUR, `en`, UTC. |
| Email invites | Later core pass (core mail exists since Session 9). |
| Email | Built in Session 9: outbound queue sent by the worker over SMTP (any provider); inbound via provider webhook (normalized JSON or Postmark format) to per-module addresses `<key>@INBOUND_MAIL_DOMAIN`. |
| Document uploads | Built in Session 7: server-side upload (no presign), local disk or S3, 10 MB, content-detected types. |

## Session rules
- Update PLAN.md + ARCHITECTURE.md at end of every session.
- Each module in `/modules/<name>` with its own README.
- End with 5-line handoff below.
- New session reads only PLAN.md, ARCHITECTURE.md, and its target folder.

## Handoff (Session 14)
1. Done: SDK `metrics` contract (+ `flowSum`/`scalar`/`inRange` helpers); core `GET /metrics` and `/metrics/values` (live, permission- and module-aware, savepoint per metric, previous period, filled buckets); 20 metrics across all 9 modules; `modules/kpi` ("KPIs"): saved dashboards, period picker, stat tiles with comparison, sparkline/line/bar charts, targets, edit mode, Home widget.
2. Verify: `scripts/local-pg.sh start`; `TEST_DATABASE_URL=... pnpm test` (`modules/kpi/tests/all-metrics.test.ts` runs every module's metrics); `pnpm --filter @office/web build:e2e && TEST_DATABASE_URL=... pnpm --filter @office/web e2e`.
3. Next: the planned module sessions are complete. Suggested Session 15: hardening pass (tenant time zones for dates/periods, per-module DB roles, route code-splitting, Keycloak + Temporal smoke test on a Docker host, OpenAPI-generated web types).
4. Open (KPI): tenant time zone (UTC now); currency conversion; scheduled KPI email digest and target alerts (workflow trigger); per-user dashboards; caching if metrics get slow.
5. Open (carried): AI email forwarding and core Tasks page, e-sign PDF upload/ID checks, inventory–invoice link, purchase orders, HR accruals, mail attachments, bounce handling/DKIM, CAPTCHA, calendar sync, blob sweep, antivirus hook.

## Handoff (Session 13, archived)
1. Done: `modules/ai` ("Summaries"): meeting notes, transcripts (.vtt/.srt/.txt upload) and email threads summarized by Claude (official SDK, structured output, refusal fallback) into overview, key points, decisions, action items, open questions; chosen action items → core tasks; tenant's own API key as a module secret; monthly token limit checked before each call; `keepSource` toggle; workflow action `ai.summarize`. Core web: "Open tasks" card on Home. E2E: fake Claude API in global setup; test-only rate limit 5000/min.
2. Verify: `scripts/local-pg.sh start`; `TEST_DATABASE_URL=... pnpm test`; `pnpm --filter @office/web build:e2e && TEST_DATABASE_URL=... pnpm --filter @office/web e2e` (no real API calls anywhere).
3. Next (Session 14): `modules/kpi` dashboard: tiles and charts from module data (revenue, overdue, pipeline, expenses, tickets, stock, signatures), each module exposing metrics through an SDK hook; date ranges; permission-aware.
4. Open (AI): forwarding emails to summarize (needs sender verification), summarizing support threads in place, a core Tasks page, streaming/background jobs for very long texts (call now runs inside the request transaction, ≤120 s), Batch API for bulk.
5. Open (carried): e-sign fields in text/PDF upload/ID checks, inventory–invoice link, purchase orders, HR accruals, mail attachments, bounce handling/DKIM, CAPTCHA, calendar sync, blob sweep, antivirus hook, code splitting.

## Handoff (Session 12, archived)
1. Done: `modules/docs` (shown as "E-sign"): templates with merge fields from contacts/companies, drafts, signers (parallel or in order), signing by emailed link (hashed token in the URL fragment), typed name + optional drawing + consent, decline, reminders (rotate link), cancel, hourly expiry, content hash fixed at send, append-only evidence trail, deterministic PDF with signature certificate, workflow action `docs.send_template`. Core: public routes may return files and get the user agent; `PublicApi.url()`.
2. Verify: `scripts/local-pg.sh start`; `TEST_DATABASE_URL=... pnpm test`; `pnpm --filter @office/web build:e2e && TEST_DATABASE_URL=... pnpm --filter @office/web e2e`.
3. Next (Session 13): `modules/ai` (summaries of support threads and meeting notes via the Claude API; tenant API key in module secrets; per-tenant usage caps; no data sent unless enabled).
4. Open: sign fields placed inside the text; uploading an existing PDF to sign; signer ID checks (SMS/email code); archiving signed PDFs into core documents; DOCX import; QES providers.
5. Open (carried): inventory–invoice link, purchase orders, HR carry-over/accruals, mail attachments, bounce handling/DKIM, CAPTCHA, calendar sync, blob sweep, antivirus hook, code splitting (bundle ~620 KB).

## Handoff (Session 11, archived)
1. Done: `modules/inventory`: items (SKU, barcode, unit, moving-average cost, reorder point/qty), locations (Main seeded), append-only movement ledger (receive, issue, transfer, adjust with reason, count), stock table kept by a DB trigger and never negative (CHECK + row lock), low-stock event on crossing, reorder list, stock value, CSV export, dashboard widget, workflow actions `inventory.issue` / `inventory.receive`.
2. Verify: `scripts/local-pg.sh start`; `TEST_DATABASE_URL=... pnpm test`; `pnpm --filter @office/web build:e2e && TEST_DATABASE_URL=... pnpm --filter @office/web e2e`.
3. Next (Session 12): `modules/docs` (document templates, merge fields from contacts, PDF, e-sign via public signing page + audit trail).
4. Open: link invoice lines to items (auto-issue on invoice sent); purchase orders; batches/serials/expiry; FIFO costing; barcode scanning via camera; multi-currency costs.
5. Open (carried): HR carry-over and accruals, mail attachments, bounce handling/DKIM, CAPTCHA, calendar sync, blob sweep, antivirus hook, code splitting (bundle ~600 KB).

## Handoff (Session 10, archived)
1. Done: `modules/hr` (shown as "People"): employee records linked to member accounts, managers (DB-checked, no loops), private fields visible only to HR and the person, self-service contact details, employee documents via `ctx.files` (HR uploads; HR and the person read; views audited), leave types (seeded), company holidays, leave requests counted in working days (settings `workDays`, holidays excluded, half days), yearly allowance prorated for joiners/leavers, overlap guard (exclusion constraint), manager or approver decides (never own), emails to manager and employee, team "who's away" calendar hiding the reason from others, dashboard widget, workflow action `hr.decide_leave`.
2. Verify: `scripts/local-pg.sh start`; `TEST_DATABASE_URL=... pnpm test`; `pnpm --filter @office/web build:e2e && TEST_DATABASE_URL=... pnpm --filter @office/web e2e`.
3. Next (Session 11): `modules/inventory` (items/SKUs, locations, stock movements as a ledger, low-stock alerts; later link to invoicing lines).
4. Open: carry-over of unused days; per-person work patterns (part-time days); accrual policies; onboarding checklists (core tasks); org chart view; reminder emails; per-country holiday presets.
5. Open (carried): mail attachments, bounce handling/DKIM, business-hours SLAs, CAPTCHA, per-host time zones, calendar sync, blob sweep, antivirus hook, code splitting (bundle ~580 KB).

## Handoff (Session 9, archived)
1. Done: core email (`ctx.mail.send` queues in the request tx, worker sends via SMTP with 5 retries; `inboundMail` handler + `POST /api/v1/inbound/mail` with shared secret, routed by per-module address, deduped by Message-ID); Scheduling now emails customers on book/move/cancel; `modules/support` (numbered tickets from email, contact form, or team; threading by Message-ID then `[#n]` + sender; replies emailed in-thread; internal notes; assign/status/priority; first-reply SLA job; contact linking) + inbox UI, ticket view, public contact form, widget, contact tab.
2. Verify: `scripts/local-pg.sh start`; `TEST_DATABASE_URL=... pnpm test`; `pnpm --filter @office/web build:e2e && TEST_DATABASE_URL=... pnpm --filter @office/web e2e`.
3. Next (Session 10): `modules/hr` (employee records linked to members, leave requests + approvals, documents via `ctx.files`).
4. Open: attachments on inbound/outbound mail; bounce/complaint handling and per-tenant sending domains (DKIM); business-hours SLAs; canned replies; CSAT; booking reminder emails (needs a scheduled job); CAPTCHA option for public pages.
5. Open (carried): per-host time zones, calendar sync, blob sweep, antivirus hook, contacts `companyId` filter, CRM owner picker, code splitting (bundle ~550 KB).

## Handoff (Session 8, archived)
1. Done: public module routes (`publicRoutes`, `/api/v1/public/<tenantSlug>/m/<key>/…`, anonymous ctx, 60/min per IP) and public pages in the web app (`/p/<tenantSlug>/<key>/…`, no sign-in); `modules/scheduling` (services + hosts, weekly hours in a business time zone, time off, slot finder, bookings with a DB exclusion constraint against double-booking, reschedule/cancel/outcomes, customer manage link with hashed token, contact linking by email) + team calendar UI and phone-friendly public booking page.
2. Verify: `scripts/local-pg.sh start`; `TEST_DATABASE_URL=... pnpm test`; `pnpm --filter @office/web build:e2e && TEST_DATABASE_URL=... pnpm --filter @office/web e2e`.
3. Next (Session 9): `modules/support` (shared inbox: tickets from email/web form, assign, status, replies, SLAs). Needs inbound/outbound email: build a core mail service (SMTP out + inbound webhook) first in the same session?
4. Open: booking confirmation/reminder emails (wait for core mail); CAPTCHA option for public pages; per-host time zones; recurring/group bookings; calendar sync (ICS feed / Google).
5. Open (carried): blob sweep, antivirus hook, contacts `companyId` filter, CRM owner picker, code splitting (bundle ~530 KB).

## Handoff (Session 7, archived)
1. Done: core file uploads (`FILES_DRIVER=fs|s3`, `POST /documents/upload`, `GET /documents/:id/content`, type sniffing + size limit + safe download headers), SDK `ctx.files`, `upload: true` routes, `ctx.people.names`, `defaultRoles` on declared permissions; `modules/expenses` (categories, claims with one receipt, draft → submitted → approved/rejected → reimbursed, DB-enforced immutability, batch reimburse, CSV export, auto-approve workflow action) + UI and dashboard card. Module nav icons.
2. Verify: `scripts/local-pg.sh start`; `TEST_DATABASE_URL=... pnpm test`; `pnpm --filter @office/web build:e2e && TEST_DATABASE_URL=... pnpm --filter @office/web e2e`.
3. Next (Session 8): `modules/scheduling` (bookable resources/services, availability, bookings, public booking link?). Decide: public (unauthenticated) booking pages in v1 or members-only?
4. Open: blob sweep for orphaned keys (tx rollback after put); antivirus scanning hook for uploads; multi-line expense reports and mileage; rebill expenses to customers via invoicing.
5. Open (carried): contacts `companyId` filter; CRM owner picker; core email/notifications; route-level code splitting (bundle ~500 KB).

## Handoff (Session 6, archived)
1. Done: `modules/crm` (stages, deals, won/lost/reopen, activities + tasks, board/summary, 7 events, 2 workflow actions, consumes `invoicing.invoice.paid`); UI board (drag and drop) + list + deal page + contact/company tabs + dashboard card. Shell: companies list/detail with module tabs. Invoicing 1.1.0: company tab, `source` in event payloads.
2. Verify: `scripts/local-pg.sh start`; `TEST_DATABASE_URL=... pnpm test`; `pnpm --filter @office/web build:e2e && TEST_DATABASE_URL=... pnpm --filter @office/web e2e`.
3. Next (Session 7): `modules/expenses` (expense claims + receipts, categories, approval flow, reimbursement status). Receipts need the deferred core document upload (S3 presign): build that core piece first in the same session, or store receipts later?
4. Open: core contacts list has no `companyId` filter (company page filters client-side, max 100); owner picker in CRM UI; core notifications/email for task reminders and invoice sending.
5. Open: bundle is now ~480 KB; add route-level code splitting for module UI.

## Handoff (Session 5, archived)
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
