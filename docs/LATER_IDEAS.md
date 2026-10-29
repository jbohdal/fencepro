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

- iPhone (WebKit) page crash after saving a quote on the Quotes page, then opening /quotes?quote=… (site-plan-rotate suite). First bad commit 2c91b8f (on main since Oct 27). Check on a real iPhone with #17.
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
