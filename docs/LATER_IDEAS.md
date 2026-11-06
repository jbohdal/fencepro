# Later ideas

Things Jonathan said not to build now. Each names when he said it. Nothing here is started without his word.

## Draft purchase orders (Oct 28 2026)

- Send a draft purchase order to the supplier from the app. Not now: "I order myself." (A hand move's draft names no supplier, and the app has no PO email.)
- Edit a draft's lines. Not now: "The Sales Order is the one list to correct."
- Combine drafts for the same supplier into one order. Not now. (purchaseOrderStore.consolidatePOs exists, unused.)

## From the Oct 28 night reviews (not broken money, lost data or a customer-facing error)

- The Salesman sees every company job on the Schedule's Ready to schedule tab (the Schedule stays company-wide by Jonathan's word; revisit with the privacy rule).
- Dashboard "Quoted" counts an archived draft that the Quotes list leaves out (open quote count is right).
- Customer Activity wording: an all-day install reads "12:00 AM", and Activity still says "Oct 28 at 8:48 PM" (Job history is right).
- Yard step: "Draw on photo" says "Type the property address first" before the address box shows.
- Back from a job window opened from a draft purchase order lands on the Operations board, not Inventory (it closes in one press).
- Deleting a job leaves its draft purchase order a draft ("The job is no longer on the board").
- Deleted Records names a job by its style code; the Assign screen shows phone numbers unformatted; the Balance due tile wraps on a phone.
- Mark Received: the Received column still shows 0 and the low-stock warning stays afterwards. (Whether receiving should lower or raise stock is on Jonathan's list.)
- Test clean-ups leave orphan Sales Orders on dev (dev only).

## From the Oct 28–29 night (reviewers and the browser run)

Not money, lost data or a customer-facing error, so not fixed tonight (Jonathan, Oct 28: "Nothing new gets added tonight").

- iPhone (WebKit) page crash after saving a quote on the Quotes page, then opening /quotes?quote=… (site-plan-rotate suite). First bad commit 2c91b8f (on main since Oct 27). Check on a real iPhone with #17. Narrowed Oct 31: Playwright's WebKit only so far (real iPhone Safari not checked); any reload or link out of that page after a save that opens the quote window there (Back first too), never after a save from another screen or a window opened by hand; the save is already on the server. The suite goes through about:blank to run on past it.
- Pricing check: a 3-post repair quote says "A new fence may be the better deal: $633 new vs $1,028 repair".
- The contract's default term says "A 50% deposit" whatever percent the proposal uses (web contractTerms.ts).
- A deposit percent over 100 is not refused by the server (Settings stops at 100).
- The customer portal's "outstanding" adds old Billing invoices to schedule balances; could count twice if a job has both.
- Adding a photo cuts the company activity log to 1,000 entries (CustomerPhotosTab.tsx); the main logger keeps 2,000. Live has 43 today.
- Phone menu (More): Customers, Quotes, Schedule, Service and Site Plans are below the fold.
- A quote opened from a customer's Quotes tab has no Edit (Edit works from Quotes). Every role.
- Today says "Nothing booked today" while Dashboard › Today lists the Salesman's customers booked with the owner.
- Salesman phones get one quiet 409 on their first save after each server restart (privacy's remembered copies are in memory).
- Salesman choice: after a change, the message doesn't say whether the old Salesman keeps the customer (they do when they made a quote or have a visit booked); the Salesman gets no notice when a lead is given to them; History reads "Lead assigned to X by X. It was Y's." for a customer change; "(me)" sits mid-list; the rep filter lists both "Christa" and "Christa Feagin" (older data); an old push link after assignment doesn't say who assigned it.
- A Salesman who books the estimate for a customer they gave away: the card stays in First Contact (the owner's or office's booking moves it to Appointment).
- Booking dialog lists every timed appointment that person has that day as "already booked" for an all-day install.
- A 409 refusal on an appointment (stage blocked, changed on another device) still shows "Couldn't save".
- Browser suites sent-tiers, small-fixes-1028, review-1028-fixes and review-1028-office need cookies or a sent quote the nightly runner can't give them; they run by hand.
- Reviewer agents leave RVW jobs on ezbiz_dev that make data-picking suites flaky; automations.db "a step that needs the job…" failed once in a full run, passed twice alone.

## From the Oct 29 night (reviewers; not money, lost data or customer-facing errors)

- Christa's Schedule: tapping a Ready card or install opens the Move editor and says "Not saved"; she needs a read-only view. Her view lacks the "No 811 ticket" warning on others' installs.
- Sales Order: the per-part "Received" column stays 0 after Mark Received.
- A phone lead's push and Assign screen don't show the callback time; a callback's Today card offers Navigate / "On my way".
- Settings > Team: the Direct phone hint still says appointment texts use it; an edited template with {rep_phone} would send the rep's cell again.
- Repeat lead push leaves out the footage; a lead between midnight and 8 am gets its 8 am push the next morning (about 31 hours).
- "Low stock" warning on almost every sale now that job materials don't use shop stock.
- Sales by rep and the Signed Contract column total add quote prices with cents (up to 50¢ each, older cents proposals only).
- Old cents proposals still show cents per foot; the customer page tile says "Balance due" for the full amount right after signing.
- Moving one quote's Salesman leaves the old name on the stored board card; a new Salesman gets no push or bell when given a customer; Sales by rep splits Christa into three spellings.
- A quote opened from the customer page has no Edit; "0 of 2 photos ticked" with no photos.
- 8 ft: a draft reopened after a Settings price change reprices without saying so; the pull sheet lists the 8 ft section by a generic name next to $0 pickets.
- e2e: the appointments suite leaves Michael Green booked Nov 2–3 on dev (booking suite fails until Nov 9); schedule-install drag and site-plan-rotate (WebKit crash) fail on main too.

## From the Oct 30 night (iPhone run)
- Nightly: dev sign-in files stop working after each refresh of ezbiz_dev; make new ones at the start of the run.

## From the Oct 31 night (nightly triage)

- Change order window on the customer page says "Change order CO-1" when it will be CO-3 (`ChangeOrders.tsx`, `existingCount + 1`). The saved number and its toast are right. Staff screen only.
- The API limit (600 a minute per address) answered 429 on a change order save during a test and the window just stayed open. Not seen in real use; a save refused this way should say so.
- `sales-orders` e2e: "AUD Web Chainlink" is a dev-only audit job that dev no longer has; the fixture needs rebuilding.
- `quotable-styles` e2e: stale. The server now refuses a new quote on a held style on purpose, so the test gets no quote to open; it needs a saved quote made before the hold.
- `salesman-live-overhead` e2e needs its three sign-in settings in the nightly.
- `budget-edit` failed once on desktop only and did not repeat; watch it.
- WebKit page crash when leaving the Quotes page after a save (Oct 27 item): `site-plan-rotate` goes round it through about:blank. The crash stack needs Jonathan's OK to read the crash reports.
- Settings save: when the server took a save but its answer was lost, putting the value back sends nothing. Rare.
- Same choice added on two phones at about the same time doubles its fences (42 fences, 21 names). Rare.
- A Settings fence edit stuck on a phone, with that fence removed elsewhere, is dropped with no word when prices are read (`refreshPriceFields` ignores what merge3 could not apply).
- The "not everything could be saved" message names a fence by its internal code (`label()` in merge3.ts takes name before label); the save bar can show Saved next to it.
- After a merge the Settings page reloads itself and an open Fences list closes.
- A quote made on another phone lands at the very bottom of an open Quotes list, past Show more, until a reload. The count and tile update.
- Quotes page: margin colors keep the old Settings until the next redraw after another phone changes a Target Profit. Any touch updates them.

## From the Oct 31 change order pricing review

- Run list only: a gate taken out and more gates added in one change order bills 1 line post too many (vinyl [60] to [48], 1 walk out, 2 doubles in: $81 over). The opening counts every gate added, not the net. Drawings are fine.
- Run list only: [40,20] to [40,30,8] plus a gate, a run growing and a new stretch together, can keep 1 extra line post.
- Drawing, wording only: "N ft becomes the gate" can name the wrong gate when a side's length changes and a wider gate of the same kind is on a later side. The price is right.
- Forced rails on a drawing: QuoteBuilder sets drawn runs to auto (since 02a8a08, Oct 14), so a forced-rail job changed by drawing moves to auto rails, in price and pull sheet. Up to $379 on a test job; nearly never reached. Live not checked.
- Staff words: during a change order the Price tab's "At today's costs it would be $X" is the whole roll figure. On a move, "Price difference at today's prices" is no longer strictly true with fabric by the foot.
- Per-foot quote: adding a gate comes out negative (-$100), the 2 posts never reach the price. Older than this work; 0 such quotes on dev.
- Gate rule on wood is not verified: the wood kits are archived on dev.
- Mixed rails on the two pieces of a split run put all the rail change on the gate line.
- Server `changePrice` has no login that reaches it today except by API.
- Sales Orders: Manuel Cotrich's order (paid, received) is not marked to stay; a change order on that job would rewrite it. The backfill writes no audit row.
- WebKit crash reports on the Mac (23): all the Playwright test build (623.1.10+). 19 are Navigation::initializeForNewWindow, 4 its network process. Not real Safari; a test browser bug, no app fix.

## From the Nov 1 night (nightly triage)

- Tests add 24 hours for "tomorrow": automations.db dry run and locateStageMove.db fail on the 25 hour day clocks go back (Nov 1). The app is right; use calendar days in the tests.
- feedback.db "lists it since today" failed just after midnight that night. Check that scripts/feedback-report.ts `--since` uses the day's real offset, not a fixed one.
- automations.db "with conditions" needs ADDRESS_DATA_DIR, so it fails in a worktree without the county list.
- save-conflicts "the next quote is saved and its card moved on" failed once in the full run, then passed 14 of 14 alone.
- staff-signin: WebKit "Page crashed" once in the full run, then 49 of 49 alone. The test build's crash, as in the Oct 31 reports.
- address-suggest.mjs hardcodes localhost:4001, so a worktree nightly tests the folder's server for that suite. Other suites may do the same; 109 suites default to 4001.
- Still failing, known: sales-orders (AUD Web Chainlink fixture), quotable-styles (stale), builderProposalBetter and contractBilling (2) on dev data, devDbScrubbed (CrmContact (352) 789-4314).

## From the Nov 2 night (nightly triage)

- contractBilling is not dev data, as noted above. Both failures come from running in a worktree: "never share a number" needs more than connection_limit=4, and the payment photo 404s because res.sendFile refuses a path under `.claude/`. With limit 10 and UPLOAD_DIR outside `.claude/`: 9 of 9. Live's uploads are under ~/ezbiz, so live is not affected. Have the nightly worktree set both.
- devDbScrubbed: (352) 789-4314 is the company's own office line on a dev contact, not a customer's number. The test could allow it.
- E2E_SALES_TOKEN and E2E_SALES_COOKIE mean a file path to salesman-live-overhead but the value itself to option-lists, pipeline-stages, round4-co and visit-quote-send, so no single setting works for all five in `all`. Make salesman-live-overhead accept the value.
- Still failing, known: sales-orders (AUD Web Chainlink fixture), quotable-styles (stale), builderProposalBetter (dev data).

## From proposal options of any style (Nov 2)

- Playwright's WebKit page crashed twice on a second `page.goto` after the quote builder had been open. A fresh context did not, and iphone-safari passes. Could be the #17 memory question; not traced.
- The dev database has no active office login, so salesman-choice and salesman-choice-booking need a throwaway one (e2e lib makeTestLogin, role office_staff).
- Wood premium words: the Wood set's Better text says "dog-ear pickets". Board on Board and Shadow Box premium options read it too, on a swapped option and on the automatic Better. Waiting on Jonathan.
- e2e/proposal.mjs and signed-docs.mjs post a repeat signing after the first; they did not need the new `seen`. warranty-update.mjs was changed but not rerun.
- builderProposalBetter (dev data) fails the same on main.

## From the Nov 2 job cost labor change

- Two job costings: Budget > Job Costing (hand entries) and the takeoff (job page, Reports > Job Costing) do not read each other. A typed labor cost never reaches the Reports tab.
- Job Costing's price is the signed quote, without approved change orders (the job page uses the contract value). The form warns when a job has some.
- Tear out is in the estimate but not in actual cost unless typed in Other Costs. The form says so.
- Crew hours on a takeoff are not used to fill in hours or labor here.
- A bill filed as Other or Equipment on a job is not counted as material; the form says so.
- P&L bill dates: `new Date(b.billDate)` reads a date alone as midnight UTC, the evening before here, so a bill dated the 1st lands in the month before. Job cost entries are fixed; bills are left, since changing them moves existing month totals.
- Vendor record, a refused save from an installer: the 403 (and a stale 409) sends back the vendor list, bill numbers, categories and line descriptions. The dollar fields are already taken out by the cost scrubber. It should send none of it, as the GET does.


## A server check on saved prices (taken out of proposal options, Nov 2)

- **The hole, on main too:** a Salesman or the office sees costs, so the phone prices the quote and the server takes the numbers. A crafted save of $1 was accepted on a swapped option and on the main price. The customer signs only a stored price, so the $1 would have to be saved first, by a signed in staff member. The owner and managers may set prices.
- **Why it came out:** the check built for this refused honest work in review (coordinator's decision, to get proposal options live). Saves behave as on main.
- **What it needs when it returns as its own piece:**
  - "Move as is" and "New fence instead" are options at their own price on the same style; the check took them for the main option.
  - A tier's adjust % can drift from Settings on a quote that has the older set.
  - A refusal the phone shows, in place of "Quote stored" and a retry loop.
  - Compare against the quote's yard, not the phone's request.

## From the last recheck of proposal options (Nov 2)

- A second quote signed for the same customer at a similar price re-points the existing job and keeps that job's Salesman and commission flag (lib/proposalAccepted.ts, the same job rule). Logged, not fixed.

## Parked Nov 2 2026

- Request gateway: parked by Jonathan ("PARK GATEWAY"). The work stays on branches feat/request-gateway and feat/request-gateway-finish, never deployed. It failed security review twice with the worker on (case-insensitive path bypass, trustd fetch, Postgres IPC, .git/logs symlink, survivors); with the worker off it passes. Live has no requests table. Do not pick it up without his say so. Any future version: owner login only, a password or code on every deploy, Tailscale only.
- From the Nov 2 nightly: the sales-orders AUD Web Chainlink check relies on an audit job missing from dev since the Oct 30 refresh; give it its own test job (a chain link order with an approved +20 ft change order). The automations browser suite needs the automation worker on, which the nightly server turns off (DISABLE_CRON=1): run it on a server with the worker on, outbound closed. Old mixed-options and mixed-work-saves runs (mw07..., mw08...) leave quotes and jobs on dev by design.


## From the Nov 3 morning run

- A change order on a job sold at the minimum price counts from today's price without the minimum, not from the signed price (6 ft at $350, +10 ft: $312, contract $662, while 16 ft fresh is $572). It's the same on main and on live. It's on Jonathan's approval list as item 32 and is not changed until he answers.
- save-conflicts, step "the next quote is saved and its card moved on": with the new Salesman picker this step failed 4 of 5 runs. Right after the office books her second visit, her board read reuses a scope taken just before the booking (apps/portal/src/server/lib/salesScope.ts, MEMORY_MS = 4 s). The board then reads as unchanged until its version moves, so completing the visit has no card to move and the card stays in Appointment. Nothing is lost. salesScope.ts didn't change tonight.
- mybudgetquote-import, "First Contact: the 4 imported cards keep the file's order": this fails on main too, against the current dev data. Look at it with the next dev refresh.
- The "price changed since this was sent" box: a card swapped to another fence is listed under its old fence's name ("…Dig set: $4,669.90 then, $6,607.00 now", when the card is now Aluminum), and the now prices show cents although the saved prices are whole dollars. Reviewer, Nov 3. Wording only; nothing is saved wrong.
- Jeremy Caldwell's draft 72f82d9d on dev: several pull sheet parts at $0.00 (posts, rails, pickets, U channel). Seen in passing by a reviewer; not looked into.
- Discount minimum, from its review: the server's check skips a $0 or non-numeric option price (apps/web/src/discountMinimum.ts pricesUnderMinimum, `c > 0`). Only a hand-crafted save by office, admin or manager reaches it; the screen cannot. Counting $0 risks blocking quotes with an unpriced option, so it needs its own look. Also: the audit log's type filter has no "SavedQuote" (AuditLogPage.tsx:31), and an override row shows the quote id, not the customer.
- WebKit page crash, seen by three reviewers on Nov 2: the second reload of /quotes in the same page crashes Playwright WebKit, on main as well (dbcde4c). Going to the address again never crashes. May belong with iPhone #17.


## From the Nov 3 nightly

- Payment photo in a test copy under `.claude/worktrees/`: GET /api/payments/:id/photo answers 404 there, because Express `sendFile` refuses a path through a dot folder (`dotfiles: 'ignore'`). Live (`~/ezbiz/apps/portal/uploads`) and the main folder are not affected; contractBilling.db.test.ts passes there. `sendFile(file, { dotfiles: 'allow' })` in routes/payments.ts would make the test copies match, if wanted.
- Aluminum Emily 5 ft walk gate: Inventory has a 4' x 5' Emily gate (al-g-45, now used for the leaves of a 10 ft double gate), but a 5 ft walk gate is still priced and pulled as a 4 ft gate with the staff note. Question for Jonathan before changing it: should a 5 ft walk gate on aluminum use the 4' x 5' gate?
- Change orders: a resent create (same id, the phone resending) writes another "create" entry in the audit log each time (3 sends, 3 entries), though only one change order exists. Older than item 32; harmless. Reviewer, Nov 4.


## From the Nov 4 nightly

- The dev copy on port 4001 was serving a web build from Nov 2, 22:03, older than the Salesman picker, so the iPhone check failed at the style step. Rebuilt from main; 133 of 133 passed after that. Rebuild apps/web (and the portal client) in the main folder whenever main moves, before an iPhone or browser check against 4001.
- Eight browser suites (address-salesman, material-kits, possible-match, quote-steps, tall-vinyl-prices, warranty, widget-fit, plus the Salesman cookie ones) refuse any port but 4001 or 4090 to 4099, so the nightly's own copy on 4021 skips them. Move the nightly copy to a 409x port, or let those suites take 4021.
- Live overhead moves as test suites sign jobs (installed revenue, last 12 months), so a copy running beside the suites can price a Draft a few dollars off a minute later (widget-price-match on 4021: $21,301 vs $21,226). It passed on 4001. Nothing customer facing; the tests should pin the overhead or read it once.
- save-conflicts "the next quote is saved and its card moved on" and mybudgetquote-import "First Contact … file's order" failed again, as on Nov 3 (see above). sales-orders AUD Web Chainlink still needs its own test job (Nov 2 note).
- Second Nov 4 nightly, on the main folder's 4001 server (up since 16:16): 110 of 119 suites passed. roles-round1, appointments and job-truth failed in the full run and pass alone (69/69, 19/19, 50/50). change-order-flow failed because the API's per person limit (600 a minute, every suite signs in as the same dev owner) answered 429 to the test and to the page's own calls; the data was right (2 change orders, the job there), and with RATE_LIMIT_API_PER_MIN=6000 on a 4092 copy it passed 68/68. Its API helper now retries a 429. Give the nightly's server a higher RATE_LIMIT_API_PER_MIN, since the dev owner is shared by every suite. The customer page itself makes 29 calls on opening and none after.
- card-phone drag (fixed Nov 5, test only): the app was fine. Four "Mixed e2e" test cards left at the top of Appointment on the dev copy pushed the first card with a phone below the screen, and the test pressed off screen. It now scrolls the card into view first; 38 of 38. Still open: mixed-work-saves leaves its "Mixed e2e work" cards on the dev pipeline for the caller to remove, and nothing removes them.
- automations.db.test.ts "moved into a stage …": read "skipped" for "queued" in the full server run and passes alone (15/15 twice); another test file on the shared dev database likely touched the card.
- 6 ft vinyl privacy with a 12 ft double gate: the "12 ft double gate: this style has no parts list" note shows 3 times on the Price step, once per Good/Better/Best option (reviewer, Nov 5). Wording batch.

## Nightly Nov 5 2026 triage

- add-color (test, fixed): the app was right. Fence Styles now has 7 materials (two tone and farm were added), and "+ Add style" under a material opens the new style form (5fcb611), where a style is archived, not removed. The test now counts the catalog's materials, checks + Add style opens the style form for vinyl and saves nothing on Close, and adds and removes a vinyl height (E2E 7 ft) for the choice dialog. Nothing left behind; 20 of 20.
- add-color left dev Settings changed (fixed, money setting): any Fence Styles save wrote the frame fence's Target Profit (10 dig set, 14 no dig) onto all 72 two tone fences as their own saved number, until the next Vinyl Colors save took it off again. Prices did not change, because each read copies the frame fence's number again. Now it is never saved (fenceCatalog.ts stripDerived). Because of this, vinyl-color-form's "fence styles exactly as before" failed when it ran after add-color.
- vinyl-color-form Chai Gray (test, fixed; dev data matches live): Jonathan saved Chai Gray again on live on Nov 5 (now priced by the piece, with its stiffeners on the form, and 6x6 added). So "saving charges it" no longer shows, which is right. The test now expects that note only for a section color that has never been saved with stiffeners.
- costs-hidden (test, fixed): the first SENT quote on the dev copy has 4 proposal options from before the 3 option limit (Nov 2). The test's copy of it was refused with TOO_MANY_OPTIONS (409), and then it read the missing quote's id. The copy now leaves the proposal out; 21 of 21.
- mybudgetquote-import First Contact (test, fixed; no ordering bug): the 4 imported cards are in the file's order (ranks 5120 to 9216). They were cards 59 to 62 of 62, past the first 50 the column shows, because test leads from other suites are on top. The test now presses "Show more" first.
- mybudgetquote-import: "a flagged customer shows its flags" failed once on webkit desktop while add-color ran at the same time (empty after its 15 s wait), then passed 34 of 34 alone. Probably slowness under load; watch the nightly.
- price-freshness (test, fixed; no money gap): the 72 priced parts left unconfirmed were all archived (Green chain link, Dark Gray (section), and the archived test aluminum styles below). Inventory hides archived parts unless you ask to see them, and they are never quoted, so "Confirm these prices" leaves them out. The test now leaves them out too; 11 of 11.
- Dev data drift: dev pipeline First Contact holds about 45 test leads from Nov 5 and 6 ("Picks e2e", "MakeMain e2e", "Slider e2e", "Mixed e2e", "Discount e2e") that their suites never removed. Each suite should remove its own leads.
- Dev data drift: dev has 4 archived aluminum test styles from the Nov 5 style form review (picket-top-1b8n, picket-top-4his, review-picket, review-arch-2ieu), with their fences and 25 archived parts. Live has none of them; the next refresh-dev-db clears them. Live has "3 rail 54 double picket", which dev lacks.
