# Production sign-in service (Keycloak)

Office uses **Keycloak** for sign-in. It keeps the passwords (protected), checks them, enforces the rules (10+ characters, lock-out after 5 wrong tries) and sends the "set your password" and "reset password" emails. Office itself never stores a password.

The local sign-in server (`pnpm dev:oidc`) is for developing only and must never be used for real customers.

## What the code does
- `apps/api/src/keycloak.ts` talks to Keycloak's admin API with a small service account (`office-admin`) that may only manage users.
- **Colleague accounts** (owner types a starting password): created with a *temporary* password, so the person must choose their own at first sign-in, and with their **email not yet verified**, so they must verify the address before Keycloak lets them in. This stops a business owner from making an account in someone else's name, for example the program owner's.
- **Invitations / new owners**: if the person has no account, Office creates an empty one and Keycloak emails them a link to verify their address and choose a password. If they already have a password, nothing extra is sent.
- **Forgot password** only resets accounts that exist; it never creates one.
- Because Keycloak sends those emails itself, **Keycloak needs working SMTP** (see below). Without it, people get Office's invitation email but no set-password email.

## Switching it on
Set these where the API runs (never in git):

```
KEYCLOAK_URL=https://auth.yourdomain.com
KEYCLOAK_REALM=office
KEYCLOAK_ADMIN_CLIENT_ID=office-admin
KEYCLOAK_ADMIN_CLIENT_SECRET=<the secret you chose>
OIDC_ISSUER=https://auth.yourdomain.com/realms/office
OIDC_AUDIENCE=office-api
APP_URL=https://app.yourdomain.com
```
and for the web app build: `VITE_OIDC_ISSUER=https://auth.yourdomain.com/realms/office`, `VITE_API_URL=<api address>`.
When `KEYCLOAK_URL`, the client id and the secret are all set, they replace the dev sign-in server. `IDP_ADMIN_*` is then ignored.

## Setting Keycloak up
1. Run Keycloak 26 (`infra/docker-compose.yml` has a dev one; production needs `start` with HTTPS, a hostname and its own database, which is part of hosting).
2. Import `infra/keycloak/realm.json` (`--import-realm`). It creates the realm, the web client (PKCE), the `office-admin` service account and the rules above. Placeholders are filled from environment variables when Keycloak starts:

| Variable | Meaning |
|---|---|
| `OFFICE_APP_URL` | Address of the web app, e.g. `https://app.yourdomain.com` |
| `OFFICE_ADMIN_CLIENT_SECRET` | A long random secret for `office-admin` (also given to the API) |
| `KC_SMTP_HOST`, `KC_SMTP_PORT`, `KC_SMTP_FROM`, `KC_SMTP_USER`, `KC_SMTP_PASSWORD` | Outgoing email for password and verification emails |

3. Sign in to the Keycloak admin console, open realm **office** and check: Realm settings → Email → **Test connection**; Clients → `office-admin` → Credentials shows your secret.
4. Make sure **sign-up in Keycloak is off** (it is in the realm file): people get in only by invitation or by paying.

## Not yet tested against a real Keycloak
The adapter is tested against a pretend Keycloak (9 tests), not the real thing, because Keycloak needs Docker or Java 17+ and neither is on the development PC. When Keycloak is first running, try these four things in order: owner adds a colleague (starting password), colleague signs in and must verify email and change password; invite someone new; "forgot password"; a paid sign-up on `/start`.
