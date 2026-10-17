# Getter Done Fence (EZ Biz): feature list

Last updated: Oct 17, 2026 (evening) (kept by Claude Code in the repo as docs/FEATURES.md; updated with every change). One place for every feature, rule and decision, so nothing gets lost.

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
* gdfencepro.com shows GoDaddy's parked domain page today (checked Oct 17), not a website. The tool can only show on the real site once it is published at gdfencepro.com; if the site is on a different address, that address must be added. **NEEDS JONATHAN** (which address is the website on?)
* Instant quote watch: every minute the Mac checks /p/quote through the public door as a customer would; if it does not answer for over 10 minutes, a notification in the app (and a text once texting is set up and an alert number is set), and another when it is back. It cannot warn while the Mac or the internet itself is down. **LIVE** (Oct 17; watching since 1:41 PM)
* Outside watch for when the Mac or internet is down: a free UptimeRobot account (free plan, checks every 5 minutes, email and phone app alerts) watching https://jonathans-mac-mini.tail40fb4a.ts.net:8443/p/quote/api/config. **NEEDS JONATHAN** (sign up; I can walk you through it)
* Test quote from the Android phone ("E2E Widget Test (delete me)") deleted from live after a backup (customer, quote, card, lead, note, notification). **LIVE** (Oct 17)
* Every /api route checked without a sign in. /api/quotes now needs a staff sign in (it returns costs and margins); /api/leads refuses when the Botpress secret is not set; /api/quoting/estimate returns the price only and allows 30 a minute per address. **LIVE** (Oct 17)
* Remove the old Good / Better / Best Bundles page (tiers live on the quote): page, Options panel in the quote builder, the /present customer page, the options report and the options box on the quote view. Nothing else used them; 0 bundles and 0 options on live. **LIVE** (Oct 17)
* Tan no dig donuts match white: 2 per post, no extra 2 off per double gate (the blank post is set in concrete and was already left out). Confirmed in the original EZ-Quote Sales spreadsheet: one donut formula for white and tan (H25×2 − H30×2). **LIVE** (Oct 17)

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

## 9. Pipeline, customers, navigation

* Pipeline card window: New quote, Call, Text, Navigate, Book appointment, quotes, next appointment, notes, stage picker. **LIVE**
* Back button works like a normal app; every screen has its own address; "Leave without saving?" on unsaved quotes. **LIVE** (test on your phones)
* Cards without a customer (Dave Diamond): fixed on live Oct 16 (the only one); cause fixed so a customer and card save together or not at all. **LIVE** (Oct 17)
* "Create customer from this lead" button. **READY**
* Appointments with free maps, team list, linked to jobs. **LIVE**
* Phone Schedule tab opens the install schedule with that day's appointments. **READY** (checked Oct 17: the tab opens Appointments, not the install schedule)

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
* Crew sees the photo they just uploaded; note authors by name; pop up messages at the bottom, never over the save status; one "Photos and video" heading on a job. **LIVE** (Oct 17)

## 11. Storage and backups

* Uploads folder included in the nightly backup. **LIVE**
* Off site database backup to Google Drive (free 15 GB) with rclone. **READY**
* Shrink media after a job is Complete for 90 days (keep the small video copy, photos to 2400 px). Dashboard warning under 50 GB free. **READY**
* External drive for media copies (1 to 2 TB). **LATER** (when affordable)

## 12. Calendar, reports, loose ends

* Google Calendar one way sync, its own calendar named Getter Done Fence. **NEEDS JONATHAN** (code is live; connect it on live, then rotate the client secret)
* Revenue check: dashboard vs schedule sheet (~$571k this year), label Reports' "Revenue (Sold)". **NEEDS JONATHAN** (confirm the number)
* Reports cleanup (emoji, mismatched number colors). **READY** (checked Oct 17: not done)
* Open jobs to close out: Diane Pahl, Madsen, Tieman; 10 off schedule jobs tagged; contact info for schedule created customers. **NEEDS JONATHAN**
