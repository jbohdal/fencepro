# Getter Done Fence (EZ Biz): feature list

Last updated: Oct 17, 2026 (kept by Claude Code in the repo as docs/FEATURES.md; updated with every change). One place for every feature, rule and decision, so nothing gets lost.

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
* Sign in screen: replace "Failed to fetch" with "Can't reach EZ Biz. Check that Tailscale is on and connected on this device, then try again." **SENT** (done on dev, waiting for deploy)
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
* Rename "magic number" to **Target Margin**, shown as a percent (0.56 = 44%). Price = cost ÷ (1 − Target Margin). Typed as 44 or 44%. Price method reads "Priced from cost (Target Margin)". **SENT** (done on dev, tested: every saved quote prices the same; waiting for deploy)
* No decimals anywhere: everything as percents. Each style has a Target Profit %; Overhead % is one company number; Target Margin = Overhead + Profit. Start at 30% overhead: no dig 14% profit, dig set 10%, others 12%. **SENT** (done on dev, tested: every saved quote prices the same; waiting for deploy)
* Live overhead from the budget once it's filled in (yearly overhead ÷ yearly revenue), last 12 months or this year's projection, shows how it was worked out, warns on a move of more than 3 points in a month. **SENT** (done on dev; switch it on in Settings > Pricing when the budget is complete)
* "Where every dollar goes": 20 pickets, each 5% of the price, colored Materials (brand purple) / Labor / Overhead / Profit, Commission its own slice. On the quote builder and quote view only, never the proposal or crew packet. **SENT** (done on dev, tested: every saved quote prices the same; waiting for deploy)
* Soft warning when a quote uses a material whose price is older than 6 months; Confirm price buttons in Inventory. **READY**
* Gate leaves: every gate leaf (4, 5 or 6 ft) uses the parts of one 6 ft wide section: 11 pickets, two 6 ft rails, U trim, no insert, plus gate hardware. A double gate is two leaves. **READY** (part of material kits)
* Sub rates still needed: walk gate, double gate, tear out per section, tear out per gate, chain link per 10 ft section, aluminum per section. Quotes warn until they're set. **NEEDS JONATHAN**
* Industrial Abigail: 6 or 8 ft sections? (spreadsheet says 6, app says 8). **NEEDS JONATHAN**

## 3. Material kits (bundles)

* Replace the empty Bundles page with material kits per style: 1 section (with its line post), corner post, end post, blank post, each walk gate size, each double gate size, and chain link by the foot items. **READY**
* Kits worked out from the current calculator (the source of truth), then proven: 6+ real jobs per style must give the identical pull sheet. Only then does the calculator read from kits. **READY**
* Edit, duplicate, rename, archive kits. Editing shows which unsent quotes would change. Costs always live from Inventory. **READY**

## 4. Quoting in the field

* Layout first quoting: pick a yard shape (Backyard, Full perimeter, Front yard, Straight line, Custom), type one number per side, feet and inches. **LIVE**
* Each side end finishes as Corner, Meets the house, Ties into existing fence, or Stops here. Sides can be turned off. Skips for existing or no fence. Posts counted automatically. **LIVE**
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
* Hide the corner drag handles everywhere except while editing ("Adjust the drawing" button; on the aerial photo they stay). **SENT** (done on dev, waiting for deploy)

## 6. Photos and video

* In app camera (several photos, video), or pick many from the gallery. Saved on the phone first, uploads when there's signal, big videos resume. **LIVE**
* Markup: arrows, lines, circles, freehand, text, measurement labels. Original always kept. **LIVE**
* Visibility per item: Internal (default), Crew, Customer. Only Customer shows in the portal. **LIVE**
* Pin to the site plan with the facing direction (one tap after each photo; GPS only suggests, never places alone). Auto caption from what the app knows ("Left side, about 40 ft from the house, looking toward the back left corner"). **LIVE**

## 7. Proposals

* Branded proposal page on the phone: site plan, option cards, what's included, warranty, deposit, finger signature, Accept. Accepting makes the quote that option and marks it Sold. **LIVE**
* Links expire after 30 days, Turn off link button, read only after Accept, notification and Signed Contract card on accept. **LIVE**
* Accepting online also creates the job in Operations; a second acceptance for the same job (same customer, 60 days, price within 10%) updates that job instead of making another. Sending the link (text, email, copy) marks the quote Sent. **SENT** (done on dev, waiting for deploy)
* No online payments for now (check, Zelle, cash note). "Pay Now" hidden. Stripe with bank transfer (0.8%, max $5) is the cheap option later. **LATER**

## 8. Install packet for the crew

* One link per sold job, no login, no prices: site plan with spacing and photo pins, pull sheet quantities, gate details, photos and walkthrough video, crew notes, 811 ticket, map link. Print / PDF. Crew uploads progress and completed photos. **LIVE**

## 9. Pipeline, customers, navigation

* Pipeline card window: New quote, Call, Text, Navigate, Book appointment, quotes, next appointment, notes, stage picker. **LIVE**
* Back button works like a normal app; every screen has its own address; "Leave without saving?" on unsaved quotes. **LIVE** (test on your phones)
* Cards without a customer (Dave Diamond): fixed on live Oct 16 (the only one); cause fixed so a customer and card save together or not at all. **SENT** (cause fix waiting for deploy)
* "Create customer from this lead" button. **READY**
* Appointments with free maps, team list, linked to jobs. **LIVE**
* Phone Schedule tab opens the install schedule with that day's appointments. **READY** (checked Oct 17: the tab opens Appointments, not the install schedule)

## 10. Reliability (top priority)

* Nothing entered in the field can be lost or fail silently: save on the phone first, queue and retry until the server confirms, Saved / Saving / Waiting for signal / Couldn't save status everywhere; plain error messages; failed saves logged on the server; no sign out on weak signal or restarts; data compressed (7.9 MB to about 1 MB at start). **SENT** (done and tested on dev; deploy waiting for the push)
* Test on real mobile browsers for free: Android Emulator (Chrome and the installed app) done; Xcode iPhone Simulator waiting for Xcode. **NEEDS JONATHAN** (install Xcode)
* Every flow tested with no signal, slow signal, and signal dropping mid save (desktop, Android Chrome, installed Android app, WebKit): all pass. **SENT** (iPhone Simulator still to run)
* Independent reviewer acting as a salesman on full jobs, repeated until nothing serious: second pass found nothing serious. **SENT**
* Data integrity check on live (orphan cards, duplicates, unuploaded photos): done Oct 16. **LIVE**
* Duplicate customers merged on live Oct 17 (Sherry Smith, Ashley Rozicki, Dave Wyckoff, Rafael Rodriguez): quotes, jobs, appointments, notes moved to the older record; the newer records kept, hidden, until approved for deletion. **LIVE**
* Marilyn Clark / Marilyn Clarke: same phone, email and address; merge only on your say. **NEEDS JONATHAN**
* Confirm no test records ("E2E") exist on live: none found Oct 17. **LIVE**
* Crew sees the photo they just uploaded; note authors by name; pop up messages at the bottom, never over the save status; one "Photos and video" heading on a job. **SENT** (done on dev, waiting for deploy)

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
