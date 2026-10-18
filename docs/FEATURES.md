# Getter Done Fence (EZ Biz): feature list

Last updated: Oct 18, 2026 (early morning) (kept by Claude Code in the repo as docs/FEATURES.md; updated with every change). One place for every feature, rule and decision, so nothing gets lost.

Status key:
* **LIVE**: built and running on the Mac mini
* **SENT**: prompt given to Claude Code, check its report
* **READY**: prompt written, not sent yet
* **NEEDS JONATHAN**: waiting on a number or a decision
* **LATER**: agreed idea, not scheduled

---

## 1. Setup and running costs

* $0 to run: Mac mini at home, pm2 process `ezbiz` on port 4000, Postgres, nightly backups in ~/ezbiz-backups. **LIVE**
* Private access through Tailscale (gdfencepro.com tailnet). **LIVE**
* Public door (Tailscale Funnel, port 8443) for proposals and crew packets (`/p`), the website quote widget and the phone agent only. The rest of the app stays private. **LIVE** (turned on Oct 16)
* Dev copy (ez-biz-final, port 4001, database ezbiz_dev). Every change goes to dev first, backup before live, deploy with update.sh. **LIVE**
* Company name everywhere: **Getter Done Fence**. EZ Biz only as the small product line. **LIVE**
* Sign in screen: replace "Failed to fetch" with "Can't reach EZ Biz. Check that Tailscale is on and connected on this device, then try again." **LIVE** (Oct 17)
* Nicer public links (quote.gdfencepro.com through a free Cloudflare tunnel). **LATER**

## 2. Pricing rules (decided)

* Material cost always comes live from Inventory. **LIVE**
* 6'x8' styles are 6 ft tall, 8 ft wide, counted in 8 ft sections. **LIVE**
* Sections round up per run: 81 ft at 8 ft = 11 sections, charged as 11, crew spaces them evenly. **LIVE**
* An 8 ft section takes the same labor as a 6 ft section (same hole, post, cutting, U channel; only 4 more pickets). **LIVE**
* 6 ft or 8 ft picker compares full cost (panels, posts, setting materials, labor) and picks the cheaper. 8 ft wins on long runs. **LIVE**
* Default labor: subcontractor, paid per section. Vinyl $24 per section, same for 6 ft and 8 ft wide, same for no dig and dig set. Hourly crew option stays on every quote. **LIVE**
* Man hour rate $25. Sections per man hour = sections ONE man installs in one hour. Vinyl no dig 1.2; dig set 0.8; 8 ft tall vinyl 0.8. **LIVE**
* Crew time shown on quotes (crew size 3, 10 hour day, both editable). **LIVE**
* Margins: no dig vinyl 0.56, dig set vinyl 0.60, chain link and aluminum 0.58 (no dig is the better fence, so it earns more). **LIVE** (set Oct 16; now shown as Target Margin 44% / 40% / 42%, same prices)
* Rename "magic number" to **Target Margin**, shown as a percent (0.56 = 44%). Price = cost ÷ (1 − Target Margin). Typed as 44 or 44%. Price method reads "Priced from cost (Target Margin)". **LIVE** (Oct 17; every saved quote prices the same)
* No decimals anywhere: everything as percents. Each style has a Target Profit %; Overhead % is one company number; Target Margin = Overhead + Profit. Start at 30% overhead: no dig 14% profit, dig set 10%, others 12%. **LIVE** (Oct 17; every saved quote prices the same)
* Live overhead from the budget once it's filled in (yearly overhead ÷ yearly revenue), last 12 months or this year's projection, shows how it was worked out, warns on a move of more than 3 points in a month. **LIVE** (Oct 17; switch it on in Settings > Pricing when the budget is complete)
* "Where every dollar goes": 20 pickets, each 5% of the price, colored Materials (brand purple) / Labor / Overhead / Profit, Commission its own slice. On the quote builder and quote view only, never the proposal or crew packet. **LIVE** (Oct 17; every saved quote prices the same)
* Every Inventory item shows "Price last updated" (set when the cost changes; imported prices say "Imported, not yet confirmed"). A quote shows a soft warning (never a block) listing parts older than 6 months (Settings > Pricing) with one tap "Open in Inventory". Inventory sorts and filters by price age, has "Confirm price" per item and "Confirm these prices" for many at once. **LIVE** (Oct 17)
* Gate leaves: every gate leaf (4, 5 or 6 ft) uses the parts of one 6 ft wide section: 11 pickets, two 6 ft rails, U trim, no insert, plus gate hardware. A double gate is two leaves. **LIVE** (Oct 17; in the kits; 6'x8' vinyl and auto mix all 8 ft jobs with gates now price this way; 8 ft tall styles keep their complete 8 x 4 gates)
* Sub rates still needed: walk gate, double gate, tear out per section, tear out per gate, chain link per 10 ft section, aluminum per section. Quotes warn until they're set. **NEEDS JONATHAN**
* Industrial Abigail: 6 or 8 ft sections? (spreadsheet says 6, app says 8). **NEEDS JONATHAN**

