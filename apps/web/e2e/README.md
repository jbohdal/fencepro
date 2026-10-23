# Browser tests

These drive the real app in a real browser against a real server and
database. They are the automated version of the "two browser sync test":
one browser makes changes, a second brand new browser logs in and has to see
them.

**They write test data. Run them against a local, empty database only.** The
scripts refuse to run unless both URLs are localhost.

## What each one covers

| Script | Checks |
|---|---|
| `two-browser-sync.mjs` | Inventory, settings, vendors, customers, quotes, jobs, checklists, pipeline, schedule, job costing, change orders, site plans and billing all reach a second browser. A new browser logging in wipes nothing. A save made with an expired login still lands. A module that failed to load refuses to save. |
| `intake.mjs` | A website quote and a phone agent call each become a customer, a note and a pipeline card. Repeat contact makes no duplicates. |
| `every-screen.mjs` | Every screen opens with no console errors, failed requests or blank pages. |
| `kanban-drag.mjs` | Sales Pipeline board at desktop and phone sizes: column layout, wheel and swipe scrolling, dragging a card to a column that starts off screen, to a spot far down a long column, into a collapsed column and onto a header, with each move checked on the server; the Signed Contract question, quick view, customer page, list view, and a stale browser's save being merged. Needs real pipeline data, so it runs on the dev copy (`ezbiz_dev`, API on 4001) rather than an empty database, and refuses port 4000. |
| `dispatch.mjs` | Dispatch map pins at desktop and phone sizes: each pin in its Operations stage color (Settings, by stage id), a crew's ring color and initials (by crew id or by name), the customer's initials with a dashed ring when there is no crew, never "?", and the legend (folded on a phone). Writes nothing (crews are added to the job list on its way into the page). Dev copy only. |
| `appointments.mjs` | Appointments at desktop and phone sizes: booking from the customer page, a pipeline card and the global button (with the confirmation offer), a drop into the Appointment column opening booking, dragging to reschedule on the week view (reason and old time kept), and the phone Today screen: On my way text, Navigate, Complete with Ready to quote landing in a quote with the property and measurements, and the pipeline card moving. Dev copy only, like `kanban-drag.mjs`. |

## Signing in (since Oct 2026: the `ezbiz_staff` cookie)

The app keeps no sign in in browser storage. New tests sign a context in with
`signInByCookie(ctx)` from `lib.mjs`: a cookie made with
`npx tsx scripts/dev-session-token.ts --cookie --out <file>` (E2E_STAFF_COOKIE),
a password, or the old E2E_ACCESS_TOKEN moved over once. Older suites that put
E2E_ACCESS_TOKEN in localStorage still work until stage D: the app moves it
over to a cookie on its first load. `staff-signin.mjs` covers the sign in
itself on desktop Chrome, WebKit (iPhone size) and the Android emulator.

## Real iPhone Safari (`iphone-safari.mjs`)

Mobile Safari in the iOS Simulator, driven by Apple's `safaridriver` (W3C
WebDriver, spoken with `fetch`: no extra package). Dev copy only: it refuses
anything but `http://localhost:4001` and an `apps/portal/.env` that names
`ezbiz_dev`. It covers phone fit (phone-fit.mjs's own checks, and the menus over
the maps), the website quote in test mode (address suggestion, the sharp aerial
photo, fence points and a gate tapped on it, the prices), "Choose from gallery"
with a photo and a video, Payment received and the public receipt link, the
customer portal invite and sign in (Billing, Documents), and Add to Home Screen
(manifest, apple-touch-icon, apple-mobile-web-app tags, start URL). It makes one
test customer with a sold job, and its own dev sign in, and removes them all.

Once on the Mac: Xcode with the iOS 18.5 simulator runtime
(`xcodebuild -downloadPlatform iOS -buildVersion 18.5`). If safaridriver says
remote automation is off, run `safaridriver --enable` once (admin password).

```bash
cd apps/web
APP_URL=http://localhost:4001 API_URL=http://localhost:4001 \
  MEDIA_PHOTO=/path/photo.jpg MEDIA_VIDEO=/path/short.mp4 node e2e/iphone-safari.mjs
#   DEVICE='iPhone 16' IOS=18.5                 the simulator (Safari only)
#   AREAS=fit,quote,media,payments,portal,home  some areas only
#   SHOTS=<folder>                              failure screenshots (default ~/Downloads/ezbiz-screens-2026-10-17)
#   DRIVER=webkit | DRIVER=chromium             the same steps in Playwright at 393 x 852,
#                                               to tell an iPhone-only failure from a general one
```

