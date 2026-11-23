# Going live: checklist

Hosting is not covered here yet (decided to wait). Everything below is what has to be true before real customers pay.

## 1. Money: Stripe live mode and your bank account  (you do this; it can't be done for you)
Your bank details are entered **only in Stripe**, never in Office. Stripe pays out to your bank account.
1. In the Stripe dashboard click **Activate account** (or switch off Test mode).
2. Fill in the business details Stripe asks for: company name, address, company/VAT number, who owns and runs it, a website address, and what you sell.
3. **Add your bank account** (IBAN) under Settings → Payouts (or in the activation form). This is where your money goes. Stripe may ask for an ID document.
4. Set the statement descriptor (what customers see on their bank statement) and your support email and phone under Settings → Public details.
5. Create the **live** price again (products made in test mode don't exist in live mode): Product catalogue → Add product → monthly → EUR 49.99. Copy its new `price_` id.
6. Create the **live** webhook: Developers → Webhooks → Add endpoint → `https://YOUR-API-ADDRESS/api/v1/stripe/webhook`, events `checkout.session.completed`, `invoice.payment_failed`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`. Copy its signing secret.
   Also set what Stripe does when every retry fails: Settings → Billing → Subscriptions and emails → "Manage failed payments" → retries on (for example 3 attempts over about 2 weeks) and, when all fail, **cancel the subscription** (or mark it unpaid). That is when the 90-day deletion clock starts. Office pauses the business on the *first* failed payment and emails the owner by itself; you can switch off Stripe's own failed-payment emails if you don't want two.
7. Turn on the **customer portal** in live mode: Settings → Billing → Customer portal. Allow "Cancel subscriptions" with **cancel at the end of the billing period**, and "Update payment method" and "View invoice history". This is what the *Manage subscription* button opens.
8. Put the live values where the API runs (never in git or chat): `STRIPE_SECRET_KEY=sk_live_...`, `STRIPE_WEBHOOK_SECRET=whsec_...`, `STRIPE_PRICE_ID=price_...`, `STRIPE_PRICE_LABEL=EUR 49.99 per month`.
9. Make one real payment yourself with your own card, check the business appears, then cancel it and refund yourself in Stripe.

## 2. Legal pages
1. Open `apps/web/src/legal/company.ts` and replace everything still in [SQUARE BRACKETS]: the **business address** (Spanish law expects a service provider to show one; use a business address, not your home, if you prefer; ask your gestor whether you can register one) and the hosting provider. Name, tax ID, Spanish governing law and the AEPD are filled in. While any bracket is left, the pages show a draft warning.
   Also set `CONTACT_EMAIL` where the API runs, so "Contact support" (owners and admins only) works; it needs mail set up too.
2. Have a lawyer (or at least an experienced person) read the Terms and Privacy Policy once. They are a careful draft, not legal advice.
3. If you change the text, change the date `version` in `company.ts` **and** `TERMS_VERSION` in `apps/api/src/routes/billing.ts`. The version a customer agreed to is stored on their Stripe subscription.
4. Stripe also asks for links to your terms and privacy policy: use `https://YOUR-APP/terms` and `https://YOUR-APP/privacy`.

What the Terms say about money: monthly, paid in advance, renews automatically; the customer can cancel any time and keeps full use until the end of the paid month; **no refunds**, except where the law forces one. Note that in the EU a "no refunds" clause is generally fine between businesses (the Terms say the Service is for businesses only) but does not override a consumer's legal rights.

## 3. Sign-in service
See `docs/keycloak-setup.md`. Needs working outgoing email.

## 4. Still open
- **Hosting** (API, worker, web app, Keycloak, database): decided to wait.
- **Deleting data** is automatic now (30 days after a business is deleted, 90 days after a subscription ended), checked every 6 hours while the API runs. Test it once on the real server with a throwaway business (delete it, backdate `deleted_at`, wait for the run).
- VAT on invoices to your customers (Stripe Tax) and a Data Processing Agreement to hand to customers who ask.