## 3. Material kits (bundles)

* Replace the empty Bundles page with material kits per style: 1 section (with its line post), corner post, end post, blank post, each walk gate size, each double gate size, and chain link by the foot items (rounded up per job). **LIVE** (Oct 17; Inventory > Material Kits replaces the Bundles tab; line post is its own kit because the first section of a run has none; one walk and one double gate size, since quotes don't carry gate widths yet)
* Kits worked out from the current calculator (the source of truth), then proven: 6+ real jobs per style must give the identical pull sheet. Only then does the calculator read from kits. **LIVE** (Oct 17; 32 styles × 15 jobs (7 real yards + 8 generated), every part identical except the gate leaf correction; the old calculator stays as the test check)
* Edit, duplicate, rename, archive kits. Editing shows which open (Draft and Sent) quotes would change, with material cost now and after. Costs always live from Inventory. **LIVE** (Oct 17)
* Website quote widget, chat assistant, phone agent and /api/quotes estimates come from the quote builder's own math (kits, Inventory costs, Settings), always labeled Estimate; the old separate server calculator is gone. 3 test jobs: widget, /api/quotes and builder match to the cent (widget rounds to dollars). New /api/quoting/estimate and /api/quoting/styles for the widget; each widget quote also records the builder's estimate. **LIVE** (Oct 17; the widget page itself: see the next line)
* Customer portal sign up works only from the invite link Jonathan sends (used once, must match the email). Website chat transcripts open only in the browser that started the chat (secret chat token in a cookie the page cannot read) or for staff signed in; the session number alone no longer opens or adds to a chat. **LIVE** (Oct 17)
* Website widget (EZ-Budget, the old Next.js and Firebase app): replaced, see the instant quote below. Its code change from Oct 17 is kept in that folder but not used. **LATER** (nothing to do unless you want the old app back)
* Website instant quote, hosted by EZ Biz on the Mac mini behind the public door (/p/quote), $0: no Firebase, no customer sign in, no Google Maps. The customer types the address (free US Census lookup, USGS aerial photo of the property), picks the yard shape and types one number per side (the quote builder's entry; drawing on a map needs paid maps), picks the fence with the style photos from Settings > Proposals, sees the estimate (the builder's math) and sends it. The customer, the quote and the pipeline card land in EZ Biz together. Shows inside pages on gdfencepro.com and www.gdfencepro.com only; no outer header, fits phones, scrolls inside its box. **LIVE** (Oct 17; tested from an Android phone with no Tailscale: estimate $16,047, the customer, quote and pipeline card landed together)
* Website page gdfencepro.com/instant-quote and "Get an instant quote" buttons: designer email written with the exact embed code, a "Call (352) 789-4314" line under the tool, and a backup (buttons link straight to the tool's own page if the box will not load) (~/Downloads/email-for-web-designer.txt). **NEEDS JONATHAN** (send it to the designer)
* Works inside GoDaddy's HTML section: GoDaddy puts pasted code in a frame with no address of its own that counts as gdfencepro.com, so only gdfencepro.com and www.gdfencepro.com are allowed and nothing wider. Tested with GoDaddy's exact wrapper against the live tool through the public door: shows on both addresses; refused in GoDaddy's editor preview (GoDaddy does not show embeds there anyway) and on any other site. **LIVE** (Oct 17)
* Website address: the real website is gdfencepro.com (www forwards to it), a custom site by DotCom Global Media (not GoDaddy's builder). Its "Instant Fence Estimator" link still goes to the old paid tool (getterdonefence.mybudgetquote.com). Checked Oct 17 against the live site: the instant quote, with the exact code from the designer email, shows and works inside the real gdfencepro.com page on a phone and a computer; the embed rule needs no change. **LIVE** (Oct 17)
* GoDaddy's two name servers for gdfencepro.com disagree (Oct 17): ns15 gives the real site (91.246.36.201), ns16 still gives GoDaddy's parking page (76.223.67.189 and 13.248.213.45). Visitors whose phone or internet provider asks ns16 can land on the parking page, which is what the Mac saw. Fix in GoDaddy DNS: keep only the real site's A record for @ (and turn off parking or forwarding if it is on). **NEEDS JONATHAN** (or the designer)
* Instant quote watch: every minute the Mac checks /p/quote through the public door as a customer would; if it does not answer for over 10 minutes, a notification in the app (and a text once texting is set up and an alert number is set), and another when it is back. It cannot warn while the Mac or the internet itself is down. **LIVE** (Oct 17; watching since 1:41 PM)
* Outside watch for when the Mac or internet is down: a free UptimeRobot account (free plan, checks every 5 minutes, email and phone app alerts) watching https://jonathans-mac-mini.tail40fb4a.ts.net:8443/p/quote/api/config. **NEEDS JONATHAN** (sign up; I can walk you through it)
* Test quote from the Android phone ("E2E Widget Test (delete me)") deleted from live after a backup (customer, quote, card, lead, note, notification). **LIVE** (Oct 17)
* Every /api route checked without a sign in. /api/quotes now needs a staff sign in (it returns costs and margins); /api/leads refuses when the Botpress secret is not set; /api/quoting/estimate returns the price only and allows 30 a minute per address. **LIVE** (Oct 17)
* Remove the old Good / Better / Best Bundles page (tiers live on the quote): page, Options panel in the quote builder, the /present customer page, the options report and the options box on the quote view. Nothing else used them; 0 bundles and 0 options on live. **LIVE** (Oct 17)
* Tan no dig donuts match white: 2 per post, no extra 2 off per double gate (the blank post is set in concrete and was already left out). Confirmed in the original EZ-Quote Sales spreadsheet: one donut formula for white and tan (H25×2 − H30×2). **LIVE** (Oct 17)
* Price follows the parts (checked Oct 18 on a copy of live): every style's Materials $ moves with footage, gates and kit quantities (doubling a kit quantity changes it by exactly quantity × Inventory cost), price = (materials + labor) ÷ (1 − Target Margin), and the tiers, proposal, website widget and phone agent use the same math. Cause of the "fixed price": the 1,941 quotes imported from JobNimbus carry the old system's price as a price set by hand, so once measured their price did not move. Now an imported quote that is not sold is priced from its parts, with the old price shown and "Use the old price" one tap away; a sold one keeps its contract price; any price set by hand says so in the bottom bar with "Price it from cost instead". No quote made in EZ Biz was priced wrong (both reprice to the cent). **LIVE** (Oct 18)
* Inventory > Fill in: one screen with every $0 price and every kit part missing from Inventory, the gate parts for commercial chain link (3 styles) and Industrial Abigail, and a Durafence parts list. Type parts (from Inventory or new, with a price) and prices there; they save into Inventory and the material kits, and quotes use them at once (tested: a commercial gate went from $22 to $172 of material; a Durafence section kit priced 13 sections x $95). On the Finish setup card until everything is filled in. **LIVE** (Oct 18; Jonathan's numbers still to type)

## 4. Quoting in the field

* Layout first quoting: pick a yard shape (Backyard, Full perimeter, Front yard, Straight line, Custom), type one number per side, feet and inches. **LIVE**
* Quote screen in 4 steps (Customer, Yard, Style, Price), one on screen at a time, nothing typed lost between them. Yard: the plan on top (tap a side to open it), one compact row per side (check mark, name, gate, length), one side open with only the length, mic, gate choice and its ends in one line; the rest behind More options. Pinned bottom bar: sides done, feet, corners and ends, the running price, Photos (with a count) and Next side / Next: Style. Price step: price, Good Better Best, where every dollar goes, warnings, then the details and Save. **LIVE** (Oct 17; phone screenshots in ~/Downloads/ezbiz-ux-audit/after/quote-steps)
* Each side end finishes as Corner, Meets the house, Ties into existing fence, or Stops here. Sides can be turned off. Skips for existing or no fence. Posts counted automatically. **LIVE**
* Fix: a new yard read "Stops here" at every end with 0 posts until every side was measured. Ends now show Corner where sides meet (returns start at the house) and corner posts count as soon as one side has a length; a side left on without a length is flagged. Checked: no saved quote on live has a yard layout, and none of the 192 dev layout quotes saved wrong ends. **LIVE** (Oct 17)
* Gate on any side: type the full side once, the app splits it and adds gate posts. **LIVE**
* Post to post spacing per run in feet and inches. **LIVE**
* Warnings: tape measure check on exact section multiples (or up to 6 in over), gate wider than its side, low margin, missing sub rate, missing Inventory part, price per foot outside the normal range. **LIVE**
* Good / Better / Best on every vinyl quote: Good = white dig set, Better = white no dig (Most popular), Best = tan no dig. Each uses the cheaper width. Editable in Settings. **LIVE**
* Compare options (6 vs 8 ft, white vs tan, no dig vs dig set). **LIVE**
* Voice entry: optional switch at the top of the quote, typing stays the default. Guided walk, read back, our own phrase parser, "fifteen or fifty?" checks, offline clips transcribed on the Mac (whisper.cpp). **LIVE** (needs your iPhone and Android check)

## 4b. Quote window and Good / Better / Best (Oct 18)

* Quote window on computer and tablet: about 92% of the screen tall, content scrolls inside it; the bottom bar (price, sides, counts, Photos) is the window's own footer inside its border, with a big Back on the left and Next / Save on the right. Yard step on wide screens: site plan on the left, sides on the right. Opened from a pipeline card, the card window is hidden behind it (Back returns to the card). The phone is unchanged. **LIVE**
* Settings > Good Better Best (also "Edit tiers" on a quote's tier cards): a tier set per category (Vinyl, Chain link, Aluminum, and any added), up to 3 tiers each; rename, reorder, add, remove, duplicate. Each tier: name, install (no dig / dig set / same as the quote), section width (cheapest / all 6 ft / all 8 ft / same as the quote), color (same as the quote / a specific color), optional specific style, price adjustment %, the "why it's better" text, optional photo, Most popular. Live preview on sample yards. Sets are made once on the server (one per category; a deleted set stays deleted). **LIVE**
* Vinyl lineup, color always the quote's: Good = dig set, cheapest width ("Posts set in concrete. Solid fence at the best price."); Better, Most popular = no dig, cheapest width ("Steel pipe driven deep, no concrete, faster install."); Best = no dig, all 6 ft wide sections ("More posts per foot for the strongest fence we build."). The white to tan switch is gone. **LIVE**
* Chain link (Good galvanized, Better black, same height) and aluminum (Good dig set, Better no dig, same model) starting sets and their wording were written by Claude Code from the existing styles. **NEEDS JONATHAN** (check the wording; Industrial Abigail has no no-dig style, so its Better tier says so)
* The tier sets load with the rest of the company's data when the app starts and are retried on weak signal; if they still have not loaded, the quote says so (found by the field test: on a dropping signal a proposal could have gone out without Good, Better, Best). **LIVE**
* New quotes and proposals use the settings at once; a sent proposal keeps the prices and tiers it was sent with (reopening it shows "Tiers as they were when this proposal was sent" with "Use the current tiers"). **LIVE**

## 5. Site plan

* Drawn automatically while typing: footage, sections, posts, gates, house, street side. Not to scale for permitting. **LIVE**
* House always square and level. Sides go straight back at their own lengths; the back fence angles when sides differ. Returns meet the house at back corner, front corner, or a typed distance. **LIVE**
* Drag corners for odd yards (never changes footage or price). Reset button. **LIVE**
* No north arrow unless lined up on the aerial photo. **LIVE**
* Optional aerial photo behind the plan (free USGS imagery). **LIVE**
* Hide the corner drag handles everywhere except while editing ("Adjust the drawing" button; on the aerial photo they stay). **LIVE** (Oct 17)

## 6. Photos and video

* In app camera (several photos, video), or pick many from the gallery. Saved on the phone first, uploads when there's signal, big videos resume. **LIVE**
* Markup: arrows, lines, circles, freehand, text, measurement labels. Original always kept. **LIVE**
* Visibility per item: Internal (default), Crew, Customer. Only Customer shows in the portal. **LIVE**
* Pin to the site plan with the facing direction (one tap after each photo; GPS only suggests, never places alone). Auto caption from what the app knows ("Left side, about 40 ft from the house, looking toward the back left corner"). **LIVE**

## 7. Proposals

* Branded proposal page on the phone: site plan, option cards, what's included, warranty, deposit, finger signature, Accept. Accepting makes the quote that option and marks it Sold. **LIVE**
* Links expire after 30 days, Turn off link button, read only after Accept, notification and Signed Contract card on accept. **LIVE**
* Accepting online also creates the job in Operations; a second acceptance for the same job (same customer, 60 days, price within 10%) updates that job instead of making another. Sending the link (text, email, copy) marks the quote Sent. **LIVE** (Oct 17)
* No online payments for now (check, Zelle, cash note). "Pay Now" hidden. Stripe with bank transfer (0.8%, max $5) is the cheap option later. **LATER**

## 8. Install packet for the crew

* One link per sold job, no login, no prices: site plan with spacing and photo pins, pull sheet quantities, gate details, photos and walkthrough video, crew notes, 811 ticket, map link. Print / PDF. Crew uploads progress and completed photos. **LIVE**

## 8b. Final walkthrough (Oct 18)

* On every job (Operations job panel), phone first, works with no signal (the same save queue: a repeat is one record, two phones never make two walkthroughs). **LIVE**
* Checklist from templates in Settings > Final Walkthrough (add, remove, reorder; vinyl, chain link, aluminum), starting with: gates swing, latch and self close; posts plumb; sections level and evenly spaced; pickets and caps secure; hardware tight; concrete/donuts finished; cleanup and haul away; utility flags and stakes removed; property pins undisturbed; customer shown gate operation. Each: Pass or Needs fixing, note, photo. **LIVE**
* Required photos before finishing: each side, each gate, one wide shot (Customer visible), with the existing camera and markup. Needs fixing makes a punch list item; it stays open until fixed and re-photographed. **LIVE**
* Signatures: homeowner and our representative (Project coordinator, Lead installer / Foreman, Subcontractor) with name, role, date, time and location. Homeowner not there: a link through the public door (/p/w, like proposals: 30 days, can be turned off, read only after signing), sent by copy, text from Jonathan's phone or email. **LIVE**
* Certificate of Completion PDF (logo, checklist, punch list and fixes, photos, signatures, warranty from Contract Templates): saved on the job and in the customer portal. Events for automations: walkthrough signed, completed, punch list cleared. **LIVE**
* Tested: 17 server tests, 32 browser checks on a phone (with no signal, homeowner link, certificate). The in-app camera itself was not driven by the test (headless browsers have no camera; the photo picker was used). **LIVE**

## 8c. Pipeline automations (Oct 18)

* Automations screen: WHEN (card moved into / out of a stage, in a stage X days, X days before/after install date, appointment or proposal sent, proposal accepted, walkthrough signed, punch list cleared, payment received, photo uploaded; sales pipeline and Operations) + IF (stage, style/category, price range, city or county, salesman, tag, permit required) + THEN (task with due date, in app and phone push notification, Gmail email with {fields}, a prepared text sent from Jonathan's phone with one tap, move the card, add a checklist, request a signature, document packet, wait, webhook). Test button (dry run, does nothing), pause. **LIVE**
* Reliable: every trigger is saved in the database in the same step as the change; each rule runs once per trigger; steps run from the queue, survive restarts, retry at 1, 5, 15 and 60 minutes, never repeat a side effect; missed time triggers catch up once; quick back and forth drags do nothing extra (2 minute settle, once per card and stage per 24 hours); every run is logged on the card; a step that still fails notifies Jonathan with the reason and Run again. **LIVE**
* Stage rules: a card cannot enter a stage until its requirements are met (Pending Start needs the permit Approved; Job Complete needs the walkthrough signed); the app shows what is missing and puts the card back. Created switched off. **LIVE** (switch on when ready)
* Permits: a permit on each job (Not needed / Needed / Applied / Approved / Inspection scheduled / Passed, dates, number), a Permit packet PDF (site plan, contract, owner and property, parcel ID from the county), a task with Marion County's permit portal (Civic Access: selfservice.marionfl.org; inside the City of Ocala the city permits), reminders every 3 days until Approved. No filing on county websites. **LIVE**
* Starter rules, switched off for review: Signed Contract tasks; 2 days before install email; Job Complete starts the walkthrough; Walkthrough signed final invoice + review request 3 days later; No Answer follow ups at 2, 5 and 10 days. **NEEDS JONATHAN** (review and switch on)
* Phone push: free web push; tested on the Android emulator (arrived in the notification shade). iPhone: needs the app on the home screen (iOS 16.4+); not tested here (no Xcode). **NEEDS JONATHAN** (turn on push on each phone in Automations)
* Gmail: "Connect Gmail" (send only) on the same Internal Google project as the calendar; email steps fail clearly until connected. A real send not yet tried. **NEEDS JONATHAN** (connect Gmail on live)
* Tested: 22 server tests (each trigger type, retries, no duplicates, catch up after downtime, stage rules, crash mid run, dry run), 19 browser checks. **LIVE**

## 8d. Duplicates, fixed at the cause (Oct 18)

* Why the starter rules doubled: opening Automations asks for the rules and the stage rules at the same moment; both ran "make the starters if missing" (check, then insert, with nothing in the database to stop a second copy), so each starter was made twice in the same millisecond. Not a deploy, not a second device, not a double tap. Stage rules did not double because the database already allowed only one per stage. **LIVE** (fixed)
* The 5 duplicate rules removed on live after a backup (none had run; the copy Jonathan switched on was kept). **LIVE**
* Everything the app makes by itself has a stable key and the database allows one copy: starter rules and stage rules (one per company and starter), one job per quote, company records (pipeline, settings, inventory, vendors, schedule), job milestone checklists, operations stages, material kits (one in use per style), intake cards, accepted proposal jobs, follow up texts. Seeding runs only on the server, in one step, and doing it twice changes nothing. Each starter rule is made once per company, ever: one Jonathan deletes stays deleted. The browser no longer seeds anything (the old "first time: a card for every customer" is gone). **LIVE**
* Every create audited (customers, cards, quotes, notes, appointments, photos, jobs, walkthroughs, rules, kits, invoices, payments, vendors, bills, change orders, rain days, voice clips, portal messages and files, tickets, documents, website and phone intake): each sends one ID per create, its button is disabled while saving, and the server keeps the first copy, also when two arrive at the same instant. Fixed where missing (same instant double taps on Add lead, Save quote, Book appointment; online proposal accept could make two jobs; rain day; portal messages; and more). **LIVE**
* Tests: every seeded thing set up twice and three times at once, exactly one; every create sent three times (in a row and at once), exactly one; a phone double tap test on the main create buttons. **LIVE**
* Duplicate check: same customer phone, two cards for a customer in one stage, same rule name or starter, seeded things doubled, same quote twice within a minute, two jobs for a quote, same appointment, same note, and test (E2E) records. Runs after every update (a couple of minutes after the restart) and every night at 3 am; anything new is a notification; a "Possible duplicates" card on the dashboard with "This is fine". Also in the live read only crawl report. **LIVE**
* Test records reached live during deploys: a skipped test group's setup code still ran while the tests were collected, so each deploy (which runs the tests) made a test customer and job on live. Database tests are now never loaded outside the dev database. The 2 test customers and 2 test jobs from Oct 18 deleted from live after a backup. **LIVE**
* Found by the first check on live, settled with Jonathan (Oct 18, after a backup): Lippert / Bisram and Rice / Rice share household phones (marked "This is fine"); "jon doe" (a test entry on Christa Feagin's number, nothing attached) deleted; Maria Sarria's two identical imported quote pairs: the later copy of each archived (d6036877, f612feae), the first kept. The check now finds nothing on live. **LIVE**

## 9. Pipeline, customers, navigation

* Pipeline card window: New quote, Call, Text, Navigate, Book appointment, quotes, next appointment, notes, stage picker. **LIVE**
* Back button works like a normal app; every screen has its own address; "Leave without saving?" on unsaved quotes. **LIVE** (test on your phones)
* Cards without a customer (Dave Diamond): fixed on live Oct 16 (the only one); cause fixed so a customer and card save together or not at all. **LIVE** (Oct 17)
* Doubled pipeline cards (Oct 17: David Fousek, Lori Jackson, Tali Batikoff, two cards each): made by a phone still running the app from before Oct 16 (short card ids), which saved the card on its own and could send it twice. The current app sends the customer and card as one action with one id each, and the server keeps the first. Now also: a repeat never adds a second card for that customer (even from an older app), two copies arriving at the same moment are answered "already saved" (customers, cards, notes, quotes, jobs, appointments), and a phone that keeps the app open takes each new version by itself (when it comes back on screen, with nothing waiting and nothing unsaved; otherwise "Update" shows). Tests: the same create 3 times one after another and at once (server), and 3 times through a dropping signal (browser): one customer, one card, one quote. **LIVE** (Oct 18)
* The 3 doubled cards on live merged (Oct 18, after a backup): each pair was identical (only an empty "assigned rep" differed); notes, quotes, photos and appointments hang off the customer, so nothing had to move; the second card of each removed (Jackson eav16jd, Fousek lfssz34, Batikoff 7urdwnv). Pipeline 1,721 to 1,718 cards. **LIVE**
* "Create customer from this lead" button. **READY**
* Appointments with free maps, team list, linked to jobs. **LIVE**
* Dispatch map on the same free maps as Appointments (OpenStreetMap, no key), job pins and crew routes; addresses found with the server's free lookup. Was Google's "This page can't load Google Maps correctly". **LIVE** (Oct 18)
* Smart Schedule, Site Plans and the Map Quote on free maps: OpenStreetMap streets and the USGS National Map aerial (public domain), Aerial / Street switch, address search from the county list; nothing in the app needs a Google Maps account any more. The map quote still draws and measures (a 200 px run at close zoom measured 171 ft, expected 171.1 ft). The free aerial stops at zoom 16, so close in it is soft; the sharper USGS NAIP service was down (504) when tested. Sharper imagery would need a free Esri/ArcGIS account key from Jonathan. Also fixed: Dispatch could freeze when Smart Schedule was opened (it kept re-looking up addresses on every redraw); address suggestions now show above maps. **LIVE** (Oct 18)
* Address suggestions as an address is typed (new customer, new lead from the pipeline, quote, aerial photo address, vendors, the website instant quote): from Marion County's own property list kept on the Mac (204,854 addresses, read again from the county every month), then the US Census lookup for a complete address the county list lacks. One tap fills street, city, state, ZIP and the map spot; typing by hand still works. Tested on 30 real customer addresses (mostly rural): county 28 of 30, with the Census 29 of 30; Photon (OpenStreetMap) 1 of 30. Geoapify, LocationIQ and Radar each need a free key from Jonathan's sign up to test; not needed at these rates. Neighboring counties (Alachua, Lake, Sumter, Putnam, Levy): the Census lookup covers them today; their county lists can be added the same way. **LIVE** (Oct 18)
* The same new address looked up twice at once (Dispatch and Smart Schedule together) no longer fails the second lookup; it uses the spot the first one saved. **LIVE** (Oct 18)
* Booking or closing out an appointment moves the customer's open card (a customer with an old No Answer or Paid card plus a new one: the new one), not just the first one found. **LIVE** (Oct 18)
* Google sign in keys removed from the working folder's settings: they live only in the live settings. **LIVE** (Oct 18)
* Phone Schedule tab opens the install schedule, with a day view on top: that day's installs and appointments, previous/next day, back to today; tapping an appointment opens it. **LIVE** (Oct 17)

## 9b. Logins and roles (Oct 18)

* Roles enforced by the server (not just hidden in the app): a salesman can quote, send proposal links, add leads and customers, move cards, add notes, book appointments, take photos and view the schedule; cannot change settings, prices, kits, tiers, stages, automations, schedule, vendors or billing, cannot manage users, and cannot delete anything ("Your role cannot change prices. Ask Jonathan."). Office staff runs operations (schedule, billing, vendors, stock counts, permits) without settings, prices or users; field crew is like a salesman without quote writes; manager is everything except users and system tools. A refused save is not retried forever: the screen goes back and says why. **LIVE**
* Inviting: Team > + Invite Team Member, pick the role, Send Invite; the link (also shown with Copy link) works once, for 72 hours; Resend fixed. Only the owner and admins invite or change roles; a role change signs that person out (a role change takes up to 15 minutes to reach a token already in use). **LIVE**
* Send feedback (the speech bubble with + in the top bar, every page, every login): takes a picture of the screen, a box for what's wrong, sends with the page, time, device and app version; works with weak signal (sent once). Feedback list for the owner (Admin > Feedback) with New / Seen / Done; a notification for each new one. Claude Code reads it with `cd ~/ezbiz/apps/portal && npx tsx scripts/feedback-report.ts` (read only). Pictures from other sites (some map tiles) come out blank. **LIVE**

## 10. Reliability (top priority)

* Nothing entered in the field can be lost or fail silently: save on the phone first, queue and retry until the server confirms, Saved / Saving / Waiting for signal / Couldn't save status everywhere; plain error messages; failed saves logged on the server; no sign out on weak signal or restarts; data compressed (7.9 MB to about 1 MB at start). **LIVE** (Oct 17)
* Test on real mobile browsers for free: Android Emulator (Chrome and the installed app) done; Xcode iPhone Simulator waiting for Xcode. **NEEDS JONATHAN** (install Xcode)
* Every flow tested with no signal, slow signal, and signal dropping mid save (desktop, Android Chrome, installed Android app, WebKit): all pass. **SENT** (iPhone Simulator still to run)
* Independent reviewer acting as a salesman on full jobs, repeated until nothing serious: second pass found nothing serious. **LIVE** (Oct 17)
* Data integrity check on live (orphan cards, duplicates, unuploaded photos): done Oct 16. **LIVE**
* Duplicate customers merged on live Oct 17 (Sherry Smith, Ashley Rozicki, Dave Wyckoff, Rafael Rodriguez): quotes, jobs, appointments, notes moved to the older record; the newer records kept, hidden, until approved for deletion. **LIVE**
* Those 4 kept 30 days, then deleted on Nov 16 (after that night's backup, only if still archived and nothing new points at them); dashboard reminder on Nov 15 with "Keep them" to cancel. Marilyn Clarke's newer copy added (5 records). **LIVE** (Oct 17; schedule set on live)
* Marilyn Clarke: the two records merged into the older one (Mar 25 2024), spelled Clarke on the record and her quotes; the newer record kept, archived. **LIVE** (Oct 17)
* Confirm no test records ("E2E") exist on live: none found Oct 17. **LIVE**
* Full check Oct 17 (night): every browser test passes on dev; field test 240 of 240 (Android emulator and phone size Chrome; good, slow, no and dropping signal); live read only crawl opened all 1,721 cards, 3,690 customers, 1,942 quotes and 660 jobs with 0 problems (report in ~/Downloads/live-readonly-2026-10-17.txt). Opening a job for the first time saves its default checklist (Locate, Permit...); by design, noted. **LIVE**
* Dispatch map: Google shows "This page can't load Google Maps correctly" on live (the Maps key has no billing project). Switch Dispatch to the free maps the Appointments page uses, or hide the map. **NEEDS JONATHAN** (pick one)
* Crew sees the photo they just uploaded; note authors by name; pop up messages at the bottom, never over the save status; one "Photos and video" heading on a job. **LIVE** (Oct 17)

## 11. Storage and backups

* Uploads folder included in the nightly backup. **LIVE**
* Off site database backup to Google Drive (free 15 GB) with rclone, Jonathan's own Google key: after every backup (nightly 2:30 am, before each deploy, manual), the newest copy goes to "EZ Biz backups" in Drive and only the last 30 are kept; if Drive is not reachable the backup on the Mac still runs and says so. **LIVE** (Oct 18: the nightly job run by the Mac's scheduler copied its backup to Drive; keep rule tested on Drive in a test folder, 8 copies with keep 5 left the newest 5)
* Backup times are recorded in UTC, as the app reads them (they had been 4 hours early, so "last backup" looked older than it was; the Nov 16 deletion was not affected). **LIVE** (Oct 18)
* Shrink media after a job is Complete for 90 days (setting in Settings > Company > Photos and video): videos keep only the small viewing copy, photos go to 2400 px on the long side, marked up copies untouched; twice a day, once per item. Dashboard warning under 50 GB free. **LIVE** (Oct 17)
* Space estimate (Oct 17): 182 GB free. Without shrinking about 63 GB a year (2 years to the warning, 3 to full); with shrinking about 20 GB a year (about 6 years to the warning, 8 to full).
* External drive for media copies (1 to 2 TB). **LATER** (when affordable)

## 12. Calendar, reports, loose ends

* Google Calendar one way sync, its own calendar named Getter Done Fence. The calendar live already made ("GD Fence Pro") is renamed to Getter Done Fence at the next sync, so no reconnect is needed. **LIVE** (Oct 17: renamed in Google 11:47 pm, sync 1 created, 0 failed; Jonathan confirmed it works)
* Rotate the Google client secret (Cloud Console > Credentials > Reset secret, new value in ~/ezbiz/apps/portal/.env, `pm2 restart ezbiz`). **NEEDS JONATHAN**
* Revenue check: dashboard $631,637.54 (94 jobs installed in 2026) vs the GD Schedule sheet $571,633.06. The $60,004.48 gap is exactly 5 jobs marked installed Oct 14 after the sheet export (Tieman, Madsen, Tracy, Pahl, Hofmann: $50,676) and 6 jobs not on the sheet (White, Trademark Metals, Simoneaux, Warwick, Bethin, Martin: $9,328). Reports' card renamed "Sold this period (quotes)". **LIVE** (Oct 17)
* Reports cleanup: no emoji; numbers green good, amber below target, red bad, otherwise dark gray. Gross profit and margin count only sold quotes that have costs (the GD Schedule imports have none) and say how many were left out. **LIVE** (Oct 17)
* Finish setup card on the dashboard (owner only): each item ticks itself off from the data (sub rates, Abigail width, Inventory prices, Pahl/Madsen/Tieman paid, the 10 off schedule jobs, schedule customers with no contact, Google Calendar, phone voice checks, Xcode, UptimeRobot, Google Drive backups); gone when all are done. **LIVE** (Oct 17)
* Open jobs to close out: Diane Pahl, Madsen, Tieman; 10 off schedule jobs tagged; contact info for schedule created customers. **NEEDS JONATHAN**
