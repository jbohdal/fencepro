# What Your Automation System Can Do

FencePro has a built-in automation engine that quietly runs in the background and does work for you. It watches for things happening in the CRM — a new customer gets added, a job moves stages, a payment comes in — and reacts by sending messages, creating tasks, posting notes, moving cards on the pipeline, or pinging an outside service.

You build automations in **Admin → Automations**. Each automation has a **trigger** (the thing that starts it), optional **conditions** (extra filters), and one or more **actions** (what to do). You can turn any automation on or off with a single toggle, and every run is logged so you can see exactly what fired and when.

Automations never slow the app down. They run in the background, and if one of them ever fails the thing you were actually doing (saving a quote, marking a payment) keeps working normally.

## Available Triggers

| Trigger | When it fires | Data available for conditions & merge tags |
|---|---|---|
| **Sales pipeline stage change** | When a deal card moves to a different column on the Sales Pipeline board | `fromStage`, `toStage`, `customerName`, `customerEmail`, `customerPhone`, `jobAddress`, `fenceType`, `quotePrice`, `assignedRep` |
| **Operations stage change** | When a job moves to a different column on the Operations board | Same as above, plus `crewAssigned` |
| **Job created** | When a new job is created (usually from a SOLD quote) | `jobId`, `customerName`, `jobAddress`, `assignedRep`, `fenceType`, `contractValue` |
| **Job assigned** | When a crew is assigned or reassigned on a job | `jobId`, `crewAssigned`, `customerName` |
| **Job scheduled** | When a scheduled install date is set on a job | `jobId`, `scheduledDate`, `customerName`, `crewAssigned` |
| **Job rescheduled** | When a job's scheduled date is changed after already being scheduled | `jobId`, `scheduledDate`, `customerName` |
| **Rain day flagged** | When a job is marked as a rain day on the Schedule page | `jobId`, `customerName`, `customerPhone`, original schedule date |
| **Payment received** | When a payment is recorded against an invoice | `invoiceId`, `customerName`, `amountCents`, `paymentMethod` |
| **Invoice created** | When a new invoice is created for a customer | `invoiceId`, `customerName`, `totalCents` |
| **New customer created** | When a customer is added — manually or via CSV import | `customerId`, `customerName`, `customerEmail`, `customerPhone`, `jobAddress`, `assignedRep` |
| **Quote marked sold** | When a quote status flips to SOLD | `quoteId`, `customerName`, `quotePrice`, `fenceType`, `jobAddress` |

Also available (legacy trigger names — you can still use them and they work the same):
- `job_stage_changed` → same as **Operations stage change**
- `deal_stage_changed` → same as **Sales pipeline stage change**
- `job_rain_day` → same as **Rain day flagged**

## Available Actions

