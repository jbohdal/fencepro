# EZ Biz: go live

Written 2026 10 07 for the `finalize` branch, rewritten 2026 10 08 for the
setup that is actually in use: EZ Biz runs on the Mac mini and is reached over
Tailscale. There is no hosting bill, no domain and no outside database. This
is the one document to follow. It replaces the older setup and deployment
notes wherever they disagree.

EZ Biz (this repo) is the one build. The EZ Quote website widget stays a
separate app (the `EZ-Budget` folder) and sends finished quotes into EZ Biz.
The phone agent (Retell) sends finished calls into EZ Biz the same way.

---

## 1. What runs where

| What | Where | Starts by itself |
|---|---|---|
| EZ Biz (open this) | `https://jonathans-mac-mini.tail40fb4a.ts.net` | |
| Who can open it | Only devices signed in to your Tailscale account (this Mac, your phone) | |
| Public intake address | `https://jonathans-mac-mini.tail40fb4a.ts.net:8443`, only `/api/quoting` and `/api/intake/retell` | |
| Live copy of the code | `~/ezbiz` (cloned from `main` on GitHub) | |
| Working copy | the folder in Downloads. Edit and commit there, never in `~/ezbiz`. It has its own database (`ezbiz_dev`) and port (4001); see section 15 | |
| Server | one Node 22 process under pm2, named `ezbiz`, port 4000, this Mac only | at login (`com.ezbiz.pm2`) |
| Database | Postgres 16 on this Mac, database `ezbiz`. Only `~/ezbiz` uses it (section 15) | at login (brew services) |
| Tailscale | the Tailscale app; it remembers the serve and Funnel setup | at login (app setting) |
| Backups | `~/ezbiz-backups`, every night at 2:30, kept 14 days | at login (`com.ezbiz.backup`) |
| Uploaded files | `~/ezbiz/apps/portal/uploads` | |
| Settings file | `~/ezbiz/apps/portal/.env` (never committed) | |
| Logs | `pm2 logs ezbiz` and `~/Library/Logs/ezbiz/` | |

The live copy is outside Downloads on purpose. macOS does not let background
jobs read Downloads, Documents or Desktop without a click on screen, so a
server started at login from there would hang.

The disk is encrypted (FileVault) and automatic login is off, so after a
restart nothing runs until you log in to the Mac. Section 13 is the checklist.

## 2. Get the code to GitHub

Work in the Downloads folder on `finalize`, then:

```bash
git checkout main
git merge --ff-only finalize
git push origin main
git checkout finalize
```

## 3. Settings file

`~/ezbiz/apps/portal/.env`, made from `apps/portal/.env.example`. Each secret
was made with `openssl rand -hex 48`, a different value for each.

| Setting | What it is here | If it is missing |
|---|---|---|
| `DATABASE_URL` | The local `ezbiz` database | Server cannot save anything |
| `ALLOW_LOCAL_DATABASE` | `true` | Server refuses to start, because a production database on localhost is normally a mistake |
| `JWT_SECRET` | Random secret | Server invents one at every restart, so you are signed out on every restart |
| `JWT_REFRESH_SECRET` | A different random secret | Same |
| `CRM_SYNC_KEY` | Random secret | Server to server sync is refused |
| `CRON_SECRET` | Random secret | Scheduled jobs can only be started by a signed in admin |
| `NODE_ENV` | `production` | Development shortcuts stay on |
| `APP_URL` and `CLIENT_URL` | `https://jonathans-mac-mini.tail40fb4a.ts.net` | Links in emails point at localhost, and the browser is refused by the API |
| `HOST` | `127.0.0.1` | The server also answers other devices on your Wi-Fi, without HTTPS |
| `WEB_DIST_DIR` | `../web/dist` | The address shows nothing but the API |
| `PORTAL_DIST_DIR` | `./dist/client` | `/portal/` shows the main app instead of the customer portal |
| `EZ_QUOTE_WIDGET_TOKEN` | Random secret | Website quotes are refused (intake stays off) |
| `EZ_QUOTE_ALLOWED_ORIGINS` | Where the widget is hosted, comma separated: `https://gdfencepro.com,https://www.gdfencepro.com,https://quote.gdfencepro.com` | Browsers on your website cannot post quotes |
| `RETELL_API_KEY` | Empty for now. The Retell API key that carries the webhook badge | Phone calls are refused (intake stays off) |

Optional: email (section 18: Google Workspace or SendGrid), Twilio for text
messages, Google keys for calendar and maps. Without email settings nothing is
emailed and every screen says "not sent".

After changing the file: `pm2 restart ezbiz --update-env`

## 4. Update the live copy

After pushing `main` (section 2):

```bash
bash ~/ezbiz/deploy/mac/update.sh
```

