# Running Office on one server

One small Linux server runs everything in Docker: database, message queue, the API, the worker, the sign-in service
(Keycloak) and Caddy (the web app and automatic HTTPS). This folder is the whole recipe. Nothing here is a secret.

```
internet ──> Caddy (web) ──┬─ office.bibidesk.com       the Office web app
                           ├─ office-api.bibidesk.com   -> api  ──> postgres
                           └─ office-auth.bibidesk.com  -> keycloak ──> postgres (own database)
                                        worker ──> postgres, nats
```

## Costs (check the provider's current prices)
A server with about 4 GB of memory (for example Hetzner CX22/CPX21, Germany or Finland) was roughly 5 to 10 euro a month when this was written. Resend (email) has a free tier. Stripe takes its cut per payment.

## One-time setup
1. **Create the server** at your provider: Ubuntu 24.04, EU location, and paste the *public* SSH key when asked (`~/.ssh/bibi-office-deploy.pub` on your PC). Note the server's IP address.
2. **DNS (Namecheap, only new records):** A records for `office`, `office-api` and `office-auth` pointing to the server IP. Do not change `@`, `www`, `send`, `rsend`, `_dmarc`, `resend._domainkey` or the SPF record.
3. **Prepare the server:** copy `bootstrap-server.sh` over and run it once as root.
4. **Create the settings file:** `sh make-env.sh` on the server writes `/opt/office/.env` with fresh random secrets. Then add `RESEND_API_KEY` (and later the live Stripe keys) by editing the file yourself. Keep a copy in your password manager.
5. **Deploy from your PC:** commit, then `sh infra/prod/deploy-from-pc.sh root@SERVER_IP`.
6. **Check:** `https://office.bibidesk.com` loads; `https://office-api.bibidesk.com/healthz` answers `{"ok":true}`; `https://office-auth.bibidesk.com/realms/office/.well-known/openid-configuration` answers.
7. **Backups:** on the server, `echo '15 3 * * * root sh /opt/office/current/infra/prod/backup.sh' > /etc/cron.d/office-backup`. Also switch on the provider's server backups/snapshots and copy a dump to your own PC from time to time.

## Everyday
- Update Office: commit, then run the deploy script again. It builds new images, runs database updates and restarts. Old releases stay in `/opt/office/releases`.
- Look at logs: `cd /opt/office/current/infra/prod && docker compose --env-file .env logs -f api` (or `worker`, `keycloak`, `web`).
- Restart one part: `docker compose --env-file .env restart api`.
- Go back to the previous release: point `/opt/office/current` at the older folder and run `docker compose --env-file .env up -d` there. (Database changes are only ever additions, so older code keeps working.)

## The sign-in admin console
It is deliberately not on the internet. When you need it: on the server run `docker compose -f docker-compose.yml -f docker-compose.admin.yml --env-file .env up -d keycloak`, then from your PC `ssh -i ~/.ssh/bibi-office-deploy -L 8080:127.0.0.1:8080 root@SERVER_IP` and open `http://localhost:8080/admin`. Log in with `KC_ADMIN_USER` / `KC_ADMIN_PASSWORD` from the settings file. Switch it off afterwards by running the normal `up -d` again.

## Restore a backup
`docker compose --env-file .env exec -T postgres pg_restore -U office_owner -d office --clean --if-exists < /var/backups/office/office-DATE.dump`

## Cutover to the root domain
See `Caddyfile.cutover` and `docs/domain-move.md`. Not before Office has been tested on its own addresses.

## Not tested yet
These files were written and checked for syntax, but **not run on a real server** (no Docker on the development PC). The first deployment is the real test; the places most likely to need a small adjustment are the Keycloak start-up options and its realm import.
