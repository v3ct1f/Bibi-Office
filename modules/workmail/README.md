# Work email (`@office/module-workmail`)

A paid extra: a business gets its own company domain (like `tribulis.com`) and work mailboxes for its colleagues
(`anna@tribulis.com`). We buy and set up the domain and its DNS settings for them, so the owner never touches DNS.
A business can also connect a domain it already owns (we show the few records to add and check them).

**Status: built and tested with a pretend provider only. No real provider is connected yet** (see "Before real use").

## What the owner sees
1. **Turn it on**: a tick box at sign-up ("Add work email and a company domain (+price)"), or later from Colleagues
   ("Give them a work email? Turn on Work email") or Add features. Turning it on adds the extra price to the subscription.
2. **Get a domain**: search a name, see if it's free and what it costs per year, fill in the business's details, pay.
   The domain is registered **in the business's own name** (the registrant), so it belongs to them.
3. **Connect a domain I own**: the page shows the records (MX, SPF, DKIM) to add at their own registrar and a "Check now" button.
4. **Add colleague** can create the mailbox in the same step (tick "Give them a work email"). The mailbox password is shown once and never stored.
5. **Remove the colleague**: their mailbox is switched off (mail stops; nothing is deleted; the owner can switch it back on or delete it).
6. **Take it with you**: "Take it with you" shows the domain's transfer code (after the 60-day lock every new domain has). Connected domains never left their own registrar.

