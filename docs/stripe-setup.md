# Setting up paid sign-up (Stripe)

Stripe has no monthly fee. You pay only a small cut of each payment. Start in **test mode** (no real money), then repeat with live keys.

## 1. Account and product
1. Make a free account at stripe.com. Stay in **Test mode** (switch at the top of the dashboard).
2. Product catalogue -> **Add product** -> name it (e.g. "Office business account") -> price **Recurring**, monthly, your amount -> Save.
3. Open the price and copy its id (starts with `price_`).

## 2. Keys
Developers -> API keys -> copy the **Secret key** (`sk_test_...`).

## 3. Webhook
- Local testing: install the Stripe CLI, then `stripe listen --forward-to localhost:3100/api/v1/stripe/webhook`. It prints a signing secret (`whsec_...`).
- Live: Developers -> Webhooks -> Add endpoint -> `https://YOUR-API-ADDRESS/api/v1/stripe/webhook`, events `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. Copy its signing secret.

## 4. Put them in `.env.local` (never in chat or git)
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...
STRIPE_PRICE_LABEL=EUR 49.99 per month
```
Restart the API. Open `http://localhost:5173/start`, give an email and pay with Stripe's test card `4242 4242 4242 4242` (any future date, any CVC). That email gets "Welcome to Office: create your account" (set a password, then sign in). After signing in they land on **Create your business** (name, web address, region) and are its owner. Until then Program admin shows them under **Waiting to set up** (Paid).

## Before taking real money
Use live keys, a public API address with HTTPS, working email (Gmail app password is fine to start), and add your terms and privacy policy (Stripe asks for them). Customers can manage or cancel their subscription from a Stripe customer portal link (Stripe dashboard -> Settings -> Billing -> Customer portal).

## Optional: the Work email extra
In the same Stripe product catalogue add a second **recurring monthly, per-unit** price: "Work email mailbox", **EUR 3 per unit** (the same
number as `WORK_EMAIL.mailboxPerMonth` in `packages/core/src/plans.ts`; change both together). Office sets the quantity to the number of mailboxes
(starting at 0 when Work email is turned on). Try it in Stripe test mode first. Put it in `.env.local`:
```
STRIPE_WORKMAIL_PRICE_ID=price_...
STRIPE_WORKMAIL_PRICE_LABEL=EUR 3 per mailbox per month

**Cancelling / removing a domain (before going live).** Removing a domain lowers the line's quantity and cancelling Work email removes the line;
both use `proration_behavior: create_prorations`, so Stripe credits the unused part of the month on the next invoice (the screens say so). If you
would rather it ran to the end of the period, use a subscription schedule instead. A bought domain is only "not renewed" in Office today: once a real
domain provider is wired in, switch its auto-renew off at the provider when a domain is removed. Test both in Stripe test mode first.
```
Before going live with Work email at sign-up: the "Add work email" step (prices in `packages/core/src/plans.ts` `WORK_EMAIL`: EUR 3 per mailbox per month, EUR 19 per domain per year) is only offered with demo payments. With Stripe it needs a per-mailbox monthly price (quantity = mailboxes) and the checkout lines added; until then owners add Work email from Add features after sign-up.

Without it the extra is free where turned on. Domains are one-off payments created on the fly (no product needed). Work email also needs a provider (`WORKMAIL_PROVIDER`, see `modules/workmail/README.md`); only a pretend one exists so far.
