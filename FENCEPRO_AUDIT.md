# FencePro CRM — Full System Audit

Date: 2026-04-13

---

## 1. Sales Pipeline

### Stages (configStore.ts:111-116)
```
First Contact, Appointment, Estimating, Pending Signature,
Signed Contract, Job Prep, Pending Start, Jobs In Progress,
Job Complete, Pending Payment, Paid & Closed,
Lost Sale, No Answer
```

### Data Model
- **Storage:** localStorage key `fencepro_pipeline`
- **Interface:** `PipelineLead` (JobsPipeline.tsx:5-26)
- **Key fields:** `stage`, `leadTemp` (0-5 flame rating), `quotePrice`, `jobValue`, `paymentStatus`, `balanceDue`, `lastMoved`

### Quote Status Model (QuotesPage.tsx:8-40)
- **Storage:** localStorage key `fencepro_quotes`
- **Interface:** `SavedQuote`
- **Status enum:** `'DRAFT' | 'SENT' | 'SOLD' | 'LOST'`
- Quote going SOLD triggers job creation via `createJobFromQuote()`

### Stage Groups (JobsPipeline.tsx:44-47)
- PRE_SALE: First Contact, Appointment, Estimating, Pending Signature
- PRODUCTION: Signed Contract, Job Prep, Pending Start, Jobs In Progress
- CLOSING: Job Complete, Pending Payment, Paid & Closed
- DEAD: Lost Sale, No Answer

---

## 2. Operations Workflow

### Job Status (jobStore.ts:7-14)
```typescript
type JobStatus = 'staging' | 'scheduled' | 'in_progress' | 'completed' | 'invoiced' | 'paid' | 'on_hold'
```
Transition order (jobStore.ts:176): `staging → scheduled → in_progress → completed → invoiced → paid`

### Materials Status (jobStore.ts:16)
```typescript
type MaterialsStatus = 'not_ordered' | 'ordered' | 'received' | 'loaded'
```

### Staging Statuses — SEPARATE from Job status (StagingPage.tsx:23-36)
```
Awaiting Locates, Need Drawing, Materials Ordered, Ready to Pull,
Scheduled, Jobs In Progress, Job Complete,
Customer Delay, Hold (HOA), Deed Restricted, Backorder, Warranty / Call Back
```

### "Awaiting Locates"
- **NOT** a first-class Job status. It exists only in the Staging module's own status list.
- The unified Job model tracks locates via fields: `locatesDate`, `locatesExpDate`
- There is a disconnect: Staging has 12 operation statuses, Jobs has 7 lifecycle statuses

### Job Transition Functions (jobStore.ts)
- `advanceJob(id)` — moves through STATUS_ORDER sequentially (line 195-210)
- `holdJob(id, reason)` — pauses, stores `previousStatus`
- `unholdJob(id)` — restores `previousStatus`
- `updateJob(id, updates)` — arbitrary updates

---

## 3. Jobs Module

### File: JobsPage.tsx → delegates to JobsPipeline.tsx

### Displays
- **Board View** (Kanban): Columns for each job status (staging → paid)
- **List View** (Table): customer, fence style, status badge, crew, scheduled date, contract value, payment status

### Data Source
- `getJobs()` from jobStore.ts → localStorage `fencepro_jobs`
- KPI strip: active jobs count, total contract value, collected payments, outstanding, on-hold

### Actions
- Advance job to next status
- Hold/resume job
- Jump to specific status
- Edit job in drawer: materials status, pull sheet, crew, dates, invoice, payment, notes
- Sync to portal via `syncJob()`

---

## 4. Staging Module

### File: StagingPage.tsx

### Interface: StagingJob (separate from Job)
```typescript
interface StagingJob {
  id, clientName, contractDate, locatesGoodDate, locatesExpDate,
  area, sections, fenceType, manhoursSold, jobPrice, tearout,
  notes, status, quoteId?, createdAt, lastMoved
}
```

### Storage: localStorage `fencepro_staging`

### Displays
- Kanban board with columns for each staging status (12 columns)
- Job cards with client name, status badge, details

### Data Sources
- Staging jobs from `fencepro_staging`
- SOLD quotes from `fencepro_quotes` (auto-populates staging)

### How it differs from Jobs
| Aspect | Staging | Jobs |
|--------|---------|------|
| Purpose | Pre-production readiness | Execution & delivery lifecycle |
| Statuses | 12 (operational: locates, drawings, materials) | 7 (lifecycle: staging → paid) |
| Data model | StagingJob interface | Job interface |
| Storage | fencepro_staging | fencepro_jobs |

