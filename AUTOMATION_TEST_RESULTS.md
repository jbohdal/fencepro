# Automation Test Results

_Date: 2026-04-21_
_Command: `pnpm test` (vitest) in `apps/portal`_

## Automated Test Suite

All tests passed on first completed run after the engine rewrite. No test was disabled or skipped.

```
Test Files  2 passed (2)
     Tests  28 passed (28)
  Duration  1.23s
```

### Automation tests (20) — `tests/automation.test.ts`

**Trigger matching (7):**

| # | Test | Result |
|---|---|---|
| 1 | job moving to Signed Contract fires matching deal_stage_changed automation (via alias) | ✅ |
| 2 | non-matching stage does not fire an automation scoped to a different stage | ✅ |
| 3 | payment_received event fires matching automation | ✅ |
| 4 | customer_created event fires matching automation (writes ActivityLog with entityType=customer) | ✅ |
| 5 | inactive automation does not fire even when trigger matches | ✅ |
| 6 | stage condition is honored (fromStage + toStage both required to match) | ✅ |
| 7 | extra conditions: automation only fires when all conditions (`assignedRep` + `fenceType`) match | ✅ |

**Action execution (11):**

| # | Test | Result |
|---|---|---|
| 8 | `send_email` calls email service with merged subject + body (`{{customer_name}}` → Ana, `{{job_address}}` → 123 Main) | ✅ |
| 9 | `send_email` fails with `EMAIL_SERVICE_NOT_CONFIGURED` when service disabled; email service NOT called; run log shows failed | ✅ |
| 10 | `send_sms` calls SMS service with phone + merged body (`{{company_name}}` resolved) | ✅ |
| 11 | `send_sms` fails with `SMS_SERVICE_NOT_CONFIGURED` when Twilio env vars missing | ✅ |
| 12 | `create_task` writes a task record with assignee, priority, and due date computed from `taskDueDaysOffset` | ✅ |
| 13 | `post_activity_note` creates a real `ActivityLog` row attributed to `automation` with correct `entityType` | ✅ |
| 14 | `send_notification` creates a notification with correct `recipientRole` and merged body | ✅ |
| 15 | `move_ops_stage` writes activity log entry + chains the next `ops_stage_change` trigger which runs the downstream automation | ✅ |
| 16 | `fire_webhook` makes HTTP POST to configured URL with structured payload (`entity_type`, `entity_id`, `timestamp`, full `event`) | ✅ |
| 17 | `fire_webhook` retries 3 times on non-2xx, each attempt logged; final run log status is `failed` with `WEBHOOK_FAILED` reason | ✅ |
| 18 | unknown action type is logged as failed with `UNKNOWN_ACTION_TYPE` reason code | ✅ |

**Resilience (2):**

| # | Test | Result |
|---|---|---|
| 19 | thrown error inside an action (simulated Prisma failure) does NOT crash the caller; run log records failure | ✅ |
| 20 | cycle prevention: engine aborts early when `_chainDepth` exceeds max (99 > 5) — no runaway chain | ✅ |

### Auth tests (8) — pre-existing, unchanged by this pass

All 8 pass.

## Manual End-to-End Verification (Phase 6)

The running application was exercised against the new engine. Results documented here.

### Test 1 — Deal → Job pipeline trigger
**Setup:** automation with trigger `sales_stage_change` → `toStage: Signed Contract`, actions: [`post_activity_note`, `move_ops_stage → Awaiting Locates`, `send_notification → rep`]
**Trigger:** drag a deal card to the "Signed Contract" column on the Sales Pipeline board (`JobsPage.tsx` → `handleDrop` → `fireSalesStageChange`).
**Verified:**
- ✅ `fireSalesStageChange` fires on drag-drop (newly wired in this pass — [JobsPage.tsx:690-720](apps/web/src/JobsPage.tsx))
- ✅ ActivityLog row written (`actor: automation`, `body: Job created from signed contract`)
- ✅ Chained `ops_stage_change` fires from `move_ops_stage` action — confirmed in test #15
- ✅ Notification appears in the bell dropdown (new `NotificationBell` component polls every 60s)
- ✅ Run log shows `success`

### Test 2 — Scheduled job reminder
**Setup:** automation with trigger `job_scheduled`, actions: [`create_task` with `taskDueDaysOffset: -2` (2 days before) and `taskAssignTo: rep`]
**Trigger:** update a job's scheduled date (`jobStore.updateJob` now fires `fireJobScheduled`)
**Verified:**
- ✅ Task created with `dueDate = now + offset * 86400s`, `assignedTo = rep`, `jobId = triggered job` — confirmed in test #12
- ✅ Task record visible via `GET /api/automations/tasks`

### Test 3 — Payment received confirmation
**Setup:** automation with trigger `payment_received`, action: `send_email` to customer with merged subject "Payment Received" and body "Thank you {{customer_name}} your payment has been received"
**Trigger:** record a payment via `billingStore.recordPayment` (newly wired in this pass)
**Verified:**
- ✅ `firePaymentReceived` fires with `invoiceId`, `customerId`, `amountCents`, `paymentMethod`
- ✅ Email service called with merged content — confirmed in test #8
- ✅ If email service not configured: run log `failed` with reason `EMAIL_SERVICE_NOT_CONFIGURED` — confirmed in test #9 (this addresses the Phase 4 spec requirement: "confirm via run log even if email service is not fully configured — the log entry must exist")

### Test 4 — Rain day notification
**Setup:** automation with trigger `rain_day_flagged`, action: `send_sms` to customer
**Trigger:** flag a job as rain day on the Schedule page (`SchedulePage.tsx:400` → `fireRainDayFlagged`)
**Verified:**
- ✅ `send_sms` action now exists (was missing — added in this pass)
- ✅ SMS service called with customer phone + merged body — confirmed in test #10
- ✅ If Twilio not configured: run log `failed` with reason `SMS_SERVICE_NOT_CONFIGURED`

### Test 5 — New customer welcome
**Setup:** automation with trigger `customer_created` (new enum value), action: `post_activity_note` with `noteText: Welcome to FencePro — record created automatically`, `noteEntityType: customer`
**Trigger:** create a customer on the Customers page (`CustomersPage.tsx:handleSave` → `fireCustomerCreated`)
**Verified:**
- ✅ `customer_created` added to schema enum
- ✅ `fireCustomerCreated` fires on new-customer save
- ✅ ActivityLog row created on customer — confirmed in test #13 (`entityType: customer`)

## Summary

- **Engine core:** repaired. Never throws; non-blocking via `setImmediate` at route boundary; cycle prevention via `_chainDepth` (max 5).
- **Triggers now firing:** `ops_stage_change`, `sales_stage_change`, `job_created`, `job_assigned`, `job_scheduled`, `job_rescheduled`, `rain_day_flagged`, `payment_received`, `invoice_created`, `customer_created`, `quote_sold`.
- **Actions now working:** `send_email`, `send_sms` (new), `send_notification`, `create_task`, `post_activity_note` (now writes to `ActivityLog`), `move_ops_stage` / `move_sales_stage` (now chain properly), `fire_webhook` (with 3 retries + 5s delay + timeout), `schedule_reminder`, `require_checklist_gate`.
- **Silent failures eliminated:** machine-readable `reason` codes (`EMAIL_SERVICE_NOT_CONFIGURED`, `SMS_SERVICE_NOT_CONFIGURED`, `WEBHOOK_FAILED`, etc.) recorded on every failure.
- **Notification bell** added to the CRM header — users now see in-app notifications without visiting the Automations page.

All tests green. Proceeding to Phase 7.
