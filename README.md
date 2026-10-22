# AXION — group action tracker

Action tracking for PeopleOCity, Expenova and UKB IT Solutions: a container per client and team, ARCI, next best action and date, P1–P4 priorities, meeting types, repeat reminders, update trails, weekly updates and a present mode. Anyone you add can sign in from the public link with Microsoft or with an email and password.

**Keep this repository private.** `seed/seed.json` holds your current action items and contacts. It is loaded once, on the first request, into an empty database, and is never served to browsers.

## How it runs on Vercel

| Piece | Where |
|---|---|
| Pages and API | One Vercel Function (`api/index.js` → `server.js`, Express) |
| Static files | `public/` (Vercel CDN) |
| Data, logins, sessions | **Supabase**, reached through the Supabase API (`supabase-js`) with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, server side only |
| Weekday reminders, Monday summary | Vercel Cron → `/api/cron/requests` and `/api/cron/digest` |

## Set up Supabase (about 10 minutes)

1. supabase.com → **New project**. Region **South Asia (Mumbai)**.
2. **SQL Editor → New query**: paste all of `supabase/01_schema.sql` → **Run**. This creates the tables and the functions AXION calls through the API, and blocks the public anon key from all of it. Safe to run again.
3. Optional — **SQL Editor → New query**: paste all of `supabase/02_seed.sql` → **Run** to load your 76 actions, 111 update-trail entries, 22 people, structure, settings and admin login. If you skip this, AXION loads the same data itself on its first request.
4. **Project Settings → API**: copy the **Project URL** (`SUPABASE_URL`) and the **service_role** secret key (`SUPABASE_SERVICE_ROLE_KEY`). Projects that use the new keys can use the **secret** key (`sb_secret_…`) instead.

The service_role key stays on the server (Vercel environment variables). Browsers only ever talk to AXION's own API, so the anon key isn't used. AXION has its own logins, so Supabase Auth isn't used either.

## Deploy on Vercel (about 10 minutes)

1. **Put the code on GitHub.** Create a **private** repository and upload this folder, or push it with git.
2. **Import into Vercel.** vercel.com → **Add New → Project** → pick the repository → Framework preset **Other** → leave build settings as they are.
3. **Environment variables** (before pressing Deploy, or under Settings → Environment Variables), matching `.env.example`:
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from step 4 above. If you link the project with Vercel's **Supabase integration**, these two are added for you.
   - `ADMIN_PASSWORD`: your first sign-in password (10+ characters; change it after signing in)
   - `CRON_SECRET`: any random string of 16+ characters
   - `SESSION_SECRET`: another random string of 16+ characters
   - `SEED_ON_FIRST_START=false` only if you ran `02_seed.sql` and don't want the app to ever load its built-in copy (it never overwrites existing data either way)
4. **Deploy**, open the `https://<project>.vercel.app` link and sign in with `amit.shirke@zipstacc.com` and `ADMIN_PASSWORD`. If the page says tables are missing, run `01_schema.sql` (step 2) and reload.
5. **Optional: your own domain.** Settings → **Domains**, e.g. `axion.peopleocity.in`. Add the DNS record Vercel shows you, set `APP_URL=https://axion.peopleocity.in`, and redeploy.

The app runs in Vercel's Mumbai region (`bom1`, set in `vercel.json`) next to the Supabase project.

Costs: Supabase free tier pauses a project after a week with no activity; Supabase Pro (US$25/month) doesn't. Vercel **Hobby** is free but meant for non-commercial use; for company use Vercel asks for **Pro** (US$20/month per member, and only you need a seat).

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
cp .env.example .env.local   # fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and ADMIN_PASSWORD
node --env-file=.env.local server.js        # http://localhost:3000
```

On a long-running host the reminders run from a built-in timer, so no cron is needed.

## Backups

Supabase takes daily backups on paid plans (Database → Backups). On any plan you can keep your own copy with `pg_dump` using the connection string from **Connect → Session pooler** (port 5432): `pg_dump "<connection string>" > axion-backup.sql`.
