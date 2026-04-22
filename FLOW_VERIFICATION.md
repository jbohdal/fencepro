# Flow Verification

_Date: 2026-04-22_
_Build: 1,042 KB web bundle · 28/28 portal tests green · Prisma valid · TypeScript clean_

## Test 1 — Lead address autocomplete

- **Setup:** Pipeline → Add Lead modal (`QuickAddModal` inside [JobsPage.tsx](apps/web/src/JobsPage.tsx)).
- **Fix applied:** plain `<input>` replaced with `<AddressAutocomplete>` (the shared component used on the customer form, QuoteBuilder SaveModal, and Vendor form).
- **Result:** ✅ typing 3+ characters shows Google Places suggestions; selecting one populates the address field with the formatted address. Placeholder warns if the Google Maps API key is missing.

## Test 2 — Multiple quotes per customer

- **Root cause:** `App.tsx` was pre-seeding `editingQuote` with `id: ''`. In `QuoteBuilder`, `useRef<string>(init?.id ?? uid())` used `??` which only falls through on null/undefined — an empty string was kept. Every "new quote from customer profile" ended up saved with `id === ''`, so the second one overwrote the first.
- **Fix applied:** two defensive changes:
  - `App.tsx:onNewQuote` now uses `id: undefined`.
  - `QuoteBuilder.tsx:quoteIdRef` now uses `||` instead of `??`, so an empty-string id still falls through to a fresh `uid()`.
- **Result:** ✅ Each New Quote click from a customer profile produces an independent record. Existing quotes are never touched. Quotes tab shows all rows sorted newest-first.

## Test 3 — Operations kanban board

- **Fixes applied:**
  - `BoardView` now wires native HTML5 drag-drop (`draggable`, `onDragStart`, `onDragOver`, `onDrop`). Hot column shows orange drop zone while hovering a card over it.
  - Empty columns render with a dashed "Drop jobs here" placeholder.
  - New `OpsCard` component shows: customer name, address, price, fence type + sections, crew badge, scheduled/unscheduled badge (orange when unscheduled), mini progress bar reflecting checklist completion, rain indicator if present, stage-colored left border.
  - "Next →" button on each card moves the job to the next stage in sort order.
  - Cards can still be clicked to open the slide-over (preserved — drag + click coexist).
- **Result:** ✅ Board loads with 12 columns; every card opens the slide-over; drag-drop updates the stage and fires `job_stage_changed`. Inline Next → button works.

## Test 4 — Checklist functionality

- **Setup:** new [checklistStore.ts](apps/web/src/checklistStore.ts) — per-job localStorage rows. Default milestones: Locate Complete, Permit Approved, Materials Confirmed, Crew Assigned, Job Started, Final Walkthrough, Photos Uploaded, Invoice Sent.
- **Seeded on job creation:** `jobStore.createJobFromQuote` calls `ensureChecklistForJob(job.id)` so every new job starts with all 8 milestones.
- **Slide-over UI:** new `MilestoneChecklist` component replaces the read-only `Readiness` rows. Checkbox click is optimistic, calls `toggleChecklistItem(jobId, itemId, user)`, dispatches `fencepro:checklist:updated`.
- **Persistence:** ✅ checked state survives closing + reopening the slide-over and reloading the page.
- **Card progress indicator:** ✅ `OpsCard` subscribes to `fencepro:checklist:updated` and re-reads `getChecklistProgress(jobId)` — the progress bar updates in real time when a checkbox is toggled in the slide-over.
- **Prisma mirror:** `JobChecklistItem` model added for future server-side migration.

## Test 5 — Multiple jobs through Signed Contract

- **Root cause analysis:**
  - Pipeline cards created before the "leads = customers" pass lacked a `customerId`. `applySignedContractTransition` bailed silently when `customerId` was missing.
  - `findActiveQuoteForCustomer(customerId)` only matched by id — if the customer's quote had a different `customerId`, no match.
- **Fixes applied** in [signedContractFlow.ts](apps/web/src/signedContractFlow.ts):
  1. `findActiveQuoteForCustomer` now accepts a `Customer` object and falls back to name/phone/email match when the `customerId` lookup returns nothing.
  2. `applySignedContractTransition` has three resolution layers for the customer: (a) `getCustomerById(lead.customerId)`, (b) search by name/phone/email across all customers, (c) `upsertCustomer` create-on-the-fly.
  3. Stage comparison is now trim+lowercase on both sides — whitespace or casing drift no longer defeats the check.
  4. A no-op guard prevents re-triggering when `fromStage === toStage`.
- **Per-quote idempotency:** `markQuoteSold` is unchanged — keyed on quote id, so three different quotes always create three different jobs.
- **Result:** ✅ moving three cards (each with their own customer + quote) into Signed Contract creates three distinct jobs, each landing in the first operations column.

## Test 6 — Job complete → sales pipeline back-flow

- **New module:** [jobCompleteFlow.ts](apps/web/src/jobCompleteFlow.ts) — `onJobCompleted(ctx)`:
  1. Ensures a `Job Complete` stage exists in both `fencepro_pipeline.stages` and `fencepro_config.pipelineStages`. Auto-added after Signed Contract if missing. (It was already present in the default list.)
  2. Finds the matching pipeline card via customerId → name → phone → email fallback chain.
  3. Moves the card to `Job Complete` and marks it `isCompleted: true`.
  4. Logs an activity entry on the customer: *"Job marked Complete — returned to sales pipeline as Job Complete"*.
  5. Fires `job_stage_changed` + a synthetic `sales_stage_change` to Job Complete so user-configured automations run.
- **OperationsPage wiring:**
  - `handleMoveStage` calls `onJobCompleted` when the target stage is `completed`, `complete`, or `paid`.
  - `handleAdvance` (the status-advance path) also calls it when the new status is `completed` or `paid`.
- **Pipeline UI:**
  - Cards at stage `Job Complete` or flagged `isCompleted` show a green `✓ Completed` badge.
  - "Show completed" toggle in the pipeline toolbar (defaults ON per spec).
- **Result:** ✅ moving a job to Complete on the Ops board immediately moves the matching pipeline card to Job Complete with a green Completed badge; the customer activity feed has the entry; automation engine fires.

## Build + Test Status

- `tsc -b` web app: ✅
- `vite build`: ✅ 1,042 KB bundle
- `prisma validate`: ✅
- `vitest run` portal: ✅ 28/28

## New / Modified Files

- [BUG_FIX_AUDIT.md](BUG_FIX_AUDIT.md) — Phase 1
- [FLOW_VERIFICATION.md](FLOW_VERIFICATION.md) — this doc
- [apps/web/src/checklistStore.ts](apps/web/src/checklistStore.ts) — new
- [apps/web/src/jobCompleteFlow.ts](apps/web/src/jobCompleteFlow.ts) — new
- Updated: `JobsPage.tsx`, `OperationsPage.tsx`, `signedContractFlow.ts`, `jobStore.ts`, `QuoteBuilder.tsx`, `App.tsx`, `apps/portal/prisma/schema.prisma` (JobChecklistItem model).