What it cannot do: tap Safari's Share sheet or "Add to Home Screen" (that is
iOS's own screen, out of WebDriver's reach), or open the app from the Home
Screen, so standalone mode is checked through what the page declares and
`navigator.standalone` (false in a Safari tab). The iOS photo picker and
camera are iOS's own screens too: the files go to the same file input.
Simulator quirks it works around (said in the code): a tap's lift is held
back until the next command, so each tap releases it at once; and the
Simulator's keys reach the page but insert no text, so a field left empty is
set the way the keyboard leaves it (the run prints which).

## Heavy runs and business hours (`run-heavy.sh`)

The live app runs on the same Mac. Jonathan's rule: **no heavy test runs
between 07:00 and 18:00 local** (he is using the live app then) unless he asks.
A full regression, the Android emulator and the iOS simulator count as heavy.

```bash
bash apps/web/e2e/run-heavy.sh --check                 # allowed now? (exit 0 yes, 3 no)
E2E_ACCESS_TOKEN=<dev token> bash apps/web/e2e/run-heavy.sh all          # every suite on the dev copy, one at a time
E2E_ACCESS_TOKEN=<dev token> bash apps/web/e2e/run-heavy.sh suites kanban-drag card-phone follow-ups
CDP_URL=http://localhost:9333 bash apps/web/e2e/run-heavy.sh -- node apps/web/e2e/field.mjs   # an emulator run
```

- Refuses to start between 07:00 and 18:00 unless `FORCE_BUSINESS_HOURS=1`
  (only when Jonathan asked), and refuses port 4000 or a Tailscale address.
- Runs at low priority (`nice -n 15`, `taskpolicy -b`: the live server goes first).
- Shuts down the Android emulator, every booted iOS simulator and the
  Playwright browsers it left when it ends, also after a failure or Ctrl-C
  (`KEEP_DEVICES=1` keeps them).
- `all` leaves out the helpers, the read only live and public site checks, and
  `two-browser-sync` / `intake` (those need an empty database, see below);
  `SKIP="a b"` leaves out more. One log per suite in `LOGS` (default
  `~/Downloads/ezbiz-e2e-<date-time>`), `PAUSE` seconds between suites (20).
- `devOnly.mjs` (imported by every test) also refuses the Android emulator
  (`CDP_URL`) and the iOS simulator (`iphone-safari.mjs` with Safari) in
  business hours, however they are started. Small targeted runs in Chromium or
  WebKit are not affected (still run them with `nice -n 15`).

## Phone load times (`perf-phone.mjs`)

Read only: it opens screens and measures, and stops every request that is not
a GET. Time to usable for start (signed in, page load to the tab bar),
Pipeline, the Customers list, a customer page, Follow ups and the quote
builder; bytes downloaded at start; DOM nodes and JS heap on the board; long
tasks (Chromium).

```bash
TARGET=live THROTTLE=1 node e2e/perf-phone.mjs     # live (localhost:4000, the 3 hour read only session), phone CPU 4x slower + 4G
TARGET=live ENGINE=webkit node e2e/perf-phone.mjs  # live in WebKit at iPhone size
TARGET=dev E2E_ACCESS_TOKEN=<dev token> THROTTLE=1 RUNS=3 OUT=after.json node e2e/perf-phone.mjs
```

## Running them

1. A local Postgres with an empty database, and the server pointed at it:

   ```bash
   cd apps/portal
   export DATABASE_URL=postgresql://USER@127.0.0.1:5432/ezbiz_test
   npx prisma db push
   npx tsx scripts/create-owner.ts you@example.com 'a-test-password' 'Your Name' 'Test Co'
   JWT_SECRET=local-test-secret JWT_REFRESH_SECRET=local-test-refresh \
     EZ_QUOTE_WIDGET_TOKEN=test-widget-token RETELL_API_KEY=key_test \
     DISABLE_CRON=1 PORT=4003 npx tsx src/server/index.ts
   ```

   Never port 4000: on the Mac mini that is the live server.

2. The web app, in another terminal:

   ```bash
   cd apps/web && VITE_API_PORT=4003 npx vite --port 5274
   ```

   Then set `APP_URL=http://localhost:5274 API_URL=http://localhost:5274` (the
   web server passes /api on to 4003, and the tests watch requests by that
   address).

3. Playwright, once:

   ```bash
   pnpm add -D -w playwright && npx playwright install chromium
   ```

4. The tests, each on a freshly emptied database:

   ```bash
   cd apps/web/e2e
   export E2E_EMAIL=you@example.com E2E_PASSWORD='a-test-password'
   node two-browser-sync.mjs
   EZ_QUOTE_WIDGET_TOKEN=test-widget-token RETELL_API_KEY=key_test node intake.mjs
   node every-screen.mjs
   ```

`two-browser-sync.mjs` and `intake.mjs` assert exact counts, so empty the
database between runs (drop and recreate it, `prisma db push`, create the
owner again).