It takes a backup, pulls `main`, installs, runs the unit tests, builds the
server, the customer portal and the web app, applies database additions,
restarts the server and waits for it to answer. It stops at the first problem.
A database change that would drop data is refused, not applied.

Three things to know if you ever do the steps by hand:

* Use `pnpm exec prisma db push`, not `npx prisma db push`. `npx` downloads a
  newer Prisma that cannot read this schema.
* Build the customer portal with `pnpm build:client --base=/portal/`.
* The server needs Node 22. It is the default `node` on this Mac.

## 5. Sign in

Your login is `jbohdal@gdfencepro.com`. If you are ever locked out:

```bash
cd ~/ezbiz/apps/portal
node --import tsx scripts/create-owner.ts jbohdal@gdfencepro.com 'a long password' 'Jonathan Bohdal' 'GD Fence Pro' --reset
```

Do not run the demo seed on this database.

## 6. Set up pricing

Everything about how a job is priced is a setting, and every setting can be
overridden on a single quote.

**Settings, Pricing tab**

* *How jobs are priced*: labor as **Hourly crew** or **Subcontractor**; price
  built **from cost** (cost ÷ magic number) or **per foot**; commission
  **included** in the price or **added** on top.
* *Subcontractor rates*: paid per foot or per section; one default rate; a
  rate per category (Vinyl, Chainlink and so on); per walk gate, per double
  gate, per tear out section and per tear out gate.

**Settings, Styles tab**: each style has its own Magic #, Sub Rate and $ / Ft.
A style rate beats the category rate, which beats the default.

**On a quote**: the Labor block switches hourly or subcontractor for that job,
takes a one off sub rate, extra hours, or a flat labor dollar amount. "Price
from" switches cost or per foot. You can type a magic number for that quote or
type the final price outright. The quote remembers what you chose.

Switching to subcontractors is one setting. Old quotes keep the numbers they
were saved with.

**Material cost comes from Inventory.** Every line on a quote looks up its
unit cost in Inventory by item name. If an item is not in Inventory, the quote
uses the old built in cost for that line and says so in the yellow "Check
before you quote" box, so a missing item never silently prices at zero. Change
a cost in Inventory and the next quote uses it.

## 7. Connect the website quote widget

In the EZ Quote app (the `EZ-Budget` folder), set two values where it is
hosted and redeploy it:

```
NEXT_PUBLIC_CRM_API_BASE=https://jonathans-mac-mini.tail40fb4a.ts.net:8443/api
NEXT_PUBLIC_CRM_WIDGET_TOKEN=<the same value as EZ_QUOTE_WIDGET_TOKEN>
```

Note the `:8443`. That is the public door (section 12). No code change is
needed in the widget. When a customer finishes a quote, EZ Biz finds the
customer by email or phone (or creates one), adds a note with the quote,
raises a notification and puts a card on the pipeline. Sending the same quote
twice does not create a second copy.

If the widget is hosted somewhere other than the addresses in
`EZ_QUOTE_ALLOWED_ORIGINS`, add that address there and restart.

## 8. Connect the phone agent

Put the Retell API key in `RETELL_API_KEY`, restart, and in Retell set the
webhook URL to:

```
https://jonathans-mac-mini.tail40fb4a.ts.net:8443/api/intake/retell
```

Every webhook is checked against `RETELL_API_KEY`, so only Retell can post
there. When a call has been analyzed, EZ Biz files it the same way as a
website quote, and creates a call back task if the caller asked for one.

## 9. Check it

After any update:

1. `curl -s https://jonathans-mac-mini.tail40fb4a.ts.net/api/health` answers.
2. `curl -s -o /dev/null -w '%{http_code}\n' 'https://jonathans-mac-mini.tail40fb4a.ts.net/api/portal/files//etc/passwd'`
   must not print `200`.
3. Sign in. Create a customer and a quote for that customer. Reload the page.
   Both are still there.
4. On your phone, with Tailscale switched on, open the same address and sign
   in. The same customer and quote are there.
5. With Tailscale switched **off** on the phone:
   `https://jonathans-mac-mini.tail40fb4a.ts.net` must not open, and
   `https://jonathans-mac-mini.tail40fb4a.ts.net:8443/` must not show the
   sign in page.

The checks used to verify this build are in `apps/web/e2e` and in
`apps/portal/tests`. `apps/web/e2e/README.md` says how to run them.

## 10. What was verified, and what was not

Verified on a private copy (real server code, real Postgres, real browsers):

* two browsers on one login see each other's customers, quotes, jobs,
  schedule, inventory, vendors, pipeline, invoices and payments (27 of 27)
* a website quote and a signed Retell call both land as customer, note,
  notification and pipeline card; forged and replayed calls are refused
  (14 of 14)
