# Moving bibidesk.com to Office

Decision (2026-11-23): Office gets the root domain `bibidesk.com`; Bibi's homepage moves to a subdomain.
**Nothing has been changed yet. No DNS or Vercel setting is touched until Office is hosted and tested.**

## What bibidesk.com does today (inventory)
Bibi's Vercel project `bibi` (account `vectiff-7549`, Hobby plan, no Git, deployed with `vercel deploy`) serves:
| Path | What it is | Must keep working? |
|---|---|---|
| `/` , `/style.css`, `/main.js`, `/assets/*` | Bibi for Windows homepage | moves to `bibi.bibidesk.com` |
| `/terms.html`, `/privacy.html`, `/refund.html` | Bibi's legal pages | move with the homepage (Paddle/Stripe may link to them: check) |
| `/web/*` | Bibi in the browser | **yes** |
| `/proxy/*` -> `api/web-proxy.js` | forwards sign-in and AI chat of the browser version to `bibi-accounts.vercel.app` | **yes** |
| `/app/*` | Bibi phone web app, loaded by the Android app | **yes** |
| `/downloads/Bibi.apk` | Android app download | **yes** |
| `/.well-known/assetlinks.json` | ties Android app `app.bibi.mobile` to bibidesk.com | **yes** (without it the Android app stops verifying) |
| `/pay/*` | Bibi's payment page used by Paddle | **yes** |
Also: the Windows installer is in Vercel Blob storage (own address, unaffected); the Windows app talks to `bibi-accounts.vercel.app` and `bibi-livid.vercel.app`, not to bibidesk.com.

Email on this domain must keep working: `hello@bibidesk.com` forwards to Gmail (Namecheap email forwarding) and Bibi's mail is sent through Resend. Do not touch: TXT `@` (SPF), TXT `_dmarc`, TXT `resend._domainkey`, CNAME `send`, CNAME `rsend`.

## Plan: Office owns the root, Bibi keeps its functional paths
Bibi's source of truth is on your PC (`Desktop\Bibi`: `website\`, `web-app\`, plus `C:\Users\vecti\BibiApp\build\site` = what was deployed). It is **not in Git**; `C:\Users\vecti\BibiApp` is outside OneDrive. Put both in Git (private GitHub repo) before changing anything.

The root domain's front door stays the Vercel project `bibi`. Its `vercel.json` keeps serving `/web`, `/proxy`, `/app`, `/downloads`, `/pay`, `/.well-known` as today, and sends every other path (`/`, `/start`, `/terms`, `/privacy`, `/t/...`, `/api/v1/...`) to Office. Result: Office is what people see at `bibidesk.com`; the Android app, browser version, Paddle page and APK keep working with no new Android release.

1. **Safety first (no change to the live site).** Done: public files copied to `Desktop\bibidesk-site-backup`, DNS list saved. To do: put `Desktop\Bibi` and `C:\Users\vecti\BibiApp` in Git, copy `BibiApp\bibi-server-secrets.txt` somewhere safe (never into Git).
2. **Give Bibi's homepage its own address.** In Vercel project `bibi` -> Domains add `bibi.bibidesk.com`; in Namecheap add CNAME `bibi` -> the Vercel target Vercel shows. Check it loads. Update links that mention the homepage (Paddle, Resend, app store pages) later if needed.
3. **Host Office** (separate decision: where) and test it on its own temporary address, with live Stripe test keys first.
4. **Build the front door.** In `bibi`'s `vercel.json` add rewrites: for every path not in the Bibi list above, forward to Office's address. Deploy to a preview URL and test the Bibi paths (browser version, `/app/`, APK, `assetlinks.json`, `/pay/`) and Office pages.
5. **Cut over.** Deploy to production. Because `bibidesk.com` already points at this Vercel project, **no DNS change is needed** for the root; only Office's own subdomains (API, sign-in) get new records.
6. **Office settings for the domain** (set where the API / web app run): `APP_URL=https://bibidesk.com`, `CORS_ORIGINS=https://bibidesk.com`, `VITE_API_URL=https://office-api.bibidesk.com`, `OIDC_ISSUER=https://office-auth.bibidesk.com/realms/office`, `KEYCLOAK_URL=https://office-auth.bibidesk.com`, Keycloak `OFFICE_APP_URL=https://bibidesk.com`. Stripe: website `https://bibidesk.com`, webhook `https://office-api.bibidesk.com/api/v1/stripe/webhook`.
7. **Check after cutover:** Bibi homepage on its new address; `bibidesk.com/web/` sign-in; the Android app opens; `bibidesk.com/.well-known/assetlinks.json`; a Paddle test payment; `hello@bibidesk.com` still forwards and Resend still sends; Office `/start`, `/terms`, `/privacy`; one test subscription.

## Rollback
Step 4/5 is one `vercel.json` deploy: redeploy the previous deployment (Vercel -> Deployments -> the old one -> Promote) to put the Bibi homepage back at once. DNS records are listed in `Desktop\bibidesk-site-backup\README.txt` for restoring.

## Risks to keep in mind
- The root URL `/` changes from the Bibi homepage to Office. Anything that links to the homepage lands on Office until updated.
- Vercel's **Hobby** plan is limited to non-commercial use. Bibi (Paddle) and Office are commercial: plan to move the front door to a paid plan (Pro) or another host before launch.
- Both legal pages and both businesses show one person (the legal name). If they should be presented separately, that is a legal question for your gestor.
