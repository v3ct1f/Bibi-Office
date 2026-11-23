# Legal checklist (Spain / EU)

This is what the product already does, and what only a person with a licence can confirm. I am not a lawyer and nobody can make software "legal" by itself: the Terms, the Privacy Policy and how you run the business all count. **Have a gestor (tax adviser) and, ideally, a lawyer check this list once before you take real money.** Laws named below are the ones I believe apply; they change, so verify them.

## Covered in the product
| Topic | What is in place |
|---|---|
| Who you are (LSSI-CE art. 10) | Name, tax ID and email on the Terms/Privacy pages. **Missing: business address** (placeholder). |
| Terms accepted before paying | Required tickbox; the version and time are stored on the Stripe subscription. |
| Business customers only | Second required tickbox ("business or professional use"); the Terms say so. Consumer protection rules (14-day withdrawal etc.) don't apply to businesses; they would to a private person, which is why this is checked. |
| Clear price and renewal | Price on /start and on Stripe's page; Terms say monthly, in advance, auto-renewing. |
| Easy cancellation | "Manage subscription" in Settings (Stripe portal), cancel any time, access until the paid month ends. |
| No refunds | Stated in the Terms (valid between businesses; never overrides a right the law gives). |
| Failed payment | Paused at once, owner emailed a link to pay, switched back on after payment with a confirmation email; the Terms describe it. These emails are service notices, not marketing. |
| Data protection (GDPR / LOPDGDD) | Privacy Policy: controller, purposes, legal bases, processors, retention, rights, complaint to the AEPD, transfers outside the EU, security. Our role as processor for the customer's own data is stated. |
| Right to erasure | Program admin → Delete → "erase permanently now"; automatic erasure 30 days after delete and 90 days after a subscription ends; sign-in accounts removed too. |
| Data kept apart | Each business's data is separated at database level; the program owner's read-only visits are logged and disclosed in the Terms and the Privacy Policy. |
| Cookies (LSSI art. 22) | Only essential browser storage (sign-in); no tracking or advertising, so no consent banner is needed. |
| Support | Only owners and admins can contact you; the public email stays on the legal pages. |
| Card data | Never touches Office: Stripe handles it. |

## Needs you, or a professional
1. **Business address** on the legal pages (a business address is fine; ask the gestor how to register one). Without it the pages show a draft warning and you must not launch.
2. **Autónomo registration** (Hacienda and Seguridad Social) for this activity, and your own invoicing: Spanish invoices must show your name, tax ID and address.
3. **VAT (IVA):** whether the price includes VAT, how to invoice a Spanish business, an EU business (reverse charge, VAT number check) and a non-EU one. Stripe Tax can calculate it once your gestor decides the rules.
4. **Electronic invoicing rules** (Verifactu, B2B e-invoicing under the "Crea y Crece" law): ask the gestor which dates apply to you and whether Stripe invoices are enough.
5. **Data processing agreement (DPA)** template for customers who ask (GDPR art. 28). The Privacy Policy says one is available on request.
6. **Record of processing activities** and a **data breach procedure** (GDPR art. 30, 33: tell the AEPD within 72 hours of a serious breach). A one-page document each is usually enough for a small business.
7. **Spanish-language version** of the Terms if you sell to Spanish customers; ask the lawyer whether it is needed for business customers.
8. **Terms and Privacy Policy review** by a lawyer, including the liability limit and the no-refund wording under Spanish law.
9. **Stripe's own requirements:** a real support contact, refund/cancellation policy visible (they are in the Terms) and a statement descriptor; Stripe may also ask for ID before paying out.
10. **A hosting provider** named in the Privacy Policy, with a data processing agreement and EU storage if you promise EU data.

## Things to keep true
- Change `COMPANY.version` and `TERMS_VERSION` together whenever the legal text changes, and email owners before a material change (the Terms promise this).
- Don't send marketing email to customers without their consent; billing and account notices are fine.
- Delete data when asked, within a month.