## Model
```
domain (bought: awaiting_payment -> active | connected: dns_pending -> active | removed)
  └─< mailbox (active | suspended | deleted; optional user_id = the colleague it belongs to)
```
- Domain names are unique across all businesses (partial unique index); a name another business holds answers "already taken".
- **Removing a domain** (`POST /domains/:id/remove {confirm}`; needs `core:modules.manage` too): the name must be typed. Its mailboxes are switched off
  (`domain_removed`, mail kept, not billed, can't be resumed). A connected domain is disconnected; a bought one stays registered to the business
  until it expires, **not renewed, not refunded**, shown as "Removed, not renewed" and still movable with "Take it with you".
- **Cancel Work email** (button on the page, and Add features): "cancel" typed; the add-on and its charge go, data is kept, adding it again restores everything.
- Up to `maxMailboxes` (setting, default 10) live mailboxes per business.
- Mailbox owners must be active members. People without `workmail:mailbox.write` see only their own mailbox.
- `suspend_reason`: `colleague_removed`, `feature_off` (feature turned off, resumes when turned back on), `by_hand` or `domain_removed` (never resumes by itself).

## Provider interface (swap the company without touching the module)
`src/provider.ts` defines `WorkmailProvider`: `searchDomains`, `registerDomain` (registrant = the business; sets mail DNS itself),
`requiredRecords`, `checkDns`, `transferOutCode`, `createMailbox`, `webmailUrl`, `setMailboxActive`, `deleteMailbox`, `setMailboxPassword`,
and `WorkmailPayments` (`chargeDomain` -> paid now, or redirect to a payment page; `isPaid`). The server wires them in once with
`configureWorkmail({ provider, payments })`. With no provider the feature says "isn't set up on this server yet".

`fakeProvider()` (`src/fake-provider.ts`) is the pretend one used by tests and local use. Its rules: names containing `taken` and big brands
(google, microsoft...) are not free; prices (EUR, first year) `.com` 19, `.net` 22, `.org` 20, `.eu` 15, `.io` 55; a domain whose first label starts
with `dns-ok` already has its records, others do not until `setDnsOk(domain)` (domains it registers do); it records every call in `calls`,
and `failNext("registerDomain")` makes the next call of that name fail once.

## Paying
- **What it costs (one rule, Session 38):** turning Work email on costs nothing; **each mailbox costs EUR 3 per month** (from `WORK_EMAIL`
  in `packages/core/src/plans.ts`) until it is deleted; a domain is paid once a year. `maxMailboxes` is only the most a business can have.
  Every screen that makes a mailbox says the price first and after ("This adds EUR 3 per month to your subscription" / demo / no charge).
  The platform keeps the Stripe line's quantity equal to the number of mailboxes (`WorkmailPayments.mailboxesChanged`); if that fails the
  mailbox is taken back.
- **The extra monthly price** is handled by the platform (`apps/api/src/addons.ts`, `routes/addons.ts`, not by this module): it adds a second
  Stripe subscription item (`STRIPE_WORKMAIL_PRICE_ID`), stores `tenants.addons`, and enables this module. At sign-up the same price is a second
  checkout line. Removing it deletes the item. Businesses without a Stripe subscription (created by the program owner) or servers without the
  price pay nothing extra. "Add features" refuses to switch it on without going through that step (HTTP 402) when it costs money.
- **The domain** is a one-off yearly payment on Stripe Checkout (`mode=payment`). The module stores the checkout id; when the owner comes back
  (`?order=<id>`) the page calls `POST /domains/:id/confirm`, which asks Stripe whether it was paid and then registers the domain. Pulling the
  status (instead of a webhook) means nothing is lost if the owner closes the tab: "Check payment" retries. Without Stripe (local use) it is paid at once.
- Domain **renewals are not automated yet** (see "Not yet").
- **Selling prices** live in one place, `WORK_EMAIL` in `packages/core/src/plans.ts` (domain EUR 19 per year, mailbox EUR 3 per month). The API
  wraps the provider so a domain is never quoted below that (`withOurDomainPrice`, `apps/api/src/app.ts`).
- **At sign-up** (demo payments only for now): the "Add work email" step (`/start/email`) records mailboxes and the wanted domain; the new
  business starts with this feature on, and the Work email page opens with `?want=<domain>`, which opens **Get a domain** already searched.

## API (`/api/v1/m/workmail`)
| Method | Path | Permission |
|---|---|---|
| GET | `/config` · `/domains` · `/mailboxes?domainId` | `workmail:mailbox.read` (mailboxes: own only without write) |
| GET | `/domains/search?q=` | `workmail:domain.manage` |
| POST | `/domains/order { domain, registrant, returnPath }` · `/domains/connect { domain }` · `/domains/:id/confirm` · `/domains/:id/check` · `/domains/:id/transfer-out` · DELETE `/domains/:id` | `workmail:domain.manage` |
| POST | `/mailboxes { domainId, localPart, name, userId? }` (returns the password once) · `/mailboxes/:id/suspend` · `/resume` · `/reset-password` · DELETE `/mailboxes/:id` | `workmail:mailbox.write` |

Platform side (needs `core:modules.read` / `core:modules.manage`): `GET /billing/addons`, `POST|DELETE /billing/addons/workmail`.
Provider problems answer 424 with a plain message (the platform hides 5xx details). Roles: manager read + write, member read (own mailbox); owner/admin everything incl. domains.

## Events (payload v1)
Emits `workmail.domain.registered { id, domain, source, expiresOn }`, `workmail.mailbox.created { id, address, domain, userId }`,
`workmail.mailbox.suspended { id, reason, userId }`, `workmail.mailbox.deleted { id, userId }`.
Subscribes to `core.member.removed` (suspends that person's mailboxes). Turning the feature off pauses all mail, on resumes what it paused (lifecycle).
Also answers Mail's `mail.mailboxes.requested { userId | null }` by replaying `workmail.mailbox.created { ..., status, replay: true }` for each mailbox that belongs to a person (all, or that one person), so mailboxes made before Mail was on get linked.
Audit: `workmail.domain.bought`, `.domain.connect_started`, `.domain.connected`, `.domain.transfer_code_shown`, `.domain.removed`, `.mailbox.*`.

## UI slots
Work email page (`nav.main`, `/email`: domains, mailboxes, buy / connect / transfer dialogs). Core pages: the Start page tick box, the Colleagues
"Add colleague" dialog (tick box, or "Turn on Work email" offer), and a price confirmation on Add features.

## Server settings
`WORKMAIL_PROVIDER=fake|off` (default: `fake` while developing, `off` in production), `STRIPE_WORKMAIL_PRICE_ID`, `STRIPE_WORKMAIL_PRICE_LABEL`
(e.g. `EUR 9 per month`; the Stripe test price must be a recurring monthly price). Both Stripe values also go in `.env.local` for local runs.

## Before real use (nothing below is done)
1. Pick and sign up with a provider (research and prices: `work-email-providers.md` in the session notes; recommended: ResellerClub for domains + Titan Email),
   get the reseller account, API keys and the real wholesale prices.
2. Write the real `WorkmailProvider` (a new file next to `fake-provider.ts`) and choose it with `WORKMAIL_PROVIDER`. **The worker must be given the same provider**
   (it runs the "colleague removed" handler; with no provider it only marks the mailbox off in Office and the provider keeps delivering mail). Not wired yet.
3. Stripe prices matching `WORK_EMAIL` (per mailbox per month; the domain per year), then offer the sign-up step with Stripe too. The domain price shown is our price (at least EUR 19), the provider's if higher; it assumes the provider quotes euros.
4. Domain renewals each year: a scheduled job to renew with the provider and charge (or remind) the owner, plus a failed-renewal warning.
5. Check registrar rules for the endings you sell (some need local contact or ID), and add a line about domains and mailboxes to the Terms.
6. Mailbox password handling at the real provider, and what happens to mail at the provider when a business is deleted or its subscription ends.
7. Real Stripe test-mode run of the add-on item and domain payment (only faked so far).

## Not yet
Aliases and forwarding, shared inboxes, domain renewals and expiry reminders,
catch-all, webmail single sign-on, moving a mailbox between colleagues, importing existing mail.
