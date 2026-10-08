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
| Working copy | the folder in Downloads. Edit and commit there, never in `~/ezbiz` | |
| Server | one Node 22 process under pm2, named `ezbiz`, port 4000, this Mac only | at login (`com.ezbiz.pm2`) |
| Database | Postgres 16 on this Mac, database `ezbiz` | at login (brew services) |
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

Optional: SendGrid or SMTP for email, Twilio for text messages, Google keys
for calendar and maps.

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

**Public (intake only).** Tailscale Funnel opens port 8443 of the same name to
the internet, and only two paths are connected to it: `/api/quoting` for the
website widget and `/api/intake/retell` for the phone agent. The sign in page
and the rest of the API are not on that port.

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
