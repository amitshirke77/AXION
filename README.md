# Group Action Tracker

Action tracking for PeopleOCity, Expenova and UKB IT Solutions: a container per client and team, ARCI, next best action and date, P1–P4 priorities, meeting types, repeat reminders, update trails, weekly updates and a present mode. Anyone you add can sign in from the public link with Microsoft or with an email and password.

**Keep this repository private.** `seed/seed.json` holds your current action items and contacts; it is loaded once, on the first start, into an empty database.

## Deploy on Render (about 15 minutes)

1. Push this folder to a **private** GitHub repository.
2. In Render: **New → Blueprint**, connect GitHub, pick the repository. Render reads `render.yaml`.
3. When asked for values, set at least **ADMIN_PASSWORD** (10+ characters). Leave the Microsoft and email values blank for now if you don't have them yet.
4. Press **Apply**. When the deploy finishes, open the `https://action-tracker-xxxx.onrender.com` link, sign in as `amit.shirke@zipstacc.com` with that password, then change it under **Account**.
5. Optional: Settings → Custom Domains, e.g. `actions.peopleocity.in` (add the CNAME Render shows you). If you do this, also set `APP_URL` to that address.

Costs: Render Starter instance (US$7/month) plus a 1 GB disk (US$0.25/month). The disk keeps the database across deploys; Render snapshots it daily.

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
   - Name: `Action Tracker`
   - Supported account types: **Accounts in any organizational directory** (so zipstacc.com, peopleocity.in and client tenants can all sign in)
   - Redirect URI: **Web** → `https://<your-app>.onrender.com/auth/microsoft/callback`
2. Copy the **Application (client) ID** → `MS_CLIENT_ID`.
3. **Certificates & secrets → New client secret** → copy the **Value** → `MS_CLIENT_SECRET`.
4. In Render → Environment, save both. Keep `MS_TENANT=organizations`, or set your tenant ID to allow only your own organisation.

A Microsoft account can only sign in if an admin has given that exact email a login in People & setup.

## Email (optional, for invites, password resets, reminders and the Monday summary)

Any SMTP service works. With Microsoft 365, create or pick a mailbox (e.g. `tracker@zipstacc.com`), enable **Authenticated SMTP** for it in the Microsoft 365 admin centre (Users → the user → Mail → Manage email apps), then set:

```
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=tracker@zipstacc.com
SMTP_PASS=<that mailbox's password or app password>
MAIL_FROM=Action Tracker <tracker@zipstacc.com>
```

Then in People & setup → **Sign-in & automatic emails**, switch on the weekday reminders and the Monday summary (both off by default). Use **Preview who'd get reminders** first.

## Run it anywhere else

```
npm ci
ADMIN_PASSWORD='choose-a-password' node server.js      # http://localhost:3000
```
or `docker build -t action-tracker . && docker run -p 3000:3000 -v tracker-data:/data -e ADMIN_PASSWORD=... action-tracker`.

Environment: `PORT`, `DATA_DIR`, `APP_URL` (public address; Render sets it for you), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`.

## Backups

The whole database is one SQLite file at `$DATA_DIR/tracker.db`. Render keeps daily disk snapshots; for an extra copy use the Render shell: `sqlite3 /var/data/tracker.db ".backup /var/data/backup.db"`.
