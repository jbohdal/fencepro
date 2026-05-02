# Section-Count Fix — Audit

_Generated: 2026-05-01. Scope: every place in the codebase that converts a list of run footages into a section count._

## Summary

The active production code path is **already correct** — every quote-engine call site uses per-run `Math.ceil(footage / panelLength)` with style-specific panel widths, not `Math.ceil(totalFootage / panelLength)`. The bug described in the prompt exists in **one location only**: a legacy helper in `packages/shared` that powers an unused (legacy) Express server.

For the chappel runs `[4, 104, 70, 94, 40, 22, 6]` with vinyl 6'x6' panels (panel width 6), the active engine returns:

| Run | Footage | Per-run sections (correct) |
|---|---|---|
| 1 | 4 | `ceil(4/6) = 1` |
| 2 | 104 | `ceil(104/6) = 18` |
| 3 | 70 | `ceil(70/6) = 12` |
| 4 | 94 | `ceil(94/6) = 16` |
| 5 | 40 | `ceil(40/6) = 7` |
| 6 | 22 | `ceil(22/6) = 4` |
| 7 | 6 | `6/6 = 1` |
| | **Total** | **59** |

The wrong answer (`ceil(336/6) = 56`) is only what the legacy `calculateSections` would produce.

## Inventory of every section-count site

| # | File | Lines | Logic | Verdict |
|---|---|---|---|---|
| 1 | [packages/shared/src/quoteEngine.ts](packages/shared/src/quoteEngine.ts#L106-L109) | 106-109 | `Math.ceil(totalFt / 8)` — sums all runs first, hardcodes panel = 8 | ❌ **WRONG** — the bug |
| 2 | [packages/api/src/routes/quotes.ts](packages/api/src/routes/quotes.ts#L81) | 81 | calls `calculateSections(body.runLengths)` (#1) | ❌ Inherits the bug |
| 3 | [apps/web/src/QuoteBuilder.tsx](apps/web/src/QuoteBuilder.tsx#L61-L64) | 61-64, 391-394 | `sectionsForRun(ft, panelWidth)` per-run, then `runs.reduce(... + sectionsForRun)` | ✅ Correct |
| 4 | [apps/web/src/QuoteBuilder.tsx](apps/web/src/QuoteBuilder.tsx#L555) | 555 | per-run "X sec" label next to each run input — already shows individual section count in UI | ✅ Correct (gray text — UI improvement target) |
| 5 | [apps/web/src/bundleEngine.ts](apps/web/src/bundleEngine.ts#L30-L46) | 30-46 | `sectionsForRun(ft, panelWidth)` per-run | ✅ Correct |
| 6 | [apps/web/src/materialCalculator.ts](apps/web/src/materialCalculator.ts#L25-L50) | 25-50 | `sectionsPerRun(ft, style)` per-run with style-dispatched panel (6 / 8 / 10) | ✅ Correct |
| 7 | [apps/portal/src/server/lib/quoteEngine.ts](apps/portal/src/server/lib/quoteEngine.ts#L131-L149) | 131-149 | `sectionsPerRun(ft, style)` + `totalSections(runs, style)` + `linePostsPerRun` + `totalLinePosts` per-run | ✅ Correct |

**Coverage:** four implementations of the per-run logic (web/QuoteBuilder, web/bundleEngine, web/materialCalculator, portal-server/quoteEngine) plus the buggy legacy helper. None of the production-active logic divides total footage by a panel width.

## Premises in the original prompt that don't match this codebase

| Prompt claim | Reality |
|---|---|
| "Every quote in the system" has wrong section counts | Only the unused legacy `packages/api/` path is wrong |
| The "mobile quote builder" Step 3 shows X sec | There is no mobile app (`apps/mobile/` is empty); QuoteBuilder is a desktop modal at [apps/web/src/QuoteBuilder.tsx](apps/web/src/QuoteBuilder.tsx) |
| `estimate_runs` table with `section_count` column | No such table; quotes live in `localStorage.fencepro_quotes` (active) or `Quote.runLengths Json` (legacy schema, not running) |
| `/scripts/recalculate-section-counts.ts` migration | No `/scripts/` directory at repo root; only `apps/portal/scripts/` exists for backups |
| Live verification on systemssyndicate.com | Local Claude Code session can't load the droplet — verification has to run on the user's browser |

## Line-post calculation

Only the active-production servers and CRM mirror compute line posts; both already do it per run:

- [apps/web/src/materialCalculator.ts:43-50](apps/web/src/materialCalculator.ts#L43-L50) — `linePostsPerRun(ft, style) = max(0, sectionsPerRun(ft, style) - 1)`
- [apps/portal/src/server/lib/quoteEngine.ts:142-149](apps/portal/src/server/lib/quoteEngine.ts#L142-L149) — same pattern

The legacy `packages/shared/quoteEngine.ts` does not compute line posts at all (so the legacy path under-orders posts as well).

## Fix scope (what is changing in this pass)

1. **(a) Surgical:** rewrite [packages/shared/src/quoteEngine.ts:106-109](packages/shared/src/quoteEngine.ts#L106-L109) to do per-run with a configurable panel length, plus add a `calculateLinePostsPerRun` helper. Update the legacy [packages/api/src/routes/quotes.ts](packages/api/src/routes/quotes.ts) caller to pass a panel length derived from the fence-style category (legacy schema has no `panelWidth` column).
2. **(b) Defensive:** add a `apps/web/src/sectionCount.ts` shared helper consumed by `QuoteBuilder.tsx` / `bundleEngine.ts` / `materialCalculator.ts`, and a sister helper in `apps/portal/src/server/lib/sectionCount.ts` consumed by `quoteEngine.ts`. Replaces the four copies of the formula with one definition per runtime.
3. **(c) UI clarity:** at [QuoteBuilder.tsx:555](apps/web/src/QuoteBuilder.tsx#L555), change the per-run "X sec" label from `text-gray-400` to orange + medium weight; rename the right-rail "Sections" line at [QuoteBuilder.tsx:646-647](apps/web/src/QuoteBuilder.tsx#L646-L647) to "Total Sections".
4. **Tests:** add `apps/portal/tests/sectionCount.test.ts` exercising every test case in the original prompt (chappel quote → 59, exact-divide, non-divide, line-post per run, chainlink panel = 10, 8ft style panel = 8, zero footage). Tests run under existing vitest.

## Out of scope

- DB migration: there is no DB table to migrate. The legacy schema's `Quote.runLengths` is already JSON, and the active path uses `localStorage`.
- Recalculating existing saved quotes: the active `SavedQuote.sections` field is already computed correctly at save time. Old saved-on-localStorage quotes are correct because the QuoteBuilder per-run logic has been right since this code was written.
- Live-droplet verification: must be run by the user on systemssyndicate.com after deploy.
