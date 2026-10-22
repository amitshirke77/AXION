# AXION — group action tracker

Action tracking for PeopleOCity, Expenova and UKB IT Solutions: a container per client and team, ARCI, next best action and date, P1–P4 priorities, meeting types, repeat reminders, update trails, weekly updates and a present mode. Anyone you add can sign in from the public link with Microsoft or with an email and password.

**Keep this repository private.** `seed/seed.json` holds your current action items and contacts. It is loaded once, on the first request, into an empty database, and is never served to browsers.

## How it runs on Vercel

| Piece | Where |
|---|---|
| Pages and API | One Vercel Function (`api/index.js` → `server.js`, Express) |
| Static files | `public/` (Vercel CDN) |
| Data, logins, sessions | Postgres, via the **Neon** integration (free tier is enough) |
| Weekday reminders, Monday summary | Vercel Cron → `/api/cron/requests` and `/api/cron/digest` |

## Deploy (about 15 minutes)

1. **Put the code on GitHub.** Create a **private** repository and upload this folder, or push it with git.
2. **Import into Vercel.** vercel.com → **Add New → Project** → pick the repository → Framework preset **Other** → leave build settings as they are → **Deploy**. The first deploy will show a database error page; that's expected until step 3.
3. **Add the database.** Project → **Storage → Create Database → Neon (Postgres)** → region **Singapore (ap-southeast-1)** → connect it to the project. This adds `DATABASE_URL` for you.
4. **Add environment variables.** Project → **Settings → Environment Variables** (Production):
   - `ADMIN_PASSWORD`: your first sign-in password (10+ characters; change it after signing in)
   - `CRON_SECRET`: any random string of 16+ characters
   - `SESSION_SECRET`: another random string of 16+ characters
   - `ADMIN_EMAIL`: `amit.shirke@zipstacc.com` (this is the default if you leave it out)
5. **Redeploy.** Deployments → ⋯ → **Redeploy**. Open the `https://<project>.vercel.app` link and sign in with `amit.shirke@zipstacc.com` and `ADMIN_PASSWORD`. The first page load takes a few seconds while your data is loaded.
6. **Optional: your own domain.** Settings → **Domains**, e.g. `axion.peopleocity.in`. Add the DNS record Vercel shows you, set `APP_URL=https://axion.peopleocity.in`, and redeploy.

Costs: Vercel **Hobby** is free but is meant for non-commercial use; for company use Vercel asks for **Pro** (US$20/month per member, and only you need a seat). Neon's free tier covers this app's size.

## Give people access

People & setup → press **Edit** on a person → **Login access**:

| Access | Can see | Can change |
|---|---|---|
| Admin | Everything | Everything, logins, settings |
| Editor | Ticked companies/clients/teams | Create and edit actions there |
| Contributor | Ticked scope + any item they're on | Status, next step and dates, progress updates on items where they are A, R or C. Only the Accountable person can close; others send a closure request |
| Client view | Items marked client-visible for their own client | Comments only. Internal notes, update cadence and (for Expenova) due dates are never sent to them |

Then **Email invite** (needs email set up) or **Get invite link** and send it yourself. The link lets them set a password; it works for 7 days.

## Microsoft sign-in (optional)

1. https://entra.microsoft.com → **App registrations → New registration**
   - Name: `AXION`
   - Supported account types: **Accounts in any organizational directory** (so zipstacc.com, peopleocity.in and client tenants can sign in)
   - Redirect URI: **Web** → `https://<your-domain>/auth/microsoft/callback`
2. Copy the **Application (client) ID** → `MS_CLIENT_ID`.
3. **Certificates & secrets → New client secret** → copy the **Value** → `MS_CLIENT_SECRET`.
4. Add both in Vercel → Environment Variables and redeploy. Keep `MS_TENANT=organizations`, or put your tenant ID to allow only your own organisation.

A Microsoft account can only sign in if an admin has given that exact email a login in People & setup.

## Email (optional, for invites, password resets, reminders and the Monday summary)

Any SMTP service works. With Microsoft 365, use a mailbox such as `tracker@zipstacc.com`, turn on **Authenticated SMTP** for it (Microsoft 365 admin centre → Users → the user → Mail → Manage email apps), then set:

```
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=tracker@zipstacc.com
SMTP_PASS=<that mailbox's password or app password>
MAIL_FROM=AXION <tracker@zipstacc.com>
```

Redeploy, then in People & setup → **Sign-in & automatic emails** switch on the weekday reminders and the Monday summary (both start off). Use **Preview who'd get reminders** first.

Timing: Vercel Cron runs the reminders at 04:15 UTC on weekdays (09:45 IST) and the summary at 03:00 UTC on Mondays (08:30 IST). On the Hobby plan Vercel may run each one any time within that hour. Each job sends at most once a day even if Vercel calls it twice.

## Run locally or on any Node host

```
npm ci
cp .env.example .env.local   # fill in DATABASE_URL (any Postgres 14+) and ADMIN_PASSWORD
node --env-file=.env.local server.js        # http://localhost:3000
```

On a long-running host the reminders run from a built-in timer, so no cron is needed.

## Backups

Neon keeps point-in-time history (24 hours on the free tier, longer on paid plans). For an extra copy: `pg_dump "$DATABASE_URL" > axion-backup.sql`.
