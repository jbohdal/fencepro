# Board Redesign — Phase 1 Audit
**Date:** 2026-04-28
**Targets:** Sales Pipeline + Operations boards in `apps/web`

---

## 1. Sales Pipeline board

| Item | Finding |
|---|---|
| Component file | [apps/web/src/JobsPage.tsx](apps/web/src/JobsPage.tsx) (default export `JobsPage`, 934 lines) |
| Mounted via | `App.tsx:814` — `{active === 'Sales Pipeline' && <JobsPage />}` |
| Data source | `localStorage` key `fencepro_pipeline` — `{ leads: PipelineLead[], stages: string[] }`. Configured stages override from `localStorage.fencepro_config.pipelineStages`. |
| Lead type | `PipelineLead` (firstName, lastName, phone, email, address, leadSource, leadTemp 0–5, fenceType, sections, quotePrice, crew, scheduledDate, jobValue, paymentStatus, balanceDue, notes, stage, createdAt, lastMoved, assignedRep) |
| Stage count | 13 default stages: First Contact, Appointment, Estimating, Pending Signature, Signed Contract, Job Prep, Pending Start, Jobs In Progress, Job Complete, Pending Payment, Paid & Closed, Lost Sale, No Answer |
| Drag-and-drop | Native HTML5 `draggable=true` + `onDragStart` / `onDrop`. No library. |
| Board layout | `<div className="flex gap-4 overflow-x-auto pb-4 flex-1">` — **horizontal scroll** with `w-64` columns (256px each). 13 columns × 256px ≈ 3,328px wide → mostly off-screen on a 1280 viewport. |
| Avg deals per stage in test data | Empty in the live tenant (the QA run found 4 customers, no deals). Seed data in `customerStore` puts most in early stages. |
| List view | None inside Sales Pipeline; only inside the legacy `JobsPipeline.tsx`. |
| View-toggle persistence | None. |

## 2. Operations board

| Item | Finding |
|---|---|
| Component file | [apps/web/src/OperationsPage.tsx](apps/web/src/OperationsPage.tsx) (default export `OperationsPage`, 817 lines) |
| Mounted via | `App.tsx:815` — `{active === 'Operations' && <OperationsPage />}` (also Jobs / Staging) |
| Data source | `getJobs()` from [apps/web/src/jobStore.ts](apps/web/src/jobStore.ts) (localStorage `fencepro_jobs`) merged with `localStorage.fencepro_staging`. Output: `UnifiedJob[]`. |
| Stage count | 12 fixed `OPS_STAGES`: awaiting_locates, need_drawing, materials_ordered, ready_to_pull, scheduled, in_progress, completed, invoiced, paid, on_hold, customer_delay, backorder |
| Drag-and-drop | Native HTML5. |
| Job card fields | customerName, address, fenceType + sections, contractValue, scheduledDate (or "Unscheduled" badge), crewAssigned, optional rain-day badge, milestone progress bar from [checklistStore](apps/web/src/checklistStore.ts) (`getChecklistProgress(jobId)` returns `{ total, complete }`), plus a hover "Next →" advance button. |
| Board layout | `<div className="flex gap-3 overflow-x-auto pb-4">` with `w-72` columns (288px) — **horizontal scroll** at every viewport size. |
| List view | Yes, 7-column grid table (Customer, Fence Type, Stage, Crew, Date, Value, Actions). |
| View-toggle persistence | None — `useState('board')` resets on every mount. |
| Detail panel | `<DetailPanel>` — fixed inset-y-0 right-0, `lg:w-[480px]`, full-width on mobile (`w-full`). |

## 3. Mobile behavior at 390px

- Both boards inherit `flex gap-X overflow-x-auto` from desktop, so on mobile they keep horizontal scroll. The visible viewport shows ~1.4 columns of pipeline cards or 1.3 columns of ops cards before truncation. **No responsive overrides** for the board layout itself.
- `OperationsPage` list view falls back to a stacked single-column layout via `flex flex-col lg:grid lg:grid-cols-12`, so list view is mobile-friendly.
- `OperationsPage` KPI strip is responsive (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`).
- `JobsPage` KPI/header is **not** responsive — search input + 3 numeric badges + button on a single row at any viewport.
- The `DetailPanel` slide-over uses `w-full lg:w-[480px]` so it covers the screen on mobile (acceptable). The Sales Pipeline `LeadDrawer` is similar.
- Cards do not adopt a mobile-specific layout; they keep the same density.

## 4. Card interaction model

- Sales Pipeline card click → opens `<LeadDrawer>` slide-over (right side, `w-[640px]` on lg).
- Operations card click → opens `<DetailPanel>` slide-over (right side, `w-[480px]` on lg) populated with: customer info, scope, materials & staging toggles, scheduling fields, payment, notes, and a checklist tab.
- Hover on Operations card reveals a "Next →" button that advances to the next ops stage.
- No three-dot action menu currently exists on either board.
- No swipe gestures.
- No bottom sheet on mobile — slide-over covers the screen full-width.

## 5. Existing view-toggle infrastructure

- `OperationsPage` has a Board / List toggle stored in component state only (lost on navigation).
- `JobsPage` (Sales Pipeline) has no Board/List toggle.
- `JobsPipeline` (legacy, mounted on the "Jobs" / "Staging" tabs but **not** on Sales Pipeline) has its own Board/List toggle, also non-persistent.
- No `localStorage` persistence of view preference exists.

---

## Key data-layer references the new boards must preserve

- `loadPipeline()` / `savePipeline()` in `JobsPage.tsx` — pipeline source of truth + dispatches `fencepro:pipeline:updated` event.
- `applySignedContractTransition()` from `signedContractFlow.ts` — fires when a deal moves to `Signed Contract` and creates the corresponding job + marks quote SOLD.
- `fireSalesStageChange()` / `fireOpsStageChange()` from `automationTrigger.ts` — must continue firing on every move.
- `getJobs()` / `updateJob()` / `advanceJob()` / `holdJob()` / `unholdJob()` from `jobStore.ts`.
- `mapJobStatusToOps()` and `mapStagingStatus()` from `OperationsPage.tsx` — must keep mapping logic identical.
- `getChecklistProgress(jobId)` from `checklistStore.ts` for milestone bars.
- `onJobCompleted()` from `jobCompleteFlow.ts` — cascades job-completion back into the sales pipeline.
- `LeadDrawer` and `QuickAddModal` (in `JobsPage.tsx`) — preserve as the deal slide-over and new-lead modal.
- `DetailPanel` (in `OperationsPage.tsx`) — preserve as the job slide-over.

The redesign will **reuse all of the above**; only the board *rendering* changes.
