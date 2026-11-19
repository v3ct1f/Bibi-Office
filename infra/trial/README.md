# Run a test version of Office

This guide sets up Office on one rented server with your own web address and HTTPS. You can then sign in and try it with a real business. You don't need DevOps experience. You copy and paste commands, and one script does the setup.

**Time:** about 45 minutes. Most of it is waiting.
**Cost:** a small server (about 5 to 25 USD/EUR a month) and a domain you already own.

> This is a **test install**. It runs on a single server, and you make backups yourself. It's fine for real data during a trial, but read [Before relying on it](#before-relying-on-it) first.

---

## 1. Rent a server

Pick any provider: Hetzner, DigitalOcean, Linode, OVH, Vultr, and so on.

- **System:** Ubuntu 24.04 LTS
- **Size:** at least **2 CPUs and 4 GB RAM**, with 40 GB of disk. Examples: Hetzner CX22, or DigitalOcean's 4 GB Basic.
- **Login:** add your SSH key if the provider asks. Otherwise it emails you a root password.

Write down the server's **IP address** (looks like `203.0.113.10`).

Connect from your computer's terminal. On Windows, use PowerShell or Windows Terminal.

```bash
ssh root@203.0.113.10
```

Every command below runs **on the server**.

## 2. Install Docker and open the firewall