* every screen opens without an error (25 screens)

Verified on this Mac on 2026 10 08:

* 147 unit tests pass; server, portal and web app build clean
* over the Tailscale address: the health check answers, the file read probe
  returns 404, the web app and the customer portal load, an API call without
  a sign in is refused, the widget address answers with the token and refuses
  without it
* from the public internet, through the public door on port 8443: the widget
  address answers with the token and refuses without it, a browser on
  gdfencepro.com is allowed and one on another site is not, and the sign in
  page, the health check, the login API and the file read probe all return
  404. Port 443 does not answer from the public internet at all
* killing pm2 and running the login job brings the server back
* the nightly backup ran through the scheduler, and that backup restored into
  an empty database with every table and the owner login

Not verified:

* a real restart of the Mac (section 13 the first time it happens)
* a real Retell call and the real widget on gdfencepro.com
* Google Maps, email and text message delivery

## 11. Open questions for Jonathan

These were left as they are. Each one changes prices or counts, so it is your
call:

1. **6 ft by 8 ft and Bell panels.** The calculator counts them 6 ft and 4 ft
   wide. The style names read as height by width. Which is right?
2. **Tear out** is counted twice on a quote: once as a material line and once
   as tear out cost.
3. **Auto mix** (6 ft and 8 ft rails mixed) leaves out the pickets and rails
   for gate leaves.
4. **New parts lists** for 8 ft tall vinyl, tan dig set and Industrial Abigail
   were built from the pattern of the other styles and need your eye. Quotes
   on those styles show a warning until you confirm them.
5. **Margin colors** (green at 34 percent) are a setting in the quote builder
   but still fixed numbers on some other pages.

Known gaps, none of which block daily use by one person:

* The customer portal still reads shared quotes and files from the browser
  that created them.
* Bulk CSV import sends one request per record. Fine for hundreds; for the
  large import that is coming it should be batched first.
* Uploaded files are stored on this Mac's disk. They survive an update and
  are in the nightly backup as their own file (section 14).
* Customers cannot open anything. The address is private to your Tailscale
  account, so a shared quote link, a presentation link or a customer portal
  invite will not open on a customer's phone. Send quotes as PDF for now.
  Opening those pages to the public is a decision about what goes on the
  public door (section 12).
* When the Mac is off, asleep or not logged in, website quotes and phone
  agent calls are not received.

---

## 12. Tailscale: the private address and the public door

Tailscale is on the free Personal plan. Nothing here needs a paid feature.

**Private (everything).** `tailscale serve` puts the whole app on
`https://jonathans-mac-mini.tail40fb4a.ts.net`, with a real HTTPS certificate,
for devices signed in to your Tailscale account and nobody else. To use it
from a new phone or laptop, install Tailscale there and sign in with
`jbohdal@gdfencepro.com`.

**Public door.** Tailscale Funnel opens port 8443 of the same name to the
internet, and only three paths are connected to it: `/p` (everything a
customer opens: proposals `/p/<link>`, change orders `/p/co/`, warranty updates
`/p/wu/`, walkthrough certificates `/p/w/`, crew packets `/p/i/`, receipts
`/p/r/`, the website quote `/p/quote/`, and the customer portal `/p/portal/`
with its own API under `/p/portal/api/`, which answers only what a customer
uses), `/api/quoting` for the phone agent and old widget calls, and
`/api/intake/retell` for the phone agent. The staff sign in page and the rest
of the API are not on that port.

See what is set up:

```bash
tailscale serve status
```

Set it up again from nothing (Tailscale keeps this across restarts, so this is
only for a new Mac or after `tailscale serve reset`):

```bash
tailscale serve --bg --https=443 http://127.0.0.1:4000
tailscale funnel --bg --https=8443 --set-path=/api/quoting http://127.0.0.1:4000/api/quoting
tailscale funnel --bg --https=8443 --set-path=/api/intake/retell http://127.0.0.1:4000/api/intake/retell
```

Close the public door, leaving the private address working:

```bash
tailscale funnel --https=8443 off
```

If the Mac is ever renamed in Tailscale the address changes. Then change
`APP_URL`, `CLIENT_URL` and `GOOGLE_REDIRECT_URI` in the settings file, the
two widget values in section 7 and the Retell webhook in section 8.

## 13. After a power cut

The Mac turns itself back on, but the disk stays locked until you log in.
Until then EZ Biz is down and website quotes and phone calls are not received.

1. Log in to the Mac with your password (at the Mac, keyboard and screen).
2. Wait about a minute. Postgres, the server and Tailscale start by themselves.
3. Check the Tailscale icon in the menu bar says Connected.
4. Open `https://jonathans-mac-mini.tail40fb4a.ts.net` and sign in.

