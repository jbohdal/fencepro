# Automation Engine Audit

_Date: 2026-04-21_

## 1. Where the Engine Lives

| Role | File |
|---|---|
| Core evaluator | [apps/portal/src/server/lib/automationEngine.ts](apps/portal/src/server/lib/automationEngine.ts) |
| REST routes | [apps/portal/src/server/routes/automations.ts](apps/portal/src/server/routes/automations.ts) (CRUD, `/trigger`, run logs, tasks, notifications) |
| Email service | [apps/portal/src/server/lib/emailService.ts](apps/portal/src/server/lib/emailService.ts) — SendGrid + SMTP + console fallback, `applyMergeTags`, `buildEmailHtml` |
| SMS service | [apps/portal/src/server/lib/sms.ts](apps/portal/src/server/lib/sms.ts) — Twilio REST |
| Notifications | [apps/portal/src/server/lib/notificationService.ts](apps/portal/src/server/lib/notificationService.ts) |
| Client dispatcher | [apps/web/src/automationTrigger.ts](apps/web/src/automationTrigger.ts) — fires POST to `/api/automations/trigger` |
| Admin UI | [apps/web/src/AutomationsPage.tsx](apps/web/src/AutomationsPage.tsx) |
| Schema | [apps/portal/prisma/schema.prisma](apps/portal/prisma/schema.prisma) — `Automation`, `AutomationRunLog`, `Task`, `Notification` |

## 2. Trigger Types — Schema vs. Wired

Schema enum values (`AutomationTriggerType`): `sales_stage_change`, `ops_stage_change`, `job_created`, `job_assigned`, `job_scheduled`, `job_rescheduled`, `stale_job`, `deadline_approaching`, `form_submitted`, `payment_received`, `customer_no_response`, `rain_day_flagged`.

