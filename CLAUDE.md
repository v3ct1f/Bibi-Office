# Bibi Office: notes for Claude

Read this first, then `PLAN.md` (what's built, newest session first) and `ARCHITECTURE.md` (how it fits together).
Each feature has its own README in `modules/<name>/`.

## What this is
"Office": a multi-business back-office app. A **program owner** (Program admin at `/admin`) creates and runs
businesses; each business turns on **features** (modules: CRM, Leads, Invoicing, Expenses, Scheduling, Support, HR,
Inventory, Docs & e-sign, AI summaries, KPI). TypeScript monorepo: pnpm + Turborepo, Fastify API (`apps/api`),
worker (`apps/worker`), React 19 web app (`apps/web`), Postgres with row-level security, Zod 4, Drizzle.

## How the user works
- Explain things in plain language; the user is not a developer. Short answers, no jargon.
- Commit each finished step locally. **Push only when the user says so.**
- Keep `PLAN.md` (new "## Session N" section at the top of the session list) and `ARCHITECTURE.md` up to date.
- Modules never import each other; they talk through events (`ctx.events.emit` + `subscribes`/`handlers`).
- Never put passwords, API keys or customer data in chat, commits or outside services. Mail settings and the
  Gmail app password live only in the git-ignored `.env.local`; local sign-in accounts in `.dev-accounts.json`.

## Running it locally (Windows)
pnpm isn't installed globally. Use corepack (once): `corepack enable`, or `npm i -g pnpm@10.28.0`.
`.claude/launch.json` may point at an old temporary pnpm path; if a server won't start, change
`runtimeExecutable` to `pnpm` (or `pnpm.cmd`).

```
pnpm install
scripts/local-pg.sh start          # Postgres on :55432 (or use the one already running)
pnpm dev:oidc                      # sign-in server   http://localhost:8081
pnpm dev:local --port 3100         # API (migrates + installs modules on start)
pnpm dev:local-worker              # worker (events, CRM deals from Leads, emails)
pnpm dev:web                       # app              http://localhost:5173
```
After changing API or sign-in server code, those two must be **restarted** (the web app reloads by itself).
A "Route not found" error in the app almost always means the API is still running old code.

## Tests
```
TEST_DATABASE_URL=postgres://office_owner:office_owner@localhost:55432/postgres pnpm test   # API + modules
cd apps/web && npx playwright test --trace off --reporter=line                                # browser flows
```
The browser tests start their own servers on ports 5183/3103/8093/3193/3197; wait if another run holds them.
Owner flows check a feature count ("10 of 11 included"); adding a feature changes it.

## Where things stand (2026-11-23)
- Branch `claude/youthful-hypatia-4bnse8`, several commits ahead of GitHub (not pushed).
- Session 35: paying owners create their own account and business (`/plans` -> `/start` -> payment -> email -> `/new-business`); without Stripe keys locally the payment is a demo page (nothing charged); Program admin invites owners instead of creating businesses.
- Latest work: Leads (Session 25), program owner viewing businesses (26), Colleagues (27: owner creates a
  worker's account with a starting password; the worker picks their own at first sign-in), and deleting a
  business now only needs its name typed.
- Ideas not built yet are listed under "Not yet" in each module README.