If it does not open:

```bash
pm2 list                                  # ezbiz should say online
pm2 resurrect                             # if the list is empty
pm2 logs ezbiz --lines 50                 # if it says errored
brew services list                        # postgresql@16 should say started
brew services restart postgresql@16       # if it does not
tailscale serve status                    # should list the address and :8443
```

Mac settings this relies on (already set): never sleep, start up after a
power failure, Tailscale set to launch at login.

## 14. Backups and restore

Every night at 2:30 `deploy/mac/backup.sh` writes two files to
`~/ezbiz-backups` and removes its own files older than 14 days:

* `ezbiz-db_DATE_TIME.dump`: the whole database
* `ezbiz-uploads_DATE_TIME.tar.gz`: the uploads folder

If the Mac was asleep or off at 2:30, the backup runs when it is next awake
and logged in. The log is `~/Library/Logs/ezbiz/backup.log`.

Take one right now:

```bash
bash ~/ezbiz/deploy/mac/backup.sh
```

**These backups are on the same disk as the database.** They protect against
a bad import or a mistake, not against the Mac dying or being stolen. Add the
second copy below.

### Restore the database

This replaces everything in the database with the backup. Pick the file by
its date.

```bash
pm2 stop ezbiz
bash ~/ezbiz/deploy/mac/backup.sh         # keep what is there now, in case
dropdb ezbiz
createdb -O ezbiz ezbiz
pg_restore --no-owner --role=ezbiz -d ezbiz ~/ezbiz-backups/ezbiz-db_DATE_TIME.dump
pm2 start ezbiz
```

To look inside a backup without touching the live database, restore it into a
spare one and remove it afterwards:

```bash
createdb ezbiz_look
pg_restore --no-owner -d ezbiz_look ~/ezbiz-backups/ezbiz-db_DATE_TIME.dump
psql ezbiz_look
dropdb ezbiz_look
```

### Restore the uploads

```bash
pm2 stop ezbiz
mv ~/ezbiz/apps/portal/uploads ~/ezbiz/apps/portal/uploads.before-restore
tar -xzf ~/ezbiz-backups/ezbiz-uploads_DATE_TIME.tar.gz -C ~/ezbiz/apps/portal
pm2 start ezbiz
```

### Add a second copy on an external drive

1. Plug in the drive and note its name in Finder, for example `EZBackup`.
2. Make a folder on it and reinstall the backup job with that folder:

```bash
mkdir -p /Volumes/EZBackup/ezbiz-backups
EZBIZ_BACKUP_COPY_DIR=/Volumes/EZBackup/ezbiz-backups bash ~/ezbiz/deploy/mac/install-launch-agents.sh
```

3. Run a backup (the command above) and look in the log. The first time,
   macOS asks whether `bash` may use the drive. Click Allow. If the log says
   "Operation not permitted", open System Settings, Privacy & Security, Files
   and Folders, and allow Removable Volumes there.

From then on every nightly backup is also copied to the drive, with the same
14 days kept. If the drive is unplugged the backup still runs and the log
says the copy was skipped.

Also keep a copy of `~/ezbiz/apps/portal/.env` somewhere safe (a password
manager). It is not in the backups and not on GitHub.

## 15. Live and dev are separate

**The rule: only `~/ezbiz` ever uses the live database. Nothing run from the
working folder in Downloads, or from any other copy of the code, may read or
write live.** The working folder once held a copy of the live settings file,
so every command run there was pointed at live. That is what this section
prevents.

| | Live | Dev (practice) |
|---|---|---|
| Code | `~/ezbiz` | the working folder in Downloads |
| Database | `ezbiz` | `ezbiz_dev`, a copy of live to practice on |
| Database login | `ezbiz` | `ezbiz_dev` |
| API port | 4000 | 4001 |
| Settings file | `~/ezbiz/apps/portal/.env` | `apps/portal/.env` in the working folder |
| Web app's API port | 4000 (the default) | `VITE_API_PORT=4001` in `apps/web/.env.local` and `apps/portal/.env.local` |
| Email, texts, calendar, phone agent | on, as set in section 3 | off: those settings are empty, and the outbound gate holds anything that tries (dev outbox) |
| Secrets | the live ones | its own, so a sign in made in dev is worthless on live |

What enforces it:

1. **Database logins.** The `ezbiz_dev` login cannot open the `ezbiz`
   database, and the `ezbiz` login cannot open `ezbiz_dev`. Postgres refuses
   the connection.
2. **Start up guard.** The server refuses to start when its `DATABASE_URL`
   names `ezbiz` on this machine and it is not running from `~/ezbiz`
   (`apps/portal/src/server/lib/liveGuard.ts`).
