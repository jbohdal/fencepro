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
| `lead-assign.mjs` | A website quote nobody is assigned to: one push to the owner in the dev outbox (who, where from, town, what they asked for); on the owner's iPhone the Dashboard says it is waiting, a tap opens its Assign screen, one tap gives it to the Salesman, who has it at once; the Salesman cannot assign; assigning it again says who has it; the History says who assigned it. The push's link loaded fresh (as an iPhone opens it) and the bell entry both open the Assign screen. Moving a lead someone has asks first with both names; No and a tap on the person who has it change nothing. Needs the server started with EZ_QUOTE_WIDGET_TOKEN (WIDGET_TOKEN) and OUTBOX set. |
| `install-crew-day.mjs` | An install booked on a day the crew does not work, on the owner's iPhone (WebKit): the booking window says so before Book (Schedule settings, the job's weekend tick) and Book waits; when that check cannot run the server refuses, the window shows its reason and stays open, and nothing is kept on the phone (no badge, no Next appt, also after a reload) or booked. Books nothing. Dev copy or a worktree's own server. |
| `salesman-choice-booking.mjs` | New Customer with Book estimate now and the Salesman choice: the Salesman on an iPhone gives the customer to the owner and books the estimate with the owner (the booking opens over the list, "With" on the owner, the server has it, the customer leaves the Salesman's list); closed without booking it says it was not booked and who to ask; the owner and the office on a computer pick Christa and book it with Christa. Dev copy or a worktree's own server; removes its SMBOOK customers. |
| `every-screen.mjs` | Every screen opens with no console errors, failed requests or blank pages. |
| `kanban-drag.mjs` | Sales Pipeline board at desktop and phone sizes: column layout, wheel and swipe scrolling, dragging a card to a column that starts off screen, to a spot far down a long column, into a collapsed column and onto a header, with each move checked on the server; the Signed Contract question, quick view, customer page, list view, and a stale browser's save being merged. Needs real pipeline data, so it runs on the dev copy (`ezbiz_dev`, API on 4001) rather than an empty database, and refuses port 4000. |
| `budget-edit.mjs` | Budget page number boxes on an iPhone (WebKit), a 360 px phone and a computer: 44 px boxes with the decimal keypad and labels on screen, tap selects the whole number, typing over it key by key with no reformat or cursor jump, Backspace, paste "$1,234.50", Enter and Tab to the next box, Escape, a refused "-", Saved and Undo, totals and the budget plan's margin following right away, monthly and yearly linked, and the numbers still there after a reload. Puts the budget back exactly as it was. Dev copy only (`SIZES=iphone,phone360,desktop`, `SHOTS=<folder>`). |
| `dispatch.mjs` | Dispatch map pins at desktop and phone sizes: each pin in its Operations stage color (Settings, by stage id), a crew's ring color and initials (by crew id or by name), the customer's initials with a dashed ring when there is no crew, never "?", and the legend (folded on a phone). Writes nothing (crews are added to the job list on its way into the page). Dev copy only. |
| `round1-fixes.mjs` | Walkthrough round 1 fixes (Oct 25), phone (WebKit, iPhone size) and computer: a website lead with a site visit, Ready to quote opening the website draft (same quote, Yard step, drawing, visit footage, notes and photo; still one quote); a Salesman's Today tasks and photo dates with no "Invalid Date"; the Website quote notification opening the card window; the card's New quote opening the same draft; vendor invoice uploads saying uploaded / not a PDF / turned down (why, Remove); Smart Schedule "sections"; WT Linda Park's repair items on the job and the "Broken or sagging gate" note; the address lookup not offering far away cities. `E2E_STAFF_COOKIE` (scripts/dev-session-token.ts --cookie); `ONLY=phone` or `ONLY=computer`. Dev copy only; its lead, visit, photo, notification and uploaded invoice are removed. |
| `customer-page.mjs` | The customer page on a computer (1440 x 900) and an iPhone 13 (WebKit), with a customer who has 60 notes and 110 photos: the header (address with a maps link, phone, email, rep, lead source) and the actions always on screen, the summary row, every tab opening with ?tab= in the address, no element on the page scrolling on its own, the header and tabs staying at the top while the page scrolls, Show more on notes, activity and photos (lazy loaded thumbnails), ?tab= links and reloads, Back / Escape closing Edit. Dev copy (or a worktree's own server); its customer, notes and photos are removed. |
| `nightly-walkthrough.mjs` | The nightly 3 job walkthrough (GO_LIVE.md section 20), each step as its person on their device: Job A white vinyl no dig from the lead to Paid (visit, quote, signed, deposit, 811 and permit, scheduled on a crew day, packet with no prices, Start, Finish, walkthrough, final payment, closes itself); Job B 4 ft chain link dig set with a Salesman change order OK'd by the office and one from the job's drawing, both signed, the contract adding up; Job C walk-in repair to Paid. PASS / FAIL / SKIP per step with times, a screenshot of each failure (`SHOTS`), JSON (`RESULTS`), `JOBS=A,B,C`, `KEEP=1`. Makes and removes its own logins and NIGHTLY customers. Dev copy or a worktree's own server. |
| `appointments.mjs` | Appointments at desktop and phone sizes: booking from the customer page, a pipeline card and the global button (with the confirmation offer), a drop into the Appointment column opening booking, dragging to reschedule on the week view (reason and old time kept), and the phone Today screen: On my way text, Navigate, Complete with Ready to quote landing in a quote with the property and measurements, and the pipeline card moving. Dev copy only, like `kanban-drag.mjs`. |
| `stale-prices.mjs` | Broken list #58: an app already open on a phone (WebKit) with a draft in the quote builder; the owner raises a part's cost. Save shows "Prices changed since you opened this quote. It is now $X (was $Y)." and saves only after "Save at $X" (the server has $X, no 409, no reload); opened again, no line; the cost put back, the open builder follows by itself and says so; a save on an old stamp is refused (409 PRICES_CHANGED). Puts the cost back; removes its quote and customer. Dev copy or a worktree's own server. |
| `salesman-live-overhead.mjs` | Money (Oct 30 2026): with live overhead on, the same yard drawn on the website (test mode) as a new draft of the Salesman's: the owner's builder on a computer and the Salesman's on an iPhone (WebKit) both show the website's price, both phones got the same live overhead from the server, and her save stores that price at that overhead (before the fix her phone priced at the typed 30%, about 12% lower). `E2E_OWNER_COOKIE`, `E2E_SALES_COOKIE`, `E2E_SALES_TOKEN` (scripts/dev-session-token.ts). Dev copy or a worktree's own server; its customer and quote are removed. |
| `save-conflicts.mjs` | Ordinary saves go once: the office (computer) and the Salesman (iPhone, WebKit) each keep one tab open, as at work, through two leads, a booked visit, the visit completed and the quote saved and sent, the customer signing, the install scheduled, the next visit booked and the next quote saved. Every save of the Sales Pipeline board and the business record is watched; any 409 fails it (the dev copy is shared: another run saving in the same second can still cause a real one, printed with its versions). Dev copy or a worktree's own server; its logins, customers, quotes, job, visits, pull sheets, checklist and Sales Order are removed. |

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