| Action | What it does | Configuration | Requirements |
|---|---|---|---|
| **Send Email** | Sends an email. Subject and body both support merge tags. | Recipient (`customer`, `rep`, `role:admin`, `role:ops_manager`, or `custom:someone@example.com`), subject, body | **SendGrid** or **SMTP** connected in `.env`. Without this, the action is logged as failed with reason `EMAIL_SERVICE_NOT_CONFIGURED` — the run log still records the attempt. |
| **Send SMS** | Sends a text message via Twilio. Body supports merge tags. | Recipient (`customer` or `custom:+13215551234`), message body | **Twilio** connected (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`). Without this, logged as `SMS_SERVICE_NOT_CONFIGURED`. |
| **Send In-App Notification** | Writes a notification visible in the bell icon in the top-right of the CRM. | Recipient (`rep`, `role:admin`, `role:ops_manager`, or a specific user), title, body | None — always works. Users see it in the notification bell. |
| **Create Task** | Creates a task assigned to someone, with an optional due date. Shows up in their task list. | Title, description, assignee (user or `role:<role>`), due date offset (days from now — can be negative for "before"), priority | None |
| **Schedule Reminder** | Like Create Task but simpler — creates a reminder task with a future due date. | Message, assignee, days offset | None |
| **Post Activity Note** | Writes a note to the activity feed on a customer, job, deal, invoice, or quote. Attributed to "automation" rather than a person. | Note text, entity type (auto-detected from the trigger: job, customer, deal, etc.) | None |
| **Move Job to Operations Stage** | Moves the triggered job to a specific stage on the Operations board. Fires the next stage-change trigger so follow-up automations run. | Target stage | None. Built-in cycle prevention caps chained moves at 5 deep. |
| **Move Deal to Pipeline Stage** | Same as above, for sales pipeline deals. | Target stage | None |
| **Fire Outbound Webhook** | Makes an HTTP POST to any URL with a structured JSON payload (event type, entity, timestamp, full event data). | URL, method (default POST), custom headers | Reachable public URL. Retries 3 times with 5-second delays between attempts. Timeouts at 15 seconds. |
| **Require Checklist Gate** | Marks a checklist item as required before the job/deal can move past the current stage. | Checklist item name | None (UI enforcement) |

## Merge Tags

Any action that sends text (email subject/body, SMS body, notification, task title, activity note) supports these placeholders that get filled in automatically:

| Tag | What it becomes |
|---|---|
| `{{customer_name}}` | Customer or job name |
| `{{job_address}}` | Service address |
| `{{scheduled_date}}` | Scheduled install date |
| `{{rep_name}}` | Assigned sales rep |
| `{{job_stage}}` | The stage just moved to (operations) |
| `{{deal_stage}}` | The stage just moved to (sales pipeline) |
| `{{company_name}}` | Your company name |
| `{{quote_price}}` / `{{quote_total}}` | The quote amount (formatted as dollars) |
| `{{invoice_amount}}` | The invoice total |
| `{{payment_method}}` | Check, ACH, credit card, etc. |
| `{{job_id}}` | Internal job ID |

## Example Automations You Can Build Right Now

Below are 18 practical examples. Each one takes 30 seconds to build in Admin → Automations.

1. **When a deal moves to Signed Contract**, send the customer an email: "Thanks {{customer_name}} — your fence install with {{company_name}} is confirmed. We'll be in touch with a schedule soon." Move the job to the "Awaiting Locates" operations stage. Notify the assigned rep.

2. **When a new customer is created**, post an activity note on their profile: "Welcome to FencePro — record created automatically on {{scheduled_date}}." Notify the office manager.

3. **When a job is created**, create a task for the office manager titled "Verify permit status for {{customer_name}}" due in 3 days.

4. **When a job moves to Materials Ordered**, notify the operations manager: "Materials ordered for {{customer_name}} at {{job_address}}."

5. **When a job is scheduled**, create a task for the rep due 2 days before the scheduled date: "Confirm crew and materials for scheduled job at {{job_address}}."

6. **When a job is flagged as a rain day**, send the customer an SMS: "Hi {{customer_name}} — weather is looking rough for your install. We'll reach out shortly to reschedule. — {{company_name}}"

7. **When a payment is received**, send the customer an email: "Payment received — thank you, {{customer_name}}. Amount: {{invoice_amount}}. Paid via {{payment_method}}."

8. **When an invoice is created**, send the customer an email with the invoice details and post a note on the customer's activity feed.

9. **When a quote is marked SOLD**, post an activity note on the customer: "Quote sold for {{quote_total}} on {{scheduled_date}}." Send the shop manager a notification to start material pickup planning.

10. **When a job moves to Pending Payment**, fire a reminder for the bookkeeper in 7 days to follow up if still unpaid.

11. **When a deal sits in First Contact for 7 days (with no movement)**, notify the assigned rep. _(Requires a scheduled job — see Known Limitations below.)_

12. **When a job moves to Scheduled**, send the customer an SMS: "Your fence install is scheduled for {{scheduled_date}}. We'll see you then! — {{company_name}}"

13. **When a deal moves to Proposal Sent**, create a follow-up task for the sales rep due in 3 days: "Check in with {{customer_name}} re: proposal."

14. **When a payment is received on a commercial invoice**, fire a webhook to your QuickBooks integration so the payment posts to the accounting side automatically.

15. **When a new customer comes from Google**, send the owner a notification: "New Google lead — {{customer_name}} at {{job_address}}."

16. **When a job is rescheduled**, post an activity note on the job showing the old date → new date for audit purposes, and SMS the customer the new date.

17. **When a deal moves to Lost Sale**, create a task for the sales manager to review why the deal was lost within 1 day.

18. **When a crew is assigned to a job**, send the crew foreman a notification with the job address, customer name, and phone number.

## Known Limitations

- **SMS requires Twilio** to be connected in Integrations. If it isn't, the SMS action will mark the run as failed with reason `SMS_SERVICE_NOT_CONFIGURED` — the attempt is still logged so you see what would have gone out.
- **Email requires SendGrid or SMTP** credentials in the server environment. Same behavior: without it, run log shows `EMAIL_SERVICE_NOT_CONFIGURED`.
- **Webhooks** require a publicly reachable URL. Webhook attempts timeout after 15 seconds and retry 3 times with 5-second delays.
- **Time-based triggers** (e.g. "fire this 3 days before the scheduled date" or "if a deal sits in one stage for 7 days") are **not yet supported** as standalone triggers. Workaround: use `Create Task` with a negative `taskDueDaysOffset` so the task appears in the rep's task list before the scheduled date.
- **Stale-job and deadline-approaching triggers** exist in the schema but require a cron scheduler that isn't running in production yet. These won't fire today.
- **Chained stage moves** are capped at 5 deep to prevent infinite loops. If automation A moves the job to stage X and automation B moves it to stage Y, and they loop, the engine aborts after 5 hops and logs a `CYCLE_PREVENTION` failure.
- **Notifications persist** in the bell dropdown until you click "Mark all read." There's no auto-dismiss.
- **The CRM web app is still localStorage-backed on the client side**, so Move Ops/Sales Stage actions log the intent and fire the chained trigger but the client-side stage update only applies when the user is viewing the board. The backend `ActivityLog` is the system of record for the intent.

---

_For a technical view of how the engine is wired and tested, see [AUTOMATION_AUDIT.md](AUTOMATION_AUDIT.md) and [AUTOMATION_TEST_RESULTS.md](AUTOMATION_TEST_RESULTS.md)._