### Overlap Problem
Both track the same physical jobs but with different data models, different status lists, and different localStorage keys. A job can exist in both stores simultaneously with potentially conflicting states.

---

## 5. Schedule Module

### Files
- SchedulePage.tsx — monthly calendar view
- SmartSchedule.tsx — map-based geographic scheduling

### ScheduledJob Interface (SchedulePage.tsx:5-17)
```typescript
interface ScheduledJob {
  id, clientName, area, sections, fenceType, jobPrice, tearout,
  crewId, date, notes, stagingJobId?, status
}
```

### Schedule Statuses (SchedulePage.tsx:17)
```
'Scheduled' | 'In Progress' | 'Complete' | 'Rain Day' | 'Rolled Over'
```

### Work Days Config (SchedulePage.tsx:26-43)
- `workDays: number[]` — default Mon-Thu [1,2,3,4]
- `crews: Crew[]` — each has id, name, color

### Storage: localStorage `fencepro_schedule`

### SmartSchedule Features (SmartSchedule.tsx)
- Pulls from BOTH jobStore AND staging
- Geographic clustering via Haversine distance
- Job tags for at-a-glance info (materials, fence type, tear-out, locates)
- Google Maps integration

### Rain Day / Weather
- **"Rain Day" IS a valid status** in the ScheduledJob status type
- **"Rolled Over" IS a valid status** for pushed jobs
- **NO weather API integration** exists anywhere
- **NO automated weather checking** code found
- **NO commented-out weather code** found
- Rain day is purely manual — user must change a job's status to "Rain Day"
- There is no rain day log, no reschedule prompt, no visual indicator beyond the status badge

---

## 6. Automation / Trigger / Webhook Systems

### Existing Automation: Follow-Up Scheduler (Portal Backend)
**File:** followUpScheduler.ts

**Sequence:**
- 24h follow-up SMS
- 3-day reminder SMS
- 7-day last touch SMS

**Functions:**
- `scheduleFollowUps(leadId)` — creates 3 pending follow-ups
- `cancelFollowUps(leadId)` — cancels when lead books appointment
- `processFollowUps()` — runs every 5 min, sends due messages

### Event-Driven Hooks (hardcoded, not configurable)

| Event | What Fires | Where |
|-------|-----------|-------|
| Lead created | SMS confirmation + schedule follow-ups | leads.ts:174-178 |
| Appointment booked | Cancel follow-ups + SMS confirm + GCal push | appointments.ts:109-146 |
| Quote goes SOLD | Create Job record | App.tsx (via createJobFromQuote) |
| Job status changes | Sync to Portal | portalSync.ts (via syncJob) |
| Cron tick (5 min) | Process due follow-ups | cron.ts via Vercel Cron |

### Webhook Integrations
- **Botpress** — lead/appointment creation from chatbot
- **Portal Sync** — CRM → Portal push (X-API-Key auth)
- **Google Calendar** — appointment → GCal event push

### What Does NOT Exist
- **No configurable automation engine** — all triggers are hardcoded
- **No automation builder UI**
- **No automation table** in the database
- **No run log / audit trail** for automated actions
- **No conditional triggers** (e.g., "only if crew is X")
- **No email sending** — only SMS via Twilio
- **No in-app notifications** — no toast/alert system
- **No task creation** from triggers
- **No webhook-out** for external integrations (Zapier/Make)

---

## 7. Notification System

### SMS (only notification channel implemented)
**File:** sms.ts — Twilio REST API (no SDK)

**Functions:**
- `sendSms(to, body)` — core sender, falls back to console.log
- `sendLeadConfirmation(phone, firstName)` — welcome SMS
- `sendAppointmentConfirmation(phone, dateStr, firstName)` — booking confirm
- `sendFollowUp(phone, message)` — scheduled follow-up

### Email
**NOT IMPLEMENTED.** No SMTP, SendGrid, Mailgun, or email templates found anywhere.

### In-App Notifications
**NOT IMPLEMENTED.** No toast library, no notification center, no unread counts. Status changes show via React state updates only.

### Audit Log (Portal)
- Prisma `AuditLog` model records actions with metadata
- Used via `auditLog('action')` middleware on sensitive routes
- Not surfaced to users — backend-only logging

---

## Summary: Key Gaps This Prompt Will Address

1. **No configurable automation engine** — all triggers hardcoded
2. **No email notifications** — only SMS
3. **No in-app notification system** — no toasts, alerts, or notification center
4. **Jobs and Staging are disconnected** — two separate data models for the same things
5. **Rain Day is status-only** — no log, no reschedule flow, no weather data
6. **No automation builder UI** — all event handling is developer-coded
