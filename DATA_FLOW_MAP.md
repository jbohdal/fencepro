# EZ Biz — Data Flow Map

Generated: 2026-05-02

This document maps every significant data flow between modules in the EZ Biz platform.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    apps/web (React SPA)                              │
│  localStorage ◄──► Stores ◄──► Components                           │
│  automationTrigger → /api/automations/trigger                        │
│  portalSync → /api/sync/*                                            │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTP / REST
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 apps/portal (Express + PostgreSQL)                   │
│  Routes → Services → Prisma → PostgreSQL                             │
│  AutomationEngine → Email/SMS/Notifications                          │
│  Integration adapters → Third-party APIs                            │
└─────────────────────────────────────────────────────────────────────┘
```

**Data Storage:**
- **apps/web**: All primary CRM data lives in `localStorage` (quotes, jobs, customers, inventory, invoices, etc.)
- **apps/portal DB**: Authentication, customer portal accounts, automation rules, run logs, integrations, inbound leads, EZ Budget quotes, backup logs

---

## Module Data Flows

### Flow 1: Quote → Job → Pull Sheet

```
QuoteBuilder (user creates quote)
  │
  ├─► localStorage[fencepro_quotes] (saved quote)
  │
  └─► [On status change to SOLD]
        │
        ├─► jobStore.createJobFromQuote()
        │     └─► localStorage[fencepro_jobs] (new Job record)
        │
        ├─► billingStore.linkPullSheetToCustomer()
        │     └─► localStorage[fencepro_customer_pullsheets] (pull sheet snapshot)
        │
        ├─► pendingOrderStore.createPendingOrderFromQuote()
        │     └─► localStorage[fencepro_pending_orders] (material order)
        │
        ├─► automationTrigger.fireQuoteSold()
        │     └─► POST /api/automations/trigger {triggerType: 'quote_sold'}
        │           └─► AutomationEngine evaluates all active 'quote_sold' automations
        │                 └─► Actions: email, SMS, notification, task creation
        │
        └─► portalSync.syncQuote()
              └─► POST /api/sync/quotes (upsert to portal DB)
```

**Status:** ✅ Fully wired and working

---

### Flow 2: Job Lifecycle → Operations Board → Automation

```
Job created (status: 'staging')
  │
  ├─► OperationsBoard / OperationsPage (kanban display)
  │
  └─► [Drag card / status change]
        │
        ├─► jobStore.updateJob() → localStorage[fencepro_jobs]
        │
        ├─► automationTrigger.fireOpsStageChange()
        │     └─► POST /api/automations/trigger {triggerType: 'ops_stage_change'}
        │
        └─► [On completion]
              └─► jobCompleteFlow.onJobCompleted()
                    ├─► Update pipeline stage to 'Job Complete'
                    ├─► Update sales pipeline
                    └─► Fire 'payment_received' trigger when marked paid
```

**Status:** ✅ Fully wired

---

### Flow 3: Rain Day Cascade

```
SchedulePage (user marks rain day)
  │
  ├─► saveRainLog() → localStorage[fencepro_rainlog]
  │
  ├─► Affected job status → 'Rolled Over'
  │
  └─► automationTrigger.fireRainDayFlagged()
        └─► POST /api/automations/trigger {triggerType: 'rain_day_flagged'}
              └─► AutomationEngine → Actions (e.g., notify crew, update calendar)
```

**Rain day job rescheduling:** Jobs marked as "Rain Day" on the Schedule page get a new suggested date the next available workday. The cascade respects the `workDays` schedule setting.

**Status:** ✅ Rain day flagging and automation trigger wired. Calendar sync (Google Calendar) is a future integration.

---

### Flow 4: Inventory → Auto-PO

```
Quote saved as SOLD
  │
  └─► pendingOrderStore.createPendingOrderFromQuote()
        │
        └─► checkStockForOrder()
              ├─► getStockLevels() from inventoryStore
              ├─► [If stock < required] → toast.warning() displayed
              └─► [Low stock items] → flagged in pending order
                    └─► [Reorder point crossed] → purchaseOrderStore.createDraftPO()
```

**Status:** ✅ Stock check runs on every quote sold. PO auto-draft triggered when reorder point crossed.

---

### Flow 5: Invoice → AR → Cash Flow

```
Invoice created (billingStore.createInvoice)
  │
  ├─► localStorage[fencepro_invoices] (invoice record)
  │
  ├─► automationTrigger.fireInvoiceCreated()
  │     └─► POST /api/automations/trigger {triggerType: 'invoice_created'}
  │
  └─► BillingPage reads getInvoices() + getARSummary()
        └─► AR aging buckets (current, 1-30, 31-60, 61-90, 90+ days)
```

Payment received:
```
recordPayment() → localStorage[fencepro_payments]
  │
  ├─► Invoice.amountPaidCents updated, status → 'paid'
  │
  └─► automationTrigger.firePaymentReceived()
        └─► POST /api/automations/trigger {triggerType: 'payment_received'}
```

Cash flow feeds from: scheduled jobs (quotePrice), open invoices (balanceDueCents), vendor bills (AccountsPayable).

**Status:** ✅ Invoice creation, payment recording, AR aging all wired. Cash flow projection reads from billing store directly.

---

### Flow 6: Customer Created → Portal Account

```
CustomersPage (user saves new customer)
  │
  ├─► customerStore → localStorage[fencepro_customers]
  │
  ├─► automationTrigger.fireCustomerCreated()
  │     └─► POST /api/automations/trigger {triggerType: 'customer_created'}
  │
  └─► [Staff invites customer to portal]
        │
        ├─► portalAccountStore.sendPortalInvite()
        │     └─► POST /api/portal/invite → PortalAccount created in DB
        │
        └─► Customer activates via email link
              └─► POST /api/portal/activate → PortalAccount.status = 'active'
```

**Status:** ✅ Customer creation, portal invite, and portal activation fully wired.

---

### Flow 7: Automation Engine Flow

```
Frontend fires trigger
  │
  └─► POST /api/automations/trigger {triggerType, event}
        │
        └─► AutomationEngine.fireAutomations(triggerType, event)
              │
              ├─► Prisma: find all active Automations where triggerType matches
              │
              ├─► For each automation:
              │     ├─► Evaluate conditions (fromStage, toStage, fenceType, etc.)
              │     ├─► Execute actions in order:
              │     │     ├─► send_email → emailService.sendEmail()
              │     │     ├─► send_sms → sms.sendSms()
              │     │     ├─► send_notification → notificationService
              │     │     ├─► create_task → Prisma Task
              │     │     ├─► move_ops_stage → fires another trigger (depth-limited)
              │     │     ├─► move_sales_stage → fires another trigger
              │     │     ├─► post_activity_note → Prisma ActivityLog
              │     │     ├─► fire_webhook → HTTP POST to external URL
              │     │     └─► schedule_reminder → (queued follow-up)
              │     │
              │     └─► AutomationRunLog created (success/partial/failed)
              │
              └─► All actions run in setImmediate (non-blocking)
```

**Status:** ✅ Full automation engine running. Cycle prevention via `_chainDepth` counter (max 5).

---

### Flow 8: EZ Budget Widget → Lead

```
Embedded widget (third-party site)
  │
  └─► POST /api/ez-budget/quotes (public, no auth)
        │
        ├─► EzBudgetQuote created in Prisma
        │
        └─► [Staff converts]
              └─► POST /api/leads (Lead created from EzBudgetQuote data)
```

**Status:** ✅ Widget → DB fully wired.

---

### Flow 9: Lead Chat → Lead Scoring → Appointment

```
Embedded chatbot (Botpress widget)
  │
  └─► POST /api/lead-chat/message
        │
        ├─► leadScoring.scoreLead() → Lead.score (0-100)
        │
        └─► [Score >= threshold]
              └─► followUpScheduler.scheduleFollowUp()
                    └─► FollowUp record created (SMS/email scheduled)
```

**Status:** ✅ Lead scoring and follow-up scheduling wired. Actual SMS/email delivery requires Twilio/SendGrid env vars.

---

### Flow 10: CRM → Customer Portal Sync

```
CRM (apps/web) saves quote/job data
  │
  └─► portalSync.syncQuote(quote)
        │
        └─► POST /api/sync/quotes
              │
              └─► Prisma upsert into portal DB
                    └─► Customer sees data in portal (apps/portal/src/client)
```

**Status:** ✅ Quote sync wired. Job and invoice sync also wired via `/api/sync/jobs` and `/api/sync/invoices`.

---

## Cross-Module Dependency Matrix

| From \ To | Jobs | AR/Billing | Cash Flow | Inventory | Operations | Portal | Automations |
|-----------|------|------------|-----------|-----------|------------|--------|-------------|
| **Quotes** | ✅ creates | ✅ invoicing | ✅ feeds | ✅ triggers PO | ✅ feeds | ✅ synced | ✅ triggers |
| **Jobs** | — | ✅ invoicing | ✅ feeds | ✅ consumes | ✅ same data | ✅ synced | ✅ triggers |
| **Payments** | ✅ updates | — | ✅ feeds | — | ✅ updates status | ✅ visible | ✅ triggers |
| **Inventory** | — | — | ✅ feeds AP | — | ✅ staging deps | — | — |
| **Rain Day** | ✅ reschedules | — | ✅ shifts | — | ✅ cascades | — | ✅ triggers |
| **Automations** | ✅ can advance | ✅ can create | — | — | ✅ can advance | — | ✅ can chain |

---

## Known Data-Layer Architecture Notes

1. **localStorage is the primary store for the CRM**: All customer, quote, job, inventory, billing, and pipeline data lives in the browser's localStorage in `apps/web`. This means data is per-browser and not multi-device-synced unless explicitly synced to the portal DB.

2. **Portal DB is the secondary store**: The portal PostgreSQL DB holds auth, portal accounts, automation rules, integration config, leads, and synced CRM data.

3. **Sync direction is one-way**: CRM (localStorage) → Portal DB. There is no reverse sync from portal DB back to localStorage.

4. **Automation triggers are fire-and-forget**: The frontend fires a POST to `/api/automations/trigger` and does not wait for automation execution. This is by design to keep the UI responsive.