3. **Ports.** The web app talks to `localhost:4000` unless `VITE_API_PORT`
   says otherwise. The working folder sets 4001, so a dev browser never
   reaches the live server.
4. **Outbound gate.** Nothing but the live install can reach a real person
   (`apps/portal/src/server/lib/outboundGate.ts`, Oct 26, 2026, after dev test
   runs pushed "Automation failed" to the owner's phone). The gate sits inside
   the lowest level senders: phone push (web-push), email (SMTP, SendGrid,
   Gmail), texts (Twilio), Google Calendar writes, and webhooks (the
   automation webhook step, Zapier). It opens only when all of these hold:
   `NODE_ENV=production`, `DATABASE_URL` names the database `ezbiz`, the code
   runs from `~/ezbiz`, and it is not a test (Vitest, `NODE_ENV=test`).
   `OUTBOUND_GATE=closed` shuts it anywhere. Everywhere else a message is not
   sent: it is appended to the dev outbox, `apps/portal/logs/dev-outbox.log`
   (one JSON line: channel, to, title, body, why), with a `[dev outbox]` line
   in the server log, and the screen says it was not sent. Tests start with
   the gate shut (`apps/portal/tests/setup/outboundGate.ts`); a source check
   (`tests/outboundGateStatic.test.ts`) fails if a new sender skips it.
5. **Scrubbed practice data.** Every refresh of `ezbiz_dev` is scrubbed
   before anything can use it (below).

Rules for anyone (or any assistant) working in this repo:

- Never copy `~/ezbiz/apps/portal/.env` into the working folder, and never put
  the `ezbiz` database, the `ezbiz` login or port 4000 in the working folder's
  settings.
- Before running anything that touches a database from the working folder
  (`prisma db push`, `prisma migrate`, a seed, a script, the server), check
  that `DATABASE_URL` in `apps/portal/.env` names `ezbiz_dev`.
- Try schema changes and imports on `ezbiz_dev` first. They reach live only
  through section 4 (`update.sh`), or through a script the owner has approved
  for live, run after a backup.
- `psql` and `pg_dump` run as the Mac user are superuser and can open either
  database. Name the database on every command (`-d ezbiz_dev`), and treat
  `-d ezbiz` as a deliberate act on live.
- The dev database holds real customers' names and street addresses; their
  emails and phone numbers are made fake at each refresh. Keep email and text
  settings empty in the working folder anyway; the outbound gate would hold
  any message, but nothing should be set up to try.

Fresh practice data: this throws away what is in `ezbiz_dev` and copies live
in again. Live is only read.

```bash
bash deploy/mac/refresh-dev-db.sh
```

Right after the copy it runs the scrub
(`apps/portal/scripts/scrub-dev-db.ts`; it refuses any database but
`ezbiz_dev`, and if it fails the refresh drops the unscrubbed copy):

- Forgotten: phone push sign ups (`PushSubscription`), the push keys and the
  Gmail sign in (`AccountKeyValue` `push_vapid`, `gmail_token` and any other
  token or key), Google Calendar (`GoogleCalendarToken`, `CalendarSyncState`,
  `CalendarEventLink`), staff and portal sign ins (`CrmUserSession`,
  `RefreshToken`, `PortalSession`), API keys, integration settings, invite
  links. Dev makes its own push keys the first time push is turned on there.
- Made fake, in every text and JSON column of every table: email addresses
  (staff become `<login>@example.invalid`, everyone else
  `c-<10 letters>@example.invalid`) and phone numbers (`(0AB) CDE-WXYZ`: an
  area code that does not exist, the last 4 digits kept, equal numbers stay
  equal). Names and street addresses stay real; seven digit local numbers in
  free text (`598-9785`) are counted and printed, not changed.
- It prints the counts and the dev sign in emails, and marks the database
  (`AccountKeyValue` `dev:scrubbed`); `tests/devDbScrubbed.db.test.ts`
  (`DEV_DB=1`) checks nothing from before that mark can reach anybody.
- To scrub again without a fresh copy: `cd apps/portal && npx tsx scripts/scrub-dev-db.ts`
  (safe to repeat: fakes stay as they are).

Run the dev copy. Sign in with your normal password and the dev login email:
`jbohdal@example.invalid`, `christaf0920@example.invalid`,
`wt-office@example.invalid`, `wt-christa@example.invalid`,
`wt-installer@example.invalid` (as of Oct 26, 2026; the scrub prints the
current list). Every sign in ends at each refresh.

```bash
cd apps/portal && pnpm dev:server     # API on http://localhost:4001
cd apps/web && pnpm dev               # web app on http://localhost:5173
```

A change made directly in the live database from outside the app (an import
script) must also add 1 to the record's `version` when it edits the pipeline,
inventory, business state, vendors, schedule settings or a cloud storage key,
so that open tabs merge it in instead of being refused without reason.

## 16. Google Calendar

One way: anything with a date in EZ Biz is sent to Google Calendar. Nothing
comes back from Google.

| | Live | Dev |
|---|---|---|
| Calendar the events go to | `GD Fence Pro` | `GD Fence Pro (TEST)` |
| Redirect address | `http://localhost:4000/api/google-calendar/callback` | `http://localhost:4001/api/google-calendar/callback` |
| Where you press Connect | `http://localhost:4000` on the Mac mini, Settings, Google Calendar | `http://localhost:4001`, same place |

The app makes the calendar itself the first time you connect. It asks Google
only for permission to manage calendars it created, so it cannot read or
change your main calendar. A copy of the code that is not `~/ezbiz` always
uses the `(TEST)` name, whatever its settings say.

What is sent:

| In EZ Biz | On the calendar |
|---|---|
| A job with a scheduled date (Operations, Dispatch, Smart Schedule) | `Install: Name (style, sections)`, all day, across its working days |
| An entry on the Schedule board | The same, on its day. Back to back days for one job are one event. A rain day reschedule moves it |
| A pipeline card with a date, before the sale | `Estimate: Name`, all day |
| A pipeline card with a date, after the sale | `Install: ...`, only when no job carries the date |
| A customer's First Appointment Date | `Estimate: Name`, unless their card already shows it that day |
| An appointment booked by the website chat | `Estimate: Name` at its time |

Each event has the address as its location, and a description with phone,
fence style, footage, gates, quote price, notes and an "Open in EZ Biz" link.

How it behaves:

- It runs on the server a couple of seconds after a save, never in the
  browser, and a save never waits for Google. If Google is down the save
  still works; the event is retried on the next save and every five minutes.
- Connecting sends nothing. "Push all upcoming" sends everything dated today
  or later and switches syncing on. Past dates are not back filled.
- Each CRM record maps to one Google event (table `CalendarEventLink`), and
  the event's id is derived from the record, so a second event for the same
  record cannot be made.
- Disconnect stops the sync and forgets the Google sign in. Events already on
  the calendar stay.
- Problems show under Settings, Google Calendar, and in `pm2 logs ezbiz`
  (lines starting `[calendar]`).

### One time Google setup

Sign in to Google as your gdfencepro.com account for all of this.

1. Open `https://console.cloud.google.com`. At the top, click the project
   picker, then **New project**. Name: `EZ Biz Calendar`. Organization:
   `gdfencepro.com`. Click **Create**, then select the new project.
2. Menu (three lines, top left) → **APIs & Services** → **Library**. Search
   `Google Calendar API`, open it, click **Enable**.
3. Menu → **APIs & Services** → **OAuth consent screen**. Click **Get
   started**. App name: `EZ Biz`. Support email: yours. Audience:
   **Internal**. Contact email: yours. Agree and click **Create**.
   Internal is what keeps the connection from expiring.
4. In the left list click **Data access** → **Add or remove scopes**. In
   "Manually add scopes" paste these two lines, click **Add to table**,
   **Update**, then **Save**:
   ```
   https://www.googleapis.com/auth/calendar.app.created
   https://www.googleapis.com/auth/userinfo.email
   ```
5. In the left list click **Clients** → **Create client**. Application type:
   **Web application**. Name: `EZ Biz`. Under **Authorized redirect URIs**
   click **Add URI** twice and enter:
   ```
   http://localhost:4000/api/google-calendar/callback
   http://localhost:4001/api/google-calendar/callback
   ```
   Click **Create**. In the box that appears click **Download JSON**.
6. Put three lines in each settings file (never commit them). The client id
   and secret are the same in both; only the redirect differs.
   `~/ezbiz/apps/portal/.env`:
   ```
   GOOGLE_CLIENT_ID="...apps.googleusercontent.com"
   GOOGLE_CLIENT_SECRET="..."
   GOOGLE_REDIRECT_URI="http://localhost:4000/api/google-calendar/callback"
   ```
   `apps/portal/.env` in the working folder: the same id and secret, with
   `GOOGLE_REDIRECT_URI="http://localhost:4001/api/google-calendar/callback"`.
   Then `pm2 restart ezbiz --update-env` for live.
7. On the Mac mini open `http://localhost:4000`, sign in, go to Settings →
   Google Calendar, press **Connect Google Calendar**, choose your
   gdfencepro.com account and allow. You come back to the same page showing
   the account and the calendar name. Press **Push all upcoming**.
8. In Google Calendar, the new calendar appears under "My calendars". To see
   it on your phone, turn it on in the Google Calendar app's settings.


## 17. Feedback from inside the app

Every signed-in page has a **Send feedback** button in the top bar (the
speech bubble with a plus, next to the bell). One tap takes a picture of the
screen and opens a small form; what is sent also records who, their role, the
time, the page address, the screen size, the phone or browser, the app file it
was running and the last few app errors. It goes through the save queue, so it
is sent once even on weak signal. The owner and admins see it under
**Admin > Feedback** (and get a bell notification for each new one).

To read it from a terminal (for Claude Code too), read only:

```bash
cd ~/ezbiz/apps/portal && npx tsx scripts/feedback-report.ts               # newest 50
cd ~/ezbiz/apps/portal && npx tsx scripts/feedback-report.ts --status new  # only New
#   --limit 20   --days 7   --json (one JSON object per line)
```

It reads `DATABASE_URL` from that folder's `.env` inside a read-only
transaction, prints each feedback with the path of its screenshot file
(`<UPLOAD_DIR>/feedback/<company>/<id>.jpg`, open it to see the screen), and
prints no settings or secrets. Run from the working folder it reads the dev
copy instead.


## 18. Email

The app emails sign-in invites, customer portal invites, password reset
links, receipts (with the receipt PDF attached), portal message notices and
alerts to the owner. Until email is set up **nothing is sent**, and each
screen says so ("Not sent: email is not set up"), with the link to copy and
text instead. (Before Oct 22, 2026 the server only wrote these to its log and
reported them as sent: the portal invites of Oct 21 never went out. Send
them again once email works.)

### Google Workspace (gdfencepro.com)

1. Pick the mailbox the app sends as, for example `office@gdfencepro.com`
   (it must be a real mailbox; replies go to it unless `SMTP_REPLY_TO` says
   otherwise).
2. Signed in to Google as that mailbox, turn on 2-Step Verification:
   **myaccount.google.com > Security > 2-Step Verification > Get started**.
   If it cannot be turned on, the Workspace admin must allow it:
   **admin.google.com > Security > Authentication > 2-step verification >
   Allow users to turn on 2-Step Verification**.
3. Make an App Password: go to **myaccount.google.com/apppasswords** (or
   **myaccount.google.com > Security > 2-Step Verification > App passwords**
   at the bottom), type the name `EZ Biz`, press **Create**. Google shows a
   16 letter password once; copy it without the spaces. It stops working if
   that account's normal password is changed (make a new one then). If the
   App passwords page is missing, 2-Step Verification is not on yet, or the
   account uses only security keys or Advanced Protection.
4. Put these in `~/ezbiz/apps/portal/.env` (the live settings file only;
   never in the working folder in Downloads):

   ```bash
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465                 # TLS from the start. 587 also works (STARTTLS)
   SMTP_USER=office@gdfencepro.com
   SMTP_PASS=abcdefghijklmnop    # the App Password, not the normal password
   SMTP_FROM="Getter Done Fence Pros"   # the name people see
   SMTP_FROM_EMAIL=office@gdfencepro.com # the mailbox, or an alias Gmail lets it send as
   SMTP_REPLY_TO=                # optional: where replies go
   ```

   `SMTP_FROM_EMAIL` may be left empty: mail then comes from `SMTP_USER`. An
   alias (say `jobs@gdfencepro.com`) works only once it is added in that
   mailbox's Gmail under **Settings > Accounts > Send mail as**; otherwise
   Gmail sends it from the mailbox address anyway. `SMTP_FROM` is a name now;
   if it still holds an old address such as `noreply@fencepro.com`, the
   company name is used instead.
5. Restart: `pm2 restart ezbiz --update-env` (or `bash ~/ezbiz/deploy/mac/update.sh`).
6. Check: **Admin > Integrations**, card **Email**: "Set up: Yes", the server
   and the from address (the password is never shown). Press **Send a test
   email to me**: it goes to your own login's address and shows "Test email
   sent" or the exact reason it did not go (wrong App Password, port blocked,
   server not found). `curl -s localhost:4000/api/health` also shows
   `"email":{"status":"ok"}`.

