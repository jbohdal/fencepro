# Rail Optimization — Audit

_Generated: 2026-05-01. Scope: ground-truth on the four white-vinyl fence styles, vinyl rail / picket / u-trim / stiffener inventory, and the per-style sections-per-man-hour values that the smart-rail optimizer depends on._

## TL;DR

- **WV-ND vs WV-DS are already separate styles** in the active codebase (`apps/web/src/configStore.ts` + `apps/web/src/materialCalculator.ts` branches). No "split" work is needed — Phase 2's premise is already satisfied for ND vs DS.
- **6'x6' vs 6'x8' are also already separate styles** today (ids 1, 2, 6, 7). The fence-style picker shows them as four distinct choices in the Vinyl Privacy group. The optimizer the prompt describes would replace this with two top-level choices (ND, DS) and let the engine pick width per run — this is a behavior change to the picker, not a DB structure change.
- **Several numeric premises in the prompt don't match the spreadsheet-grounded code**: default vinyl margin is 0.64 (not 0.61); 6x6 picket count is 11/section (not 10); 6x8 picket count is 15/section (not 13); 6'-rail and 8'-rail use the same `*Vinyl, White, U-Trim, 59-1/4"` item — only the quantity differs.
- **The metal stiffener already exists**: `Vinyl, Rail Insert, 8'` @ $8.00, used 1-per-section on 6'x8' panels today (`materialCalculator.ts:160` for ND, `:222` for tan, `:271` for DS). Not currently shown on 6'x6' panels — correct by design.
- **There is no `fence_styles` DB table in the active schema.** Active styles live in `localStorage.fencepro_config` (CRM) and a hardcoded `FENCE_STYLES` array in `apps/portal/src/server/lib/quoteEngine.ts:75-101` (server). The legacy `prisma/schema.prisma` (root) has a `FenceStyle` model — used only by `packages/api/`, which is not running. So all "DB update" steps reduce to updating two arrays + the localStorage default.

## 1. How the four white-vinyl styles are stored today