| Trigger | Wired? | Callsite |
|---|---|---|
| `ops_stage_change` | ✅ fires | `jobStore.advanceJob` ([jobStore.ts:257](apps/web/src/jobStore.ts#L257)), `OperationsPage.tsx:258` |
| `sales_stage_change` | ⚠ partial | Only fires from `QuoteOptionsPanel.tsx:275` (option accepted). **No wiring from JobsPage pipeline drag-drop.** |
| `job_created` | ⚠ partial | `jobStore.createJobFromQuote` only ([jobStore.ts:163](apps/web/src/jobStore.ts#L163)). Customer-direct creation flows do not fire. |
| `job_assigned` | ❌ **never fires** | Imported in `jobStore.ts:2` but never called. |
| `job_scheduled` | ❌ **never fires** | Imported in `jobStore.ts:2` but never called. No scheduling route fires it. |
| `rain_day_flagged` | ✅ fires | `SchedulePage.tsx:400` |
| `payment_received` | ⚠ partial | Fires only when `advanceJob` hits `paid` ([jobStore.ts:270](apps/web/src/jobStore.ts#L270)). Not from invoice payment flow — `billingStore.recordPayment` does not fire. |
| `job_rescheduled` | ❌ never fires | No caller. |
| `stale_job` | ❌ no evaluator | Requires a cron/scheduler not present on the portal. |
| `deadline_approaching` | ❌ no evaluator | Same. |
| `form_submitted` | ❌ never fires | No form-submission hook. |
| `customer_no_response` | ❌ never fires | Requires a cron. |

**Additional gap:** The spec calls for `job_stage_changed`, `deal_stage_changed`, `invoice_created`, `customer_created`, `quote_sold` — none of these names map to existing schema enum values. Current naming uses `ops_stage_change` / `sales_stage_change`. Either schema must gain new trigger types or callsites must adapt to existing names. **Decision: keep existing names (`ops_stage_change`, `sales_stage_change`) since they're already wired and the UI already references them. Add aliases so callers using `job_stage_changed` / `deal_stage_changed` still work. Add missing `customer_created`, `invoice_created`, `quote_sold` as new schema enum values.**

## 3. Action Types — Schema vs. Wired

Schema enum values (`AutomationActionType`): `move_ops_stage`, `move_sales_stage`, `send_email`, `send_notification`, `create_task`, `schedule_reminder`, `post_activity_note`, `fire_webhook`, `require_checklist_gate`.

| Action | Wired? | File reference |
|---|---|---|
| `send_email` | ✅ | `automationEngine.ts:205-238` — resolves `customer` / `rep` / `role:` / `custom:`; merges tags; calls `sendEmail`. |
| `send_notification` | ✅ | `automationEngine.ts:240-260` — uses `createNotification`. |
| `create_task` | ✅ | `automationEngine.ts:262-283` — writes `Task` record with optional due date. |
| `post_activity_note` | ⚠ half-wired | Creates a `Notification` labelled "Activity" ([line 287](apps/portal/src/server/lib/automationEngine.ts#L287)) — **not attached to any customer/job activity feed**. There is no activity log table. |
| `fire_webhook` | ⚠ no retries | Fires once; no retry, no timeout, no dedicated log entry beyond run log. |
| `move_ops_stage` | ❌ **stub** | Line 325 — "returns data for the caller to apply" — **does not update the job**. |
| `move_sales_stage` | ❌ **stub** | Same stub. |
| `schedule_reminder` | ✅ | Line 335 — creates a Task with a due date. |
| `require_checklist_gate` | ❌ stub | Line 357 — no checking logic. |
| `send_sms` | ❌ **missing from enum** | `sms.ts` exists; `automationEngine.ts:14` imports `sendSms` but **never calls it** — there is no `'send_sms'` case in the switch. |

## 4. Callsites for Triggerable Events

| Event source | Fires engine? |
|---|---|
| Drag on Operations board ([OperationsPage.tsx:258](apps/web/src/OperationsPage.tsx#L258)) | ✅ `fireOpsStageChange` |
| `jobStore.advanceJob` ([jobStore.ts:257](apps/web/src/jobStore.ts#L257)) | ✅ |
| `jobStore.createJobFromQuote` ([jobStore.ts:163](apps/web/src/jobStore.ts#L163)) | ✅ `fireJobCreated` |
| Sales pipeline drag (`JobsPage.tsx`) | ❌ **no fire** |
| Customer creation ([CustomersPage.tsx:1149](apps/web/src/CustomersPage.tsx)) | ❌ no fire |
| Quote saved as SOLD ([App.tsx:handleSaveQuote](apps/web/src/App.tsx)) | ❌ no `quote_sold` fire |
| Invoice created ([billingStore.createInvoice](apps/web/src/billingStore.ts)) | ❌ no fire |
| Payment recorded ([billingStore.recordPayment](apps/web/src/billingStore.ts)) | ❌ no fire (only `advanceJob → paid` fires) |
| Schedule rain day ([SchedulePage.tsx:400](apps/web/src/SchedulePage.tsx#L400)) | ✅ `fireRainDayFlagged` |
| QuoteOption accepted ([QuoteOptionsPanel.tsx:275](apps/web/src/QuoteOptionsPanel.tsx#L275)) | ✅ `sales_stage_change` |
| Scheduled date set | ❌ never |
| Crew assignment | ❌ never |

## 5. Email

- **Wired to real service:** yes — SendGrid (`emailService.ts:76`) + SMTP via direct API (`emailService.ts:92+`).
- **Falls back to console** if neither is configured.
- **Templates:** simple — `buildEmailHtml` wraps body in boilerplate; no stored templates.
- **Merge tags:** supported via `applyMergeTags` — `{{customer_name}}`, `{{job_address}}`, `{{scheduled_date}}`, `{{rep_name}}`, `{{job_stage}}`, `{{company_name}}`, `{{job_id}}`, `{{quote_price}}`.
- **Missing merge tags** per spec: `{{deal_stage}}`, `{{invoice_amount}}`, `{{quote_total}}`.
- **Gap:** console fallback returns `{success: true}` so a run log shows success even when no email was sent — spec says it should mark `EMAIL_SERVICE_NOT_CONFIGURED`.

## 6. SMS

- Real Twilio REST integration in `sms.ts`.
- **Not invoked by the engine.** The engine imports `sendSms` but no `'send_sms'` case exists. This must be added.
- Falls back to console with `{success: true, sid: 'fallback-no-twilio'}` — same issue as email: spec says mark as `SMS_SERVICE_NOT_CONFIGURED`.

## 7. Task Creation

- ✅ Real — writes to `Task` table (`automationEngine.ts:262`).
- Honors `taskAssignTo` user-or-role, `taskDueDaysOffset`, `taskPriority`, references `jobId`/`jobName`.

## 8. Webhook Outbound

- ✅ Real `fetch` call (`automationEngine.ts:298`).
- **No retries, no timeout, no exponential backoff.** Spec wants 3 retries with 5s delay.
- Body payload includes `event`, `automation.type`, `timestamp` — missing `entityType`, `entityId`, structured payload.

## 9. In-App Notifications

- ✅ Real — `notificationService.createNotification` writes to `Notification` table.
- Admin UI notifications bell **exists in AutomationsPage** and the notification route `/api/automations/notifications` works, but **no bell icon in the CRM web app top bar yet**. Users must actively navigate to see them.

## 10. Stage Advancement

- **Both `move_ops_stage` and `move_sales_stage` are stubs.** They log intent but never update a job or deal. Must be implemented — and must themselves fire the stage-change trigger so chained automations work, with cycle detection.

## 11. Run Log

- ✅ Real — every execution attempt writes a row in `AutomationRunLog`, plus a fallback row on engine-level failure.
- Status enum: `success`, `partial`, `failed`.

## 12. Race Conditions / Silent Failures

- `fireAutomations` is called inside a `.catch(err => console.error(...))` in the route handler — good: the HTTP response returns immediately with `success: true` and the engine runs in the background. **But** every `await` inside the engine can still throw; the top-level try/catch ([line 89](apps/portal/src/server/lib/automationEngine.ts#L89)) catches them, so the primary op is never crashed.
- **Issue:** the `fireTrigger` client call in `automationTrigger.ts` is fire-and-forget. If the portal is down the CRM never knows. Acceptable for non-blocking, but worth logging a client-side warn (already does).
- `createNotification` swallows errors silently (only console.error). Fine for non-critical, but the run-log would show success even when the notification insert failed. Not a crash, but a correctness gap.
- `post_activity_note` creates a notification labelled "Activity" — not the same thing as a customer/job activity log. This is mis-labelled and needs a real activity log.
- No de-duplication: if the same event fires twice rapidly the engine will run the automation twice. Acceptable for most cases.

## 13. Sync vs Async

- HTTP handler returns immediately — the engine runs async in the Node event loop.
- Inside the engine, each automation is processed sequentially (`for (const automation of automations)`), each action sequentially (`for (const action of actions)`). For most workloads that's fine; it means a slow action (e.g. 10s email timeout) serializes others in the same trigger. Not a blocker for typical volume.
- **Top-level try/catch guarantees no thrown error can surface to the HTTP layer** — good.

---

## Repair Plan Summary (feeds Phase 3)

1. **Engine core:**
   - Add alias support for `job_stage_changed` → `ops_stage_change`, `deal_stage_changed` → `sales_stage_change`, `invoice_created`, `customer_created`, `quote_sold`.
   - Add `send_sms` case to the action switch.
   - Implement real `move_ops_stage` / `move_sales_stage` — emit a new nested event, with a `_depth` counter to prevent cycles.
   - Webhook: add 3-retry with 5s delay; enriched payload.
   - Email / SMS: when service not configured, mark run log `failed` with `reason: 'EMAIL_SERVICE_NOT_CONFIGURED'` / `SMS_SERVICE_NOT_CONFIGURED`.
   - Activity note: write to new `ActivityLog` table (add migration) instead of misusing `Notification`.
2. **Schema additions:** new trigger enum values (`customer_created`, `invoice_created`, `quote_sold`); `ActivityLog` model.
3. **Client wiring:** fire `customer_created` on customer save, `quote_sold` on SOLD transition, `sales_stage_change` on pipeline drag, `job_scheduled` on schedule updates, `job_assigned` on crew changes, `invoice_created` on invoice creation, `payment_received` on billingStore payment record.
4. **Merge tags:** add `{{deal_stage}}`, `{{invoice_amount}}`, `{{quote_total}}`, `{{payment_method}}`.
5. **Non-blocking:** already non-blocking; add `setImmediate` wrapper at the route boundary for extra defensive isolation.
6. **Notification bell:** add a bell icon + polling dropdown to the CRM web app header (makes in-app notifications visible).

Proceeding to Phase 3.