Google's limits for a paid Workspace account (Google's "Gmail sending limits
in Google Workspace" page, checked Oct 22, 2026): 2,000 messages a day per
mailbox (500 on a trial), 10,000 recipients a day, rolling 24 hours, and at
most 100 recipients per message sent through SMTP. Over the limit Google
stops that mailbox from sending for up to 24 hours. The app sends one
recipient per message, far below that.

SPF and DKIM for gdfencepro.com (what keeps the mail out of spam) are DNS
records at the website company that holds the domain. Ask them to make sure
SPF includes `include:_spf.google.com` and that Google's DKIM key from
**admin.google.com > Apps > Google Workspace > Gmail > Authenticate email**
is published and turned on. Nothing in this app or on this Mac changes DNS.

### SendGrid instead

`SENDGRID_API_KEY=<key>` plus `SMTP_FROM_EMAIL=<an address verified as a
sender, or on a domain authenticated in SendGrid>` and `SMTP_FROM` for the
name. When a SendGrid key is set it is used instead of the mail server
settings. Restart and test the same way.

### The working folder

The dev copy keeps all of these empty (section 15): its database holds real
customers' addresses. The tests start their own fake mail server on the
Mac itself and never send real mail.

## 19. Staff sign in by cookie (DEV, Oct 22, 2026)

