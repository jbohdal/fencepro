# EZ Biz: go live

Written 2026 10 07 for the `finalize` branch. This is the one document to follow
to put this build into daily use. It replaces the older setup and deployment
notes wherever they disagree.

EZ Biz (this repo) is the one build. The EZ Quote website widget stays a
separate app (the `EZ-Budget` folder) and sends finished quotes into EZ Biz.
The phone agent (Retell) sends finished calls into EZ Biz the same way.

---

## 1. Close the hole on the live server first

The code that was on `main` before this branch lets anyone on the internet
read any file on the server through `/api/portal/files/`, including the
settings file that holds the database password. This branch fixes it. Until
the fix is deployed:

```bash
ssh root@YOUR-SERVER
pm2 list                 # the process is named fencepro or fencepro-portal
pm2 stop fencepro        # use whichever name the list shows
```

After the new code is live, treat every secret that was in the settings file
as exposed and replace it (section 3 lists them). Change the database password
in DigitalOcean too.

Nothing here could reach the live server to confirm which code it is running.
If the server was already off or on different code, this step costs nothing.

## 2. Get the code to GitHub

The branch is `finalize`, eight commits on top of `main`. Look it over, then:

```bash
git checkout main
git merge --ff-only finalize
git push origin main
```

## 3. Settings file on the server

The live settings file is `/var/www/fencepro/portal/.env`. The deploy script
copies it into the build, so a code update can never overwrite it. Start from
`apps/portal/.env.example`.

Make each secret with `openssl rand -hex 48`. Use a different value for each.

| Setting | What to put | If it is missing |
|---|---|---|
| `DATABASE_URL` | The Postgres connection string, with the new password | Server cannot save anything |
| `JWT_SECRET` | New random secret | Server invents one at every restart, so you are signed out on every restart |
| `JWT_REFRESH_SECRET` | A different new random secret | Same |
| `CRM_SYNC_KEY` | New random secret | Server to server sync is refused |
| `CRON_SECRET` | New random secret | Scheduled jobs can only be started by a signed in admin |
| `NODE_ENV` | `production` | Development shortcuts stay on |
| `APP_URL` and `CLIENT_URL` | `https://systemssyndicate.com` | Links in emails point at localhost |
| `EZ_QUOTE_WIDGET_TOKEN` | New random secret | Website quotes are refused (intake stays off) |
| `EZ_QUOTE_ALLOWED_ORIGINS` | Where the widget is hosted, comma separated, for example `https://gdfencepro.com,https://www.gdfencepro.com` | Browsers on your website cannot post quotes |
| `RETELL_API_KEY` | The Retell API key that carries the webhook badge | Phone calls are refused (intake stays off) |

Optional, unchanged by this branch: SendGrid or SMTP for email, Twilio for
text messages, Google keys for calendar and maps.

## 4. Deploy

```bash
ssh root@YOUR-SERVER
cd /var/www/fencepro/repo
git fetch origin && git checkout main && git pull
bash deploy/deploy.sh
```

The script backs up the database, builds everything, checks that the database
change only adds things, applies it, copies the files, restarts the server and
waits for it to answer. It stops at the first problem and says why.

This branch adds to the database and removes nothing:

* `SavedQuote.pricing`: the pricing choices made on one quote
* `AccountKeyValue`: the data that used to live only in one browser
* `IntakeLead`: website quotes and phone calls as they arrive

`deploy/nginx.conf` was corrected too (API paths that end in `.png` or `.pdf`
were being treated as files on disk). The live nginx file was edited by certbot
and may differ from the one in the repo, so compare before replacing:
`nginx -T | less`.

**The deploy script and the nginx file were rewritten here and have not been
run against the real server.** Read the output the first time. The backup from
step 2 of the script is the way back.

## 5. Sign in

If your login already exists on the live database, sign in as before. The
first sign in links it to the company so every module opens.

If the database is new, or you are locked out:

```bash
cd /var/www/fencepro/repo/apps/portal
node --import tsx scripts/create-owner.ts you@example.com 'a long password' 'First Last' 'GD Fence Pro'
# add --reset to set a new password on an existing login
```

Do not run the demo seed on the live database.

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
NEXT_PUBLIC_CRM_API_BASE=https://systemssyndicate.com/api
NEXT_PUBLIC_CRM_WIDGET_TOKEN=<the same value as EZ_QUOTE_WIDGET_TOKEN>
```

No code change is needed in the widget. When a customer finishes a quote, EZ
Biz finds the customer by email or phone (or creates one), adds a note with
the quote, raises a notification and puts a card on the pipeline. Sending the
same quote twice does not create a second copy.

## 8. Connect the phone agent

In Retell, set the webhook URL to:

```
https://systemssyndicate.com/api/intake/retell
```

Every webhook is checked against `RETELL_API_KEY`, so only Retell can post
there. When a call has been analyzed, EZ Biz files it the same way as a
website quote, and creates a call back task if the caller asked for one.

## 9. Check it

After the deploy:

1. `curl -s https://systemssyndicate.com/api/health` answers.
2. `curl -s -o /dev/null -w '%{http_code}\n' 'https://systemssyndicate.com/api/portal/files//etc/passwd'`
   must not print `200`.
3. Sign in. Create a customer and a quote for that customer. Reload the page.
   Both are still there.
4. Sign in from a second browser or your phone. The same customer and quote
   are there.

The checks used to verify this branch are in `apps/web/e2e` and in
`apps/portal/tests`. `apps/web/e2e/README.md` says how to run them.

## 10. What was verified, and what was not

Verified on a private copy (real server code, real Postgres, real browsers):

* 129 unit tests pass; server and web typecheck and build clean
* two browsers on one login see each other's customers, quotes, jobs,
  schedule, inventory, vendors, pipeline, invoices and payments (27 of 27)
* a website quote and a signed Retell call both land as customer, note,
  notification and pipeline card; forged and replayed calls are refused
  (14 of 14)
* every screen opens without an error (25 screens)

Not verified, because it could not be reached from where this was built:

* the live server, its database and its nginx config
* the deploy script on the real server
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
* Uploaded files are stored on the server's own disk. They survive a deploy,
  but they are not in the database backup.
