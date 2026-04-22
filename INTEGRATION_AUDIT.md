# Integration Audit — Lead → Customer → Quote → Job

_Date: 2026-04-22_

## 1. Leads vs. Customers — Current State

**Two distinct stores (both localStorage):**
- `fencepro_customers` — [CustomersPage.tsx:1118](apps/web/src/CustomersPage.tsx#L1118). Shape: `{id, firstName, lastName, phone, email, serviceAddress, billingAddress, leadSource, salesRep, tags[], notes, createdAt, firstApptDate, jobStatus?}`.
- `fencepro_pipeline` — [JobsPage.tsx:81](apps/web/src/JobsPage.tsx#L81). Shape: `{id, firstName, lastName, phone, email, address, leadSource, leadTemp, fenceType, sections, quotePrice, stage, createdAt, lastMoved, notes, customerId?}`.

Pipeline entries carry `customerId` (added in a previous pass via `pipelineSeeder.ts`) but **that's optional**. The QuickAddModal on the JobsPage board creates a pipeline lead with a brand-new UUID and does **not** write to `fencepro_customers`. So there are two ways to enter the system and they diverge:

| Entry | Creates customer row? | Creates pipeline row? |
|---|---|---|
| Customers page → + New | ✅ | ✅ (seeded via `addLeadForNewCustomer` in a prior pass) |
| Pipeline → Add Lead quick-add | ❌ | ✅ |
| Import CSV | ✅ | ✅ (seeded) |
| SaveModal → "New Customer" tab in QuoteBuilder | ✅ | ✅ (seeded) |

**Gap to fix in Phase 2:** QuickAddModal must also create a customer record. Make the pipeline entry `customerId` mandatory and always created from a real customers-table row.

## 2. Signed-Contract Trigger

**Current:** [JobsPage.tsx:690-720](apps/web/src/JobsPage.tsx) (updated in the previous pass) fires `fireSalesStageChange(id, prev.stage, stage, …)` on drag-drop. That delivers to the automation engine but **does not**:
- Update any quote's status to SOLD
- Create a job record
- Surface the sold state on the customer profile

Creating a Job record happens **only** from [App.tsx:handleSaveQuote](apps/web/src/App.tsx) when a quote is explicitly saved as SOLD inside the QuoteBuilder. There's no code path that says "deal moved to Signed Contract → find its quote → flip to SOLD → create job".

**Gap to fix in Phase 3:** add a `onDealSigned` handler in JobsPage `handleDrop` that finds the customer's most recent non-LOST/non-SOLD quote, marks it SOLD, creates the job via `createJobFromQuote`, fires `quote_sold` + `job_created`.

## 3. Operations Stages — Storage

**Hardcoded, two places:**
- `jobStore.ts:9` — `JobStatus = 'staging' | 'scheduled' | 'in_progress' | 'completed' | 'invoiced' | 'paid' | 'on_hold'`.
- `OperationsPage.tsx:13-22` — `COLUMNS` array with keys + colors.

There is **no admin UI** to edit operations stages. No database table. No user-editable config. Rename or reorder requires a code change + deploy.

**Gap to fix in Phase 4:** new `fencepro_ops_stages` store (localStorage + Prisma `OperationsStage` model). OperationsPage reads from this store. Settings page lets users edit names, colors, order, first-stage flag, completion flag.

## 4. Pipeline Settings

- `fencepro_config.pipelineStages` exists in [configStore.ts:111](apps/web/src/configStore.ts#L111) (13 default stages).
- `AdminSettingsPage` has a Pipeline tab — but let me verify it actually saves + whether JobsPage reads from it. Looking at [JobsPage.tsx:109](apps/web/src/JobsPage.tsx#L109): `stages: DEFAULT_STAGES` is the hardcoded array inside JobsPage. It seeds into `fencepro_pipeline.stages` on first load then never re-reads `fencepro_config.pipelineStages`. **Changes saved in Settings are ignored by the live board.**

**Gap to fix in Phase 5:** `loadPipeline` must sync the stages from `fencepro_config.pipelineStages` when the user edits them in Settings. Use a storage event listener or a `settings:updated` custom event.

## 5. Quote Real-Time Display

- [QuotesPage.tsx:608](apps/web/src/QuotesPage.tsx#L608) `localQuotes` state is hydrated once on mount from localStorage. Saving a new quote elsewhere in the app doesn't push into this state.
- Customer profile's Quotes tab reads from a `quotes` prop passed down from CustomersPage; `quotes` is a `useState` with initial hydration and never refetched.

**Gap to fix in Phase 6:** dispatch a `fencepro:quotes:updated` custom event on save; pages listen + re-read from localStorage.

## 6. Quote Send Flow

- There is **no `Send Quote` button** in the code I can see. `QuoteDrawer` ([QuotesPage.tsx:265](apps/web/src/QuotesPage.tsx#L265)) has status transition buttons (DRAFT / SENT / SOLD / LOST) but no email-sending action.
- `portalSync.syncQuote` is called after save and fires a POST to `/api/sync/quote` (for the customer portal to display), not an email.
- **No email template. No hosted quote page for generic quotes** (only for Good/Better/Best options via `/#/present/:token`).

**Gap to fix in Phase 7:** build the hosted quote page + a `Send Quote` button that opens an email-compose modal + uses templates.

## 7. Quote View on Customer Profile

- Clicking a quote in CustomersPage Quotes tab navigates to the main QuoteBuilder via `onNewQuote`/open. It doesn't open a read-only drawer.
- A `QuoteDrawer` exists in QuotesPage but isn't reachable from the customer profile.

**Gap to fix in Phase 8:** promote the drawer to a shared component and hook it up from the customer profile Quotes tab with a click.

## 8. Jobs Tab

- [CustomersPage.tsx:1143](apps/web/src/CustomersPage.tsx#L1143) now reads `fencepro_jobs` (fixed in prior pass). Before the prior pass it only showed `SAMPLE_JOBS`.
- Jobs are only created when a quote is SOLD (via `createJobFromQuote`).
- **Empty state text is missing.**

**Gap to fix in Phase 9:** Use real jobs, show full job row + link to Operations board, show empty-state explanation, add a stage-color badge from the ops-stages config.

## 9. Mark as Sold

**Current locations:**
- QuoteBuilder SaveModal — status radio button ([QuoteBuilder.tsx:274](apps/web/src/QuoteBuilder.tsx)).
- QuoteDrawer status buttons ([QuotesPage.tsx:302](apps/web/src/QuotesPage.tsx#L302)).
- Pipeline drag-drop — **does not flip the quote status today** (that's the core bug).

**Gap to fix in Phase 3 + 8:** add explicit "Mark as Sold" action on the customer profile Quote drawer + wire pipeline Signed-Contract to auto-mark the quote sold.

## 10. Intended Full Flow (end state)

```
Add Lead (pipeline QuickAdd) ──┐
                               ├─► Customer row (fencepro_customers) + Pipeline row (fencepro_pipeline, stage: First Contact)
Add Customer (CustomersPage) ──┘                │
                                                ▼
                                     Create Quote (QuoteBuilder)
                                                │ save → fencepro_quotes (with customerId)
                                                ▼
                                     Quote displayed on Customer profile Quotes tab
                                                │ Send Quote → hosted page + email
                                                ▼
                                     Customer views /#/quote/:token → accepts
                                                │
                                  ┌─────────────┴──────────────┐
                                  │                            │
                      Pipeline drag → Signed Contract    Mark as Sold in quote drawer
                                  │                            │
                                  └─────┬──────────────────────┘
                                        ▼
                          Quote.status = SOLD + Job created +
                          Activity note on customer + Automation engine fired
                                        │
                                        ▼
                              Operations board column 1 (first ops stage)
                                        │
                                        ▼
                              Jobs tab on customer profile updated live
```

## 11. Settings Save/Reflect Gaps (summary)

| Setting | Saves? | Reflects live? | Notes |
|---|---|---|---|
| Company info | ✅ | ⚠ (nav header reads once on mount) | header only re-reads on reload |
| Pricing (man hour rate, commission) | ✅ | ❌ | QuoteBuilder hardcodes `MAN_HOUR_RATE=22` ([QuoteBuilder.tsx:36](apps/web/src/QuoteBuilder.tsx#L36)) |
| Fence styles | ✅ | ❌ | QuoteBuilder has its own hardcoded `FENCE_STYLES` ([QuoteBuilder.tsx:6-33](apps/web/src/QuoteBuilder.tsx)) |
| Lead sources | ✅ | ⚠ (some forms use the config; SaveModal in QuoteBuilder hardcodes `LEAD_SOURCES`) |
| Tags | ✅ | ✅ (CustomersPage reads from config) |
| Pipeline stages | ✅ | ❌ | JobsPage ignores the saved config; uses its own `DEFAULT_STAGES` |
| Operations stages | ❌ (no editor) | N/A | Hardcoded |

**Gap to fix in Phase 5:** (a) make QuoteBuilder read `manHourRate` + fence styles from config; (b) make JobsPage read pipeline stages from config; (c) build Operations stages editor.

Proceeding to Phase 2.