Plan: `~/Downloads/staff-signin-plan-2026-10-20.md` (stages A, B, C built;
D built as a switch that is off).

**What changes for staff at the deploy.** Nothing to do for most people.
The app no longer keeps a sign in in the phone's storage. Signing in sets a
cookie, `ezbiz_staff`, that the page cannot read (HttpOnly), is sent only to
`/api`, never from another site (SameSite=Strict) and only over https (plain
http only on the Mac itself). A sign in lasts 30 days since it was last used,
90 days at most. It ends at once on Sign out, on ending it in Settings >
Team > Active Sessions, on a password change (every other device), or when
the login is switched off, given a new role or deleted. The sign in page no
longer fills in the last email (the phone's password manager does it).

**How phones move over.** On the first open after the deploy, the app swaps
the sign in it kept in storage for the cookie, once (one tab at a time), then
deletes the old keys. With no signal it shows "No signal" and tries again
every 15 seconds. If that phone's stored sign in had already run out (not
opened for 7 days), that person types the password once. Nothing waiting to
be sent is lost: the outbox, photos and voice clips stay on the phone and go
after the same person is signed in. Team > Active Sessions marks phones not
moved yet "Old sign in (moves over on next open)".

**iPhone.** The installed home-screen app keeps its own cookies, apart from
Safari. Sign in inside the installed app, and use it rather than a Safari tab.

