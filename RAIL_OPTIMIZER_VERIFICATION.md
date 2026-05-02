# Rail Optimizer — Verification

_Generated: 2026-05-01. Milestone A (recommendation engine + UI panel + settings). Milestone B (calculator integration) is deferred to a separate session — see [RAIL_OPTIMIZATION_AUDIT.md](RAIL_OPTIMIZATION_AUDIT.md) §"Scope I'm landing in this pass"._

## What shipped in this pass

### Code
- [apps/web/src/railOptimizer.ts](apps/web/src/railOptimizer.ts) — pure decision module. `optimizeRun(input)` returns the per-run recommendation; `optimizeJob(input)` aggregates. Pre-baked white-vinyl 6x6 / 6x8 cost constants (`WHITE_VINYL_6X6_COSTS`, `WHITE_VINYL_6X8_COSTS`).
- [apps/portal/src/server/lib/railOptimizer.ts](apps/portal/src/server/lib/railOptimizer.ts) — identical mirror so vitest can exercise the math.
- [apps/web/src/configStore.ts](apps/web/src/configStore.ts) — new `RailOptimizerConfig` interface and `getRailOptimizerConfig()` helper. Defaults: `enabled: true`, `shortRunCutoffFt: 6`, `costPreferenceThreshold: 0.02`, `showDetailsInBuilder: true`, `allowOverrides: true`.
- [apps/web/src/AdminSettingsPage.tsx](apps/web/src/AdminSettingsPage.tsx) — new **Quote Optimizer** tab (between Fence Styles and Lead Sources) with toggle + cutoff + threshold + UI prefs.
- [apps/web/src/QuoteBuilder.tsx](apps/web/src/QuoteBuilder.tsx) — new orange recommendation panel below the runs list, visible whenever a white-vinyl style is selected. Each run gets a 6ft / 8ft pill, section count, and a plain-English reason. Footer shows mix, material savings vs all-6ft, and sections-saved (productivity).

### Tests (vitest, all passing)
- [apps/portal/tests/railOptimizer.test.ts](apps/portal/tests/railOptimizer.test.ts) — **18 tests** covering unit-cost math, short-run cutoff, override behavior, disabled state, cost-preference threshold, whole-job aggregation, and the chappel-quote scenario.
- Combined suite: **62 / 62 passing** (16 sectionCount + 18 railOptimizer + 20 automation + 8 auth).
- Typecheck: web + portal both clean.

### What is NOT shipped (Milestone B — deferred)
- The recommendation does **not** drive the actual material list yet. The pull sheet still uses the single fence-style the estimator picked. Rewriting [materialCalculator.ts](apps/web/src/materialCalculator.ts) to accept per-run mixed rail widths is a multi-hour refactor across all per-style branches and needs its own focused session with full test coverage of every style.
- No saved-quote shape change for per-run override persistence.
- No "umbrella ND / DS" style choices that hide the explicit-width entries — the four explicit styles still appear in the picker today. Estimators can use the optimizer's recommendation to choose `WV-ND 6'x6'` vs `WV-ND 6'x8'` manually for now.
- Pull-sheet "Run Breakdown" (per-run material listing) — deferred.

## Browser verification (you run this on systemssyndicate.com after deploy)

### Test 1 — Settings tab is reachable
1. Settings → see new tab **Quote Optimizer** (4th tab, between Fence Styles and Lead Sources).
2. Confirm three numeric / toggle controls: Enable smart rail optimization, Short-run cutoff (default 6), Cost preference threshold (default 2%).
3. Confirm two more toggles: Show optimization details in quote builder, Allow estimator overrides.
4. Change Short-run cutoff to `8`, Save. Reload. Cutoff should still be 8 (persisted to localStorage).
5. Reset back to 6 and save.

### Test 2 — Recommendation appears for vinyl jobs
1. **Quotes** → **+ New Quote**.
2. Fence Style: **WV-ND 6'x6' Privacy**.
3. Add a 100 ft run. Expect: orange "Smart Rail Recommendation" panel appears below the runs list.
4. The single row reads `Run 1 · 100 ft · [pill: 6ft rails or 8ft rails] · N sections · <reason>`.
5. The mix footer reads e.g. `1 × 6ft / 0 × 8ft` or `0 × 6ft / 1 × 8ft`, with the corresponding sections-saved count.

### Test 3 — Short run forced to 6ft
1. Same quote, add a Run 2 of 4 ft.
2. Expect: Run 2 shows `6ft rails`, reason `Short run (≤ 6ft) — 6ft rails`.

### Test 4 — Settings flow through to the builder
1. Settings → Quote Optimizer → Short-run cutoff: `8`. Save.
2. Back to the open quote (or a new one). Run with 7 ft.
3. Expect: 7 ft run is now forced 6ft with reason `Short run (≤ 8ft) — 6ft rails`. Set cutoff back to 6 and confirm 7 ft goes back through the cost compare.

### Test 5 — Disable hides the panel
1. Settings → Quote Optimizer → toggle **Enable smart rail optimization** off. Save.
2. Open a vinyl quote. Recommendation panel should not appear.
3. Re-enable.

### Test 6 — Non-vinyl styles don't show the panel
1. Pick a chainlink style (e.g. **CL - 6' Galv**). Add any run.
2. Recommendation panel should not appear (chainlink uses fixed 10ft panels — no 6 vs 8 decision to make).

### Test 7 — Pull sheet is unchanged
1. With a vinyl quote and runs entered, open the Pull Sheet (toggle in the modal header).
2. Confirm the pull-sheet quantities are derived from the **selected style only** (e.g. `WV-ND 6'x6' Privacy`), not from the optimizer's per-run mix. The recommendation panel above the runs is advisory; the pull sheet has not been re-wired to consume it. This is the Milestone-B deliverable.

## Deploy notes

The CRM build is what changed (`apps/web`). The portal server has new file `lib/railOptimizer.ts` but no server-side route consumes it yet, so a server rebuild is recommended but not strictly required for Milestone A.

```bash
# Local
rsync -az --exclude node_modules --exclude dist apps/web/    root@<droplet>:/var/www/fencepro/repo/apps/web/
rsync -az --exclude node_modules --exclude dist apps/portal/ root@<droplet>:/var/www/fencepro/repo/apps/portal/

# On the droplet
ssh root@<droplet>
cd /var/www/fencepro/repo/apps/web && pnpm vite build && rsync -a --delete dist/ /var/www/fencepro/web/dist/
cd /var/www/fencepro/repo/apps/portal && pnpm tsc -p tsconfig.server.json && rsync -a --delete dist/ /var/www/fencepro/portal/dist/
pm2 restart fencepro
curl -s https://systemssyndicate.com/api/health | jq .status
```

Hard-reload the CRM in your browser (Cmd-Shift-R) to bust the SPA cache.
