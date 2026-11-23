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

**Updated (same day):** the front door is Office's own server, not Vercel (Vercel's Hobby plan is for non-commercial use, and Office is commercial). At cutover the root records point at the Office server; its Caddy forwards `/web`, `/proxy`, `/app`, `/downloads`, `/pay`, `/.well-known` and Bibi's own files under `/assets/` to Bibi's Vercel project (`bibi-livid.vercel.app`) and serves Office for every other path. The rules are written in `infra/prod/Caddyfile.cutover`. Result: Office is what people see at `bibidesk.com`; the Android app, browser version, Paddle page and APK keep working with no new Android release. Vercel stays as Bibi's backend only.

1. **Safety first (no change to the live site).** Done: public files copied to `Desktop\bibidesk-site-backup`, DNS list saved. To do: put `Desktop\Bibi` and `C:\Users\vecti\BibiApp` in Git, copy `BibiApp\bibi-server-secrets.txt` somewhere safe (never into Git).
2. **Give Bibi's homepage its own address.** In Vercel project `bibi` -> Domains add `bibi.bibidesk.com`; in Namecheap add CNAME `bibi` -> the Vercel target Vercel shows. Check it loads. Update links that mention the homepage (Paddle, Resend, app store pages) later if needed.
3. **Host Office** on one server (`infra/prod/README.md`) and test it on its own addresses `office.`, `office-api.` and `office-auth.bibidesk.com` (new DNS records only), with Stripe test keys first.
4. **Prepare the front door.** On the server, enable the `bibidesk.com` block from `Caddyfile.cutover` and add `bibidesk.com` / `www` to the website list. Test it before touching DNS by sending a request to the server's IP with the right Host header (`curl --resolve bibidesk.com:443:SERVER_IP https://bibidesk.com/web/` and the other Bibi paths).
5. **Cut over.** In Namecheap, change the A records for `@` (and the `www` CNAME) from Vercel to the server's IP. Everything else stays. The change takes minutes to hours to spread; the old Bibi homepage keeps working on `bibi.bibidesk.com`.
6. **Office settings for the domain** (set where the API / web app run): `APP_URL=https://bibidesk.com`, `CORS_ORIGINS=https://bibidesk.com`, `VITE_API_URL=https://office-api.bibidesk.com`, `OIDC_ISSUER=https://office-auth.bibidesk.com/realms/office`, `KEYCLOAK_URL=https://office-auth.bibidesk.com`, Keycloak `OFFICE_APP_URL=https://bibidesk.com`. Stripe: website `https://bibidesk.com`, webhook `https://office-api.bibidesk.com/api/v1/stripe/webhook`.
7. **Check after cutover:** Bibi homepage on its new address; `bibidesk.com/web/` sign-in; the Android app opens; `bibidesk.com/.well-known/assetlinks.json`; a Paddle test payment; `hello@bibidesk.com` still forwards and Resend still sends; Office `/start`, `/terms`, `/privacy`; one test subscription.

## Rollback
Change the Namecheap A records for `@` and the `www` CNAME back to the Vercel values listed in `Desktop\bibidesk-site-backup\README.txt`; Bibi's homepage is back as soon as DNS spreads (the Vercel project is never touched).

## Risks to keep in mind
- The root URL `/` changes from the Bibi homepage to Office. Anything that links to the homepage lands on Office until updated.
- Vercel's **Hobby** plan is limited to non-commercial use. Office no longer runs on Vercel, but Bibi (which sells through Paddle) still does: consider the Pro plan for Bibi.
- Both legal pages and both businesses show one person (the legal name). If they should be presented separately, that is a legal question for your gestor.