**Old data in the browser.** On load the app deletes everything an older
version kept in browser storage (the Settings copy, the budget copy, who was
signed in, old one-time move flags, old customers/quotes/jobs copies) without
reading or uploading it. Kept: the board choices (folded columns, view,
sort), and the offline queues, now encrypted.

**Offline queues, encrypted.** Unsent changes, photos, video, invoice files
and voice clips are sealed with AES-GCM before they are written to the phone.
The key is made on the phone as a non-extractable WebCrypto key, kept in
IndexedDB; no script can read its bytes out. Signing out with something
unsent asks first.

**Every save carries `X-Staff-Request: 1`.** The app adds it. A save with the
cookie but without the header counts as not signed in (protection against
other websites). Scripts that save must send it (and the cookie), or use the
old token while it still works.

**Stage D: turn the old token off.** 30 days after the deploy (when Team >
Active Sessions shows no "Old sign in" rows), add to `~/ezbiz/apps/portal/.env`

```bash
STAFF_COOKIE_ONLY=1
```

then `pm2 restart ezbiz --update-env` (or `bash ~/ezbiz/deploy/mac/set-secret.sh`).
With it on: every staff Bearer token is refused (401 `BEARER_RETIRED`), the
renewal (`/api/crm-auth/refresh`) and the move over (`/api/crm-auth/move-over`)
are closed, and every sign in is a cookie. Anyone not moved over by then signs
in with the password once. Take it off again by removing the line and
restarting. The move-over code itself can then be removed from the app
(crmAuth.ts `moveOverOldSignIn`).

**The read only live checker.** It no longer reads the live settings file or
signs anything with the live secret. On the Mac:

```bash
cd ~/ezbiz/apps/portal && npx tsx scripts/readonly-session.ts      # 3 hours, read only
cd ~/ezbiz/apps/portal/../web && node e2e/live-readonly.mjs        # opens localhost:4000
cd ~/ezbiz/apps/portal && npx tsx scripts/readonly-session.ts --end   # end it early
```

The session shows in Settings > Team > Active Sessions as "Read only checker
on the Mac" with its end time, and can be ended there. The server refuses
every save made with it (403 `READ_ONLY`), and refuses it altogether
(401 `READ_ONLY_NOT_HERE`) unless the request is made on the Mac straight to
the server: from the Mac's own address (localhost or its own Tailscale
address), with no proxy headers (Tailscale serve and Funnel add them) and
Host naming the Mac. Only the script makes one; there is no web route for it.

**Risks.** A dev browser on `localhost:4001` and the live server on
`localhost:4000` share cookies (cookies ignore the port): opening both in the
same browser signs the other out. Use the Tailscale address for live.
Renaming the Mac's Tailscale name signs everyone out.