Source of truth: [apps/web/src/configStore.ts:50-77](apps/web/src/configStore.ts#L50-L77). All four are already distinct entries with explicit panel widths.

| id | name | category | margin | sectionsPerMH | panelWidth | mhPerWalkGate | mhPerDblGate | isActive |
|---|---|---|---|---|---|---|---|---|
| 1 | `WV-ND 6'x6' Privacy` | Vinyl | 0.64 | **1.2** | 6 | 2.4 | 4.8 | true |
| 2 | `WV-ND 6'x8' Privacy` | Vinyl | 0.64 | **1.2** | 6 | 2.4 | 4.8 | true |
| 6 | `WV-DS 6'x6' Privacy` | Vinyl | 0.64 | **0.8** | 6 | 2.4 | 4.8 | true |
| 7 | `WV-DS 6'x8' Privacy` | Vinyl | 0.64 | **0.8** | 6 | 2.4 | 4.8 | true |

Notes:
- The `panelWidth: 6` on id 2 (`WV-ND 6'x8'`) is **deliberate** — the panel display width is 6 ft for purposes of the picker; the runtime material calculator dispatches by `is6x8(name)` to use 8 ft of rail per panel and 15 pickets. This is a slight modeling quirk: `panelWidth` in `configStore.ts` describes how the picker labels the style, while `materialCalculator.ts`'s string-name dispatch is the authoritative source of "rails are 6' or 8' for this style". The optimizer will need to use the **rail length** (6 or 8), not the `panelWidth` field on the style.
- Both ND styles share `sectionsPerMH = 1.2`; both DS styles share `0.8`. This confirms the prompt's productivity argument: an 8'-rail section is the same labor as a 6'-rail section, so longer rails on long runs = fewer total sections = fewer man-hours.
- `margin = 0.64` is the **magic number** (1 - overhead% - profit%), not the gross-margin target. Price = `COGS / margin`. The 0.61 default the prompt mentions is not present in this codebase.
- Server-side mirror: [apps/portal/src/server/lib/quoteEngine.ts:76-101](apps/portal/src/server/lib/quoteEngine.ts#L76-L101) duplicates this list. Both must move together.

## 2. Vinyl rail / picket / u-trim / stiffener inventory

Authoritative source for unit costs and per-section quantities: [apps/web/src/materialCalculator.ts](apps/web/src/materialCalculator.ts) (locked to the EZ-Quote spreadsheet). Inventory catalog mirror: [apps/web/src/inventoryStore.ts](apps/web/src/inventoryStore.ts).

### White Vinyl ND — 6'x6' (per panel)

| Item | Qty/section | Unit cost | Source |
|---|---|---|---|
| `*Vinyl, White, Rail, 6'` | 2 | $5.98 | materialCalculator.ts:153 |
| `*Vinyl, White, U-Trim, 59-1/4"` | 2 | $1.62 | materialCalculator.ts:154 |
| `*Vinyl, White, Picket, 62-1/4"` | **11** | $2.71 | materialCalculator.ts:152 |
| `*Vinyl, White, Cap, 5"x5"` | (per post) | $1.00 | — |
| `*Vinyl, Truss, 8 x 3/4"` | 6 | $0.03 | materialCalculator.ts:168 |

### White Vinyl ND — 6'x8' (per panel)

| Item | Qty/section | Unit cost | Source |
|---|---|---|---|
| `*Vinyl, White, Rail, 8'` | 2 | $9.26 | materialCalculator.ts:158 |
| `*Vinyl, White, U-Trim, 59-1/4"` | 2 | $1.62 | materialCalculator.ts:159 (same U-Trim item as 6x6, different qty calculation) |
| `*Vinyl, White, Picket, 62-1/4"` | **15** | $2.71 | materialCalculator.ts:157 |
| `Vinyl, Rail Insert, 8'` (metal stiffener) | **1** | $8.00 | materialCalculator.ts:160 |

### White Vinyl DS — 6'x6' (per panel)

Identical panel goods to ND 6'x6'. Differences are only on the post / setting side: DS uses 102" posts ($13.64 corner/end, $17.49 line) vs ND's 78" posts + steel pipe + donuts. DS adds concrete bags. Source: materialCalculator.ts:251-296.

### White Vinyl DS — 6'x8' (per panel)

Identical panel goods to ND 6'x8' (incl. `Vinyl, Rail Insert, 8'` stiffener). Same post / concrete differences as DS 6'x6'.

### Differences between ND and DS (post / setting)

| Component | ND | DS |
|---|---|---|
| Post height | 78" | 102" |
| Cost per post | $11.17 | $13.64 (corner/end), $17.49 (line) |
| `ND, Donut` @ $3.19 | 2 per non-blank post | (none) |
| `Pipe, PT40, Galv, 2-1/2" x 8'` @ $19.50 | 1 per non-blank post | (none) |
| `Misc, Concrete` @ $6.25 | 1 per double gate | 1 per (corner + end + line + blank + 2× double gate) |

Source: materialCalculator.ts:131-296. The optimizer's per-run decision does **not** affect this — post / setting components are computed from total post counts after all runs are aggregated.

## 3. The metal stiffener

- **Inventory item name:** `Vinyl, Rail Insert, 8'`
- **Unit cost:** `$8.00`
- **Quantity rule:** 1 per panel for **6'x8' vinyl panels only** (both ND and DS). Not used on 6'x6' panels.
- **Source:** materialCalculator.ts:160 (white ND), :222 (tan ND, with trailing space in name: `'Vinyl, Rail Insert, 8\\' '`), :271 (white DS, with trailing space).
- **Already appears in current quotes** for any WV-ND-6x8 or WV-DS-6x8 quote; quantity = sections + walkGates (DS) or sections (ND). The prompt's plan to add this 1-per-8'-section is consistent with current behavior — the optimizer just needs to make the 1-per-8'-section count match the per-run mix.

## 4. The current fence-style selector

- Component: [apps/web/src/QuoteBuilder.tsx:520-536](apps/web/src/QuoteBuilder.tsx#L520-L536). A native `<select>` with `<optgroup>` per category.
- Vinyl group today shows **13** options (ids 1-13): all combinations of ND/DS × white/tan × 6x6/6x8 plus the Bell.
- The four white-vinyl options are shown as four distinct lines in the dropdown:
  ```
  WV-ND 6'x6' Privacy
  WV-ND 6'x8' Privacy
  WV-DS 6'x6' Privacy
  WV-DS 6'x8' Privacy
  ```
- This is **not** a "tappable button" UI per the prompt's mobile/wizard description — it's a desktop modal `<select>`. There is no mobile app.

## 5. sectionsPerMH for 6x6 vs 6x8

- WV-ND 6x6: **1.2**
- WV-ND 6x8: **1.2** (same — confirms the productivity argument)
- WV-DS 6x6: **0.8**
- WV-DS 6x8: **0.8** (same)

So one 8'-section IS the same labor as one 6'-section within an installation method, which is exactly what the optimizer needs. The labor benefit of 8'-sections comes from needing fewer sections per linear foot.

## Premises in the prompt that don't match reality

| Prompt claim | Reality |
|---|---|
| "fence_styles table needs records added" | No active `fence_styles` table; styles live in `localStorage.fencepro_config` + a hardcoded array in `apps/portal/src/server/lib/quoteEngine.ts:75-101`. |
| "ND and DS are currently combined into one option" | They have always been four separate options (ids 1, 2, 6, 7). |
| "Default margin 0.61" | Actual default is 0.64 across all vinyl. The 0.64 number is the magic number (price = COGS / margin), not gross margin. |
| "Pickets × 10 for 6x6, × 13 for 6x8" | Actual values (verified against the EZ-Quote spreadsheet PDFs) are 11 for 6x6 and 15 for 6x8. Tan 6x8 is 16. |
| "8ft u-trim is a different item from 6ft u-trim" | Same item: `*Vinyl, White, U-Trim, 59-1/4"`. Quantity differs but the SKU is shared. |
| "Mobile quote builder Step 3 of 5" | No mobile app exists; QuoteBuilder is a single-screen desktop modal with no wizard/steps. |
| "Save run-level overrides with the quote" | `SavedQuote.runs` is `number[]` today. Adding per-run override fields is a non-trivial schema change to the localStorage shape. |
| "Verify in the live running application" | I cannot reach systemssyndicate.com from this Claude Code session. Verification has to run in the user's browser. |

## Architectural reality of the proposed feature

The prompt asks for: estimator picks "ND" or "DS" (without picking width), optimizer mixes 6'-rail and 8'-rail panels **per run within one job**.

Today's design is: estimator picks one of 4 styles (e.g. `WV-ND 6'x6'`), all panels are that one width. The materialCalculator dispatches off the style **name string** to compute material lists.

To deliver per-run mixed-rail-width within one fence style, three real changes are required:

1. **Calculator refactor.** [materialCalculator.ts](apps/web/src/materialCalculator.ts) currently runs once per quote and emits aggregate quantities. To mix rails per run, the calculator must either:
   - **(a)** be reworked to accept per-run panel-width metadata and emit per-run subtotals that get summed; or
   - **(b)** be split into two passes (run all 6'-rail runs as one virtual job, all 8'-rail runs as another, then merge line items, deduplicating shared SKUs and post counts).

   Option (a) is correct but touches every per-style branch (~500 lines). Option (b) is a smaller change but produces double-counted post hardware unless careful merging is done. Either is a multi-hour, multi-test rewrite.

2. **Saved-quote shape extension.** `SavedQuote.runs` becomes either:
   - `Array<{ ft: number; railOverride?: '6ft' | '8ft'; resolvedRail?: '6ft' | '8ft' }>`
   - or two parallel arrays: `runs: number[]` + `runRailOverrides: Array<'auto' | '6ft' | '8ft'>`.

   localStorage migration is needed for existing saved quotes.

3. **Style picker behavior change.** Replace the four-line vinyl block with two umbrella choices (`White Vinyl — No-Dig (auto rails)`, `White Vinyl — Dig and Set (auto rails)`) + keep the four explicit choices for users who want to lock the width. Or hide the explicit-width choices behind an "Advanced" toggle.

## Scope I'm landing in this pass

Given the size of the calculator refactor and the structural changes needed, I'm splitting the optimizer into two milestones:

- **Milestone A (this pass):** Self-contained `railOptimizer.ts` module that, given a list of run footages and a vinyl style category (ND/DS), returns the per-run rail-width recommendation, the savings vs all-6', and the productivity gain. Settings keys for the cutoff + cost-preference threshold. Vitest tests covering every prompt scenario. **Recommendation panel** in the QuoteBuilder that shows the optimizer's output as guidance — does **not** yet drive the actual material list. Estimator can read the recommendation and pick the matching explicit style today. This ships safely.
- **Milestone B (separate pass — flagged for follow-up):** Calculator refactor to consume per-run panel widths, picker change (two umbrella choices), saved-quote shape change + migration. This is the multi-hour rewrite that needs its own focused session with the full per-style branch test coverage.

Milestone A delivers immediate value: the estimator sees "for run 2 (104 ft) prefer 8' rails — saves $X vs 6' rails" and can act on it by selecting WV-ND 6'x8' for the relevant runs in a custom multi-quote workflow. Milestone B fully automates the mix.

The unit tests in this pass exercise the optimizer math, not the calculator integration, since the calculator integration is Milestone B.
