# Bug Fix Audit

_Date: 2026-04-22_

## 1. Lead Form Address Autocomplete

**Where:** [JobsPage.tsx:241-248](apps/web/src/JobsPage.tsx#L241) — inside `QuickAddModal`:

```tsx
<label>Address</label>
<input className="..." value={address} onChange={e => setAddress(e.target.value)} />
```

**Why it doesn't suggest:** plain `<input>`. No Places autocomplete wired. `AddressAutocomplete.tsx` already exists in the codebase (and works on the customer form, QuoteBuilder SaveModal, Vendor form) — the lead form simply wasn't migrated.

**Fix:** swap the plain input for `<AddressAutocomplete>` in Phase 2.

## 2. Multiple Quotes per Customer

**Current save handler** (App.tsx `handleSaveQuote`):

```ts
const updated = prev.find(x => x.id === q.id)
  ? prev.map(x => x.id === q.id ? q : x)  // update
  : [q, ...prev]                           // insert
```

Save is already keyed on **quote id**, not customer id — so two quotes with different ids for the same customer do NOT collide. **The save handler itself is correct.**

**The actual bug** is in [App.tsx `onNewQuote` handler](apps/web/src/App.tsx) when clicked from a customer profile:

```ts
setEditingQuote({ id: '', customerId: c.id, ... } as SavedQuote)
```

When `editingQuote.id === ''`, `QuoteBuilder` sets `quoteIdRef.current = init?.id ?? uid()`. Because `init.id = ''` (a truthy string? no, empty string is falsy but `??` only trips on null/undefined) — actually `''` is falsy for `??`? No: `??` only checks null/undefined. So `init.id` (empty string) is kept, and the saved quote has `id: ''`. **Every subsequent "new quote" for the same customer overwrites the first because they all share id `''`.**

**Fix:** change `id: ''` to `id: undefined` in `App.tsx:onNewQuote`, OR change QuoteBuilder to explicitly treat empty string as missing. Done both for defense.

**Quotes tab display:** Already iterates `quotes.filter(q => q.customerId === selectedId)` and renders all rows. No "last only" bug — once the id-collision is fixed, all rows will display.

## 3. Operations Kanban Board

**Where:** [OperationsPage.tsx](apps/web/src/OperationsPage.tsx). 2300+ lines.

**What works:** board renders, columns render with the hardcoded `OPS_STAGES` array, clicking a card opens the slide-over, Advance→ button bumps a job to the next stage via `onMoveStage`.

**What's broken or missing:**
1. **No drag and drop.** Cards render with `onClick` only — no `draggable`, no `onDrop`.
2. **Cards don't show:** scheduled-date-missing badge, checklist progress, weather, rain delay, color-coded left border.
3. **Cards don't use the configurable Operations Stages** (added in the last pass) — they use a hardcoded array.
4. **"Columns with no jobs" rule:** currently hidden if stage is `paid` or `invoiced`. All other empty columns do render. Mostly correct.

**Why the user says "not functioning":** the drag-drop is missing entirely. Looks stuck because you can't move cards by drag — only the hover-visible "Advance →" link.

**Fix:** add drag-drop handlers; enrich cards; read stages from the configurable `opsStagesStore` so the Settings editor takes effect.

## 4. Job Checklists

**Where:** [OperationsPage.tsx:504-510](apps/web/src/OperationsPage.tsx#L504) — `Section title="Readiness"` with four `<CheckItem>` rows:

```tsx
<CheckItem label="Locates" done={!!job.locatesDate} ... />
<CheckItem label="Drawing" done={job.drawingComplete} />
<CheckItem label="Materials" done={...} />
<CheckItem label="Pull Sheet" done={job.rawJob?.pullSheetPulled || false} />
```

`CheckItem` is a **read-only display** — it's literally just a `<div>` with a colored dot. Clicking doesn't do anything; there's no `onToggle`, no state change, no persistence.

**No `job_checklist_items` table exists.** Checklist items are derived from scattered job fields (`locatesDate`, `drawingComplete`, `materialsStatus`, `pullSheetPulled`).

**Fix:** new client-side `checklistStore` with per-job checklist rows backed by localStorage; new Prisma `JobChecklistItem` model; functional checkboxes that persist; card mini-progress indicator.

## 5. Signed Contract → Operations: Only the First Job

**Trace:** JobsPage drop → `handleSignedContractIfNeeded` → `applySignedContractTransition` → `findActiveQuoteForCustomer(customerId)` → `markQuoteSold(quoteId)` → `createJobFromQuote`.

**`markQuoteSold` is idempotent per quote** via `getJobByQuoteId(quoteId)` — each quote has its own id, so three quotes → three separate `getJobByQuoteId` lookups, each returning null the first time, each creating a new job. **The code should work per quote.**

**Probable root causes of the user's observed bug:**

1. **Pipeline cards created by QuickAdd before the "leads = customers" pass didn't have `customerId`.** `applySignedContractTransition` calls `lead.customerId ? getCustomerById(lead.customerId) : null` — when `customerId` is missing, it returns `null` → no cascade. This pass fixed QuickAdd to populate `customerId`, but **existing old pipeline cards are still broken**.

2. **Stage-transition check**: the outer `if (prev.stage !== stage)` only runs the cascade when the stage changes. If the user drops the second card onto Signed Contract but the card was already at Signed Contract for some reason, the handler bails. Edge case, unlikely.

3. **Quote not linked to customer**: `findActiveQuoteForCustomer` filters by `q.customerId === customerId`. Quotes saved before the customerId wiring may lack it. Older quote → returns null → no job created.

**Fix:** (a) when a lead has no `customerId`, fall back to matching by phone/email/name; (b) when a customer has no quote with a matching customerId, fall back to matching by customer name; (c) add a prominent toast when cascade bails telling the user exactly why.

## 6. Job Complete → Sales Pipeline Reverse Flow

**No code exists for this.** Searching the codebase: no reference to "Job Complete" as a pipeline stage transition, no hook on the Ops board when a job hits the `completion` stage, no listener that touches `fencepro_pipeline`.

**Current state:** marking a job Complete updates `fencepro_jobs[].status = 'completed'`. Nothing else happens. The pipeline card stays at Signed Contract forever.

**Fix:** on ops stage change → if target is a completion stage, find the pipeline lead for that customer, move it to a "Job Complete" stage (auto-create if missing), fire automation, log activity.

Proceeding to fixes.