```bash
curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

Check that it worked. Both commands should print version numbers:

```bash
docker --version && docker compose version
```

**2 GB server?** Add memory headroom (swap) first:
`fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab`

## 3. Point your domain at the server

Pick an address for Office, for example `office.mybakery.com`. Then sign in to the place where you bought your domain (GoDaddy, Namecheap, Cloudflare, OVH, and so on). Open its DNS settings and add a record:

| Type | Name | Value |
|---|---|---|
| A | `office` | your server IP |

On Cloudflare, set the record to **DNS only** (grey cloud) for now.

Wait a few minutes, then check from the server. It should print your server's IP:

```bash
getent hosts office.mybakery.com
```

## 4. Get the code

The repository is private, so GitHub asks for a username and a password. For the password, use a token, not your account password. To make one: GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens. Give it **read-only** access to Contents on this repository.

```bash
apt-get install -y git
git clone https://github.com/v3ct1f/Bibi-Office.git /opt/office
cd /opt/office
```

If the deploy work isn't merged into `main` yet, switch to its branch: `git checkout session-16-deploy`.

## 5. Run the setup

```bash
infra/trial/office.sh setup
```

The script asks three things:
- **Domain:** the address from step 3, e.g. `office.mybakery.com`
- **Your email:** this becomes your login
- **Your name**

Then it builds and starts everything, which takes 5 to 15 minutes the first time. When it finishes, it prints:

```
Office is running: https://office.mybakery.com
  Sign in with:  you@mybakery.com
  One-time password: Xy7...   (you'll choose your own on first sign-in)
```

Copy that password somewhere. It's shown once.

The script saved all generated passwords and keys to `infra/trial/.env`. Keep that file. Backups include it.

## 6. First sign-in and your business

1. Open `https://office.mybakery.com`, click **Sign in**, use your email and the one-time password, then choose a new password.
2. **Create your organization:** your business name and a short web name (like `mybakery`).
3. Go to **Admin → Organization** and set your **time zone**. This decides what "today" means for due dates and reports.
4. Go to **Admin → Modules** and switch on what you want to try.

A good first trial run, about 30 minutes:

| Try | Where |
|---|---|
| Add 3 real customers | Contacts |
| Set your company details, then create and send an invoice | Invoices (fill in its settings first) |
| Add a deal and move it through the stages | Deals |
| Snap a receipt and submit an expense | Expenses |
| Share your public booking page and book yourself | Calendar |
| Log a customer question as a ticket and reply | Support |
| Add staff and request time off | People |
| Add products, receive and sell stock | Inventory |
| Send an agreement for e-signature | E-sign |
| See it all add up | KPIs, and the Home page |
| Automate something: "when a contact is created, make a task" | Admin → Workflows |

## 7. Add your team

For each person:

```bash
infra/trial/office.sh add-user sam@mybakery.com "Sam Baker"
```

1. The script prints a one-time password. Send it to them with the address.
2. They sign in once.
3. Then you add them in **Admin → Members** and pick their role: owner, admin, member or viewer.

Nobody can sign up on their own. Only people you add can sign in.

## 8. Email (optional, but needed for invoices and bookings by email)

Out of the box, Office **doesn't send real email**. It only writes emails to the log, and you can read them with `infra/trial/office.sh logs worker`.

To really send email:

1. Get SMTP details from any email provider, such as Brevo, Postmark, Mailgun or Amazon SES. Free tiers are fine for a trial.
2. Edit the settings file: `nano infra/trial/.env`
   ```
   MAIL_DRIVER=smtp
   SMTP_URL=smtps://USERNAME:PASSWORD@smtp.example.com:465
   MAIL_FROM="My Bakery <office@mybakery.com>"
   ```
3. Apply it: `infra/trial/office.sh start`

**AI summaries:** go to Admin → Modules → Summaries → Settings and paste your own Anthropic API key. Nothing is sent to the AI until you do.

## 9. Everyday commands

| What | Command |
|---|---|
| Is everything running? | `infra/trial/office.sh status` |
| See what's happening (Ctrl+C to quit) | `infra/trial/office.sh logs` or `... logs api` |
| Back up now | `infra/trial/office.sh backup` (saved in `infra/trial/backups/`) |
| Restore a backup | `infra/trial/office.sh restore infra/trial/backups/office-<date>.tar.gz` |
| New one-time password for someone | `infra/trial/office.sh reset-password EMAIL` |
| Get the latest version | `infra/trial/office.sh update` |
| Stop / start | `infra/trial/office.sh stop` / `infra/trial/office.sh start` |

**Nightly backups:** run `crontab -e` and add this line:
```
0 3 * * * /opt/office/infra/trial/office.sh backup >> /var/log/office-backup.log 2>&1
```
Copy backups off the server regularly, for example by downloading them with `scp`. A backup stays on the server otherwise, so it won't help if the server is lost.

## Troubleshooting

| Problem | Fix |
|---|---|
| Browser says the connection isn't secure or private | Usually DNS. Check step 3 (`getent hosts ...` must show your IP) and that ports 80/443 are open. Then run `infra/trial/office.sh start` and wait 1 minute. |
| Setup stops with "Login service didn't start" | Usually low memory. Add swap (step 2), then run `infra/trial/office.sh setup` again. |
| "Invalid redirect uri" when signing in | You used a different address than the one in setup. Use exactly `https://<your domain>`. |
| Someone forgot their password | `infra/trial/office.sh reset-password sam@mybakery.com` prints a new one-time password. |
| Something else | `infra/trial/office.sh logs api` (or `worker`, `keycloak`, `caddy`) and send the last lines to whoever helps you. |

## What's inside

| Part | Job |
|---|---|
| Caddy | Public entry point, automatic HTTPS, serves the web app |
| API and worker | Office itself. The worker sends email and runs automations and scheduled jobs. |
| PostgreSQL | All data (each organization isolated by row-level security) |
| Keycloak | Sign-in, at `https://<domain>/id`. Its admin console is not public. |
| NATS | Internal event bus |

Only ports 80 and 443 are public. Secrets are generated per install. Uploaded files and the database live in Docker volumes.

## Before relying on it

- **One server:** if it dies, you restore from your last backup. Keep backups off the server.
- **Automations with waits** ("wait 3 days, then...") run inside the worker. A restart during the wait can lose them. The full setup adds Temporal for that.
- **Password reset by email** isn't set up for the login service. Add SMTP in Keycloak later.
- **Updates** rebuild on the server: there are a few minutes of downtime.
- For a long-term setup: managed Postgres with automatic backups, two app servers, and Temporal (see `ARCHITECTURE.md`).
