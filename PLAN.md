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
| 10 | Module: HR (profiles + directory, org chart, leave allowances from Schedule, documents with expiry reminders, onboarding/offboarding checklists, restricted pay) | ✅ done (160 unit/integration + 54 E2E green) |
| 11 | Module: Inventory & Purchasing (items, stock moves with reasons, low-stock alerts, POs per supplier, receiving) | ✅ done (129 unit/integration + 44 E2E green) |
| 12 | Module: Docs & e-sign (library with folders, PDF + template requests, boxes on pages, signing order, emailed or copied links, reminders/expiry, signed copy + certificate, Contacts + HR links, public signing page) | ✅ done (174 unit/integration + 58 E2E green) |
| 13 | Module: AI email/meeting summaries (Claude with the company's own key; pasted notes or uploaded transcripts; action items → Tasks; follow-up email draft; support ticket recap + suggested reply; Contacts + Deals links; usage and monthly limit) | ✅ done (188 unit/integration + 62 E2E green) |
| 14 | Module: KPI dashboard (shared boards, live numbers from every feature via the new metrics contract, week/month/quarter/year, compare with the period before or last year, targets, trend charts, hand-typed numbers, weekly email per board, dashboard widget) | ✅ done (202 unit/integration + 66 E2E green) |
| 20 | Program owner: businesses created, listed, paused and reactivated by the program owner; self sign-up switch | ✅ done (217 unit/integration + 69 E2E green) |
| 21 | Features per business, chosen by the program owner | ✅ done (218 unit/integration + 70 E2E green) |
| 22 | Program owners managed in the app: co-owners, transfer, history | ✅ done (222 unit/integration + 71 E2E green) |

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

## Session 24, deleting a business
- Program admin → a business's **⋯ → Delete business…**: type the business name, then **enter your password again** on the sign-in page ("Confirm it's you"); the business is deleted as soon as you come back.
- Office never sees the password: the app asks the sign-in service to sign in again (`prompt=login`, `max_age=0`) and the API only accepts `POST /platform/businesses/:id/delete {confirmName}` when the token's `auth_time` is less than 5 minutes old (else 403 `reauth_required`). The dev sign-in server now sets `auth_time`.
- Deleted = `tenants.status = 'deleted'`: gone for everyone (not listed, members get 404, API keys and scheduled work stop, open invitations revoked). The records stay in the database; permanent erasure isn't built yet. Audited as `tenant.deleted`.
- Pause / Reactivate (Session 20) is unchanged and is the reversible option.

## Session 23, local accounts with passwords
- The local sign-in server (`pnpm dev:oidc`) now uses real accounts: email + password (scrypt, 5 tries per 15 minutes, then locked for 15 minutes). Accounts and the signing key are kept in `.dev-accounts.json` (git-ignored), so sign-ins survive restarts. `DEV_OIDC_PASSWORDS=off` brings back the old any-email sign-in (E2E uses it).
- Nobody types a password for someone else: people get a one-time **Set your password** link (7 days). It's added to emails for people without a password: business invitations, owner invitations, "you're now an owner" (co-owner added) and the new **"you're now the owner"** email on transfer.
- **Forgot password** (`/forgot-password`, linked from the sign-in screen): `POST /auth/forgot-password` emails a link; it always answers the same, so it never shows which emails have accounts.
- Office asks the sign-in service for links through `IDP_ADMIN_URL` + `IDP_ADMIN_SECRET` (`apps/api/src/identity.ts`); Office never sees passwords. A Keycloak version of the same interface is needed for production.
- `pnpm --filter @office/api owner:welcome <email>` re-sends a program owner the ownership email with the link.
- Tests: api 152 (password links 5); 227 unit/integration; 71 E2E.

## Session 22, program owners managed in the app
- Program owners live in the database (migration 0009 `platform_admins`, plus append-only `platform_audit`). `PLATFORM_ADMIN_EMAILS` only fills the list on first start (when it is empty); after that it's managed at Program admin → **Program owners**.
- **Add co-owner** (by email; emailed; active once they sign in with that verified address), **Remove** / **Step down**, **Transfer ownership** (the new owner must have signed in once, so a typo can't lock everyone out; you step down). The program always keeps at least one owner who has signed in.
- API: `GET/POST /platform/owners`, `DELETE /platform/owners/:id`, `POST /platform/owners/transfer`.
- Local email: dev server reads `MAIL_SMTP_URL`/`MAIL_FROM` from `.env.local` (git-ignored); spaces in the SMTP URL are ignored (Google shows app passwords with spaces).
- Tests: api 147 (owner 12); 222 unit/integration; 71 E2E.
- Recovery if every owner is lost: insert a row into `platform_admins` as the database owner.

## Session 21, features per business
- Program admin → a business's **⋯ → Choose features**: "All features" (default, includes features added later) or a list. Ticking a feature also ticks what it needs. Saving turns off features the business was using that are no longer included (data kept) and says which.
- The business sees those features as "Not included, ask the program owner" on Add features; turning one on answers 403 `feature_not_included`.
- API: `GET /platform/features`, `PUT /platform/businesses/:id/features {features: string[] | null}`; `/modules` items have `allowed`; business list has `allowedFeatures`. Migration 0008 `tenants.allowed_modules` (null = all). Audited as `tenant.features_set`.
- Tests: api 143; 218 unit/integration in total; 70 E2E.
- Next: billing can build on this (a price per set of features).

## Session 20, program owner and businesses
- The person running Office (the program owner) sets up each business; each business gets its own workspace, data and owner. Program owners are listed in `PLATFORM_ADMIN_EMAILS` (signed in with a verified email). `SELF_SIGNUP=false` (default) means only program owners create businesses; `true` keeps the old "anyone can create a workspace".
- `/admin` (Program admin): list of businesses (owner or open owner invitation, people, features, created, status); **New business** (name, URL, owner's email, region) creates an empty workspace and an owner invitation (emailed, or a link to copy); **Send new owner invitation**; **Pause** / **Reactivate** (data kept; members see "paused", outsiders still get 404; scheduled jobs skip paused businesses).
- The program owner is not a member and can't open a business's data (only names, owner emails, counts, feature keys). Audit rows show `platform:<email>`.
- People with no workspace see "You're not in a workspace yet" instead of onboarding when self sign-up is off.
- API: `GET/POST /platform/businesses`, `POST /platform/businesses/:id/{pause,resume,owner-invite}`; `/me` adds `platformAdmin`, `selfSignup` and each tenant's `tenantStatus`; paused tenants answer 403 `tenant_paused`. Migration 0007 adds `invitations.by_platform` (owner invitations don't depend on an inviting member).
- Tests: api 142 (owner 7); 217 unit/integration in total; 69 E2E (owner 3).
- Later: billing per business (`tenants.plan`), deleting a business, a support "view as" with the owner's consent.

## Session 19, workflows run as a person
- A workflow runs with the current access of the person who last saved it (migration 0006 `workflows.run_as`), not with full access. Module actions must declare `permission`; saving a workflow needs every step's permission; each step is re-checked when it runs; if the person left, runs fail until someone saves it again. The workflow page says whose access it runs with.
- Tests: api 135 (platform 17, incl. run-as and the SDK check); 210 unit/integration in total; 66 E2E.
- Still open from the security review: the failed sign-in counter is per API instance (move to Redis with more than one).

## Session 18, invitations
- People join a company only by accepting an invitation sent to their own address: Settings → Members → **Invite people** (email + roles) gives a link, emailed when `MAIL_SMTP_URL` and `MAIL_FROM` are set, otherwise shown to copy. The link opens `/invite/<tenant>/<token>`; the person signs in with the invited address and clicks **Accept and join**.
- Rules: 7 days; one open invitation per address (a new one replaces it); withdraw from the members page; the inviter must still hold every permission of the roles when it is accepted; only the token's SHA-256 is stored, and the token goes in request bodies, not URLs. `POST /members` (direct add) is gone.
- API: `GET/POST /invitations`, `DELETE /invitations/:id`, `POST /invitations/view`, `POST /invitations/accept`. Table `invitations` (migration 0005, RLS).
- Tests: api 134 (core 26, incl. 3 invitation tests); 209 unit/integration in total; 66 E2E (6 flows now invite and accept through the UI, helper `e2e/invite.ts`). API tests add people with `h.join(...)`.

## Session 17, security review (after the original list)
- Fixed: role and member changes now need every permission involved (admins could make a `*` role or demote owners); API keys follow their creator's current access; failed sign-ins limited per IP; concurrent document signing.
- Checked, no change needed: tenant isolation (RLS + tenant runner), SSRF guard for webhooks and HTTP actions, mail-host checks, secret sealing, file type checks, no raw HTML in the UI, public signing tokens.
- Open, not fixed:
  - ~~An admin can add any person who has signed in once, by email, without their consent.~~ Fixed by invitations (below).
  - ~~Workflows run their actions with full access.~~ Fixed in Session 19.
  - The failed sign-in counter is per API instance; use Redis once there is more than one.
- Tests: api 131 (4 new), 206 unit/integration in total; 66 E2E.

## Handoff (Session 16, KPI dashboard)
1. Done: `modules/kpi` (see its README).
   - Shared boards with tiles: value, comparison, target status and a trend chart; week/month/quarter/year with stepping; same-number-of-days comparison for running periods.
   - Hand-typed numbers (added up or latest value), targets per number and period length, weekly email per board (only the numbers each reader may see), dashboard widget.
   - Platform: the metrics contract (`metrics` in `defineModule`, `ctx.metrics.list/get`, core metrics), `ctx.people.can`, period helpers in `@office/sdk`; every earlier module now publishes its numbers in `src/metrics.ts`. See ARCHITECTURE 4.2.
2. Verify:
   - `pnpm typecheck`.
   - `TEST_DATABASE_URL=... pnpm test`: api 127, including 8 kpi tests; module-kpi 6.
   - `pnpm e2e`: 66 flows, including 4 kpi.
3. Next: the original list (rows 1–14) is finished. Pick new work with the owner.
4. Open:
   - Money numbers use each feature's default currency only; no conversion.
   - Inventory "Items low on stock" has no history (current period only).
   - Boards are company-wide; no personal boards and no per-board sharing.

## Handoff (Session 15, AI summaries, archived)
1. Done: `modules/ai` (see its README).
   - Meeting summaries from pasted notes or uploaded transcripts (VTT, SRT, text, Word): summary, key points, decisions, action items with owner and due date, open questions, follow-up email.
   - Action items become Tasks; owners are matched to team members by name.
   - Support ticket panel (recap + suggested reply), a Contacts tab and a Deals side panel.
   - Claude via `@anthropic-ai/sdk` 1.6.0 with structured JSON output; the company's own key is a module secret; model, language and monthly token limit in settings; usage page with a cost estimate.
   - Platform: `ModuleError` `keepChanges` (commit, then answer with the error) and `host.Slot` (module pages render other modules' `entity.*` slots); see ARCHITECTURE 4.2 and 4.4.
2. Verify:
   - `pnpm typecheck`.
   - `TEST_DATABASE_URL=... pnpm test`: api 119, including 7 ai tests; module-ai 7.
   - `pnpm e2e`: 62 flows, including 4 ai. The tests and `pnpm --filter @office/api dev:local --fake-ai` use a fake Claude server, so no key or credit is needed.
3. Next on the original list: KPI dashboard (row 14).
4. Open:
   - No audio recording or speech-to-text: notes and transcripts only.
   - No email-thread summaries outside Support tickets.
   - The `ctx.ai` helper in ARCHITECTURE 4.2 is still not built; this module calls Claude itself.

## Handoff (Session 14, Docs & e-sign, archived)
1. Done: `modules/docs` (see its README).
   - Library: any file up to 7 MB, folders, search, team or private visibility.
   - Signature requests from a PDF or a text template with fill-ins. Signature, initials, name, date and text boxes are placed on the pages, with optional signing order and a message.
   - Private signing links, emailed through the company's SMTP or copied by the sender. Reminders and expiry run in the hourly `reminders` job.
   - The signed PDF is stamped and gets a certificate page (signers, IPs, devices, history, SHA-256 of the original).
   - Contacts tab, and HR filing (`docs.request.completed` → HR document with `source = docs`, HR migration 0002).
   - Platform: **public module routes** (`publicRoutes`, `/api/v1/public/t/:tenant/m/<key>/…`) and **public pages** (`publicPages`, `/p/:tenant/<key>/…`); see ARCHITECTURE 4.2.
2. Verify:
   - `pnpm typecheck`.
   - `TEST_DATABASE_URL=... pnpm test`: api 112, including 8 docs tests; module-docs 6.
   - `pnpm e2e`: 58 flows, including 4 docs.
3. Next on the original list: AI email/meeting summaries (row 13), KPI dashboard (row 14).
4. Open:
   - Simple e-signature only (no PAdES/qualified certificates).
   - Standard PDF fonts: Western European letters only.
   - No bulk send, and no signer identity check beyond the link (e.g. an email code).

## Handoff (Session 13, HR, archived)
1. Done: `modules/hr`.
   - Profiles for workspace members: job, department, manager, employment, dates.
   - Private details (date of birth, contact details, emergency contact, hours, allowance) visible only to HR and the person. HR notes are for HR only.
   - Directory and org chart; reporting loops are refused.
   - Leave ledger. Approved and cancelled Schedule time off flows in through events (working days, split per year), plus manual carry-over, adjustments and leave.
   - Documents (PDF, images, docx, at most 7 MB, content checked) with expiry reminders (`hr.document.expiring`).
   - Checklist templates. Tasks are owned by the person, their manager or HR, with relative due days.
   - Pay history: `hr:pay.manage` is for admins and owners only. Events never carry amounts.
   - Dashboard widget: away today, birthdays and anniversaries, my tasks, expiring documents.
   - Scheduling now emits `scheduling.time_off.cancelled`.
2. Verify:
   - `pnpm typecheck`.
   - `TEST_DATABASE_URL=... pnpm test`: api 104, including 8 hr tests; module-hr 2.
   - `pnpm e2e`: 54 flows, including 4 hr.
3. Next on the original list: Docs & e-sign (row 12), AI summaries, KPI dashboard.
4. Open:
   - Public holidays and part-time working patterns in leave counting (today: Monday to Friday).
   - Back-filling time off approved before HR was turned on.
   - Labour cost in Hours, using pay.
   - Employees without a workspace login.

## Handoff (Session 12, archived)
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
