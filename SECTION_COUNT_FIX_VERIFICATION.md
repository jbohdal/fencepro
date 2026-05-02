# Section-Count Fix — Verification

_Generated: 2026-05-01. Local code-level verification + deploy/browser checklist._

## Local results (verified by Claude)

### Typecheck
- `apps/web` — `tsc --noEmit -p tsconfig.app.json` → **clean** (exit 0, no output)
- `apps/portal` — `tsc --noEmit -p tsconfig.server.json` → **clean** (exit 0, no output)

### Tests
- `apps/portal/tests/sectionCount.test.ts` — **16 / 16 pass**, including the chappel-quote regression target (`[4, 104, 70, 94, 40, 22, 6]` → `[1, 18, 12, 16, 7, 4, 1]` summing to 59).
- Existing suites still pass: `automation.test.ts` (20), `auth.test.ts` (8). Total **62 / 62 pass**.

### Code-level verification
- Legacy buggy helper rewritten: [packages/shared/src/quoteEngine.ts:106-138](packages/shared/src/quoteEngine.ts#L106-L138). Now `calculateSectionCount(runs, panelLength)` returns `{ perRun, total }`. Old `calculateSections` kept as a thin wrapper that requires `panelLength`.
- Legacy caller updated: [packages/api/src/routes/quotes.ts:80-86](packages/api/src/routes/quotes.ts#L80-L86) now passes a derived `panelLength` (chainlink → 10, names containing `8'` → 8, else 6) so the legacy API is actually correct if it's ever wired up.
- Active CRM code path uses the new shared helpers:
  - [apps/web/src/sectionCount.ts](apps/web/src/sectionCount.ts) — single source of truth: `sectionsForRun`, `calculateSectionCount`, `calculateLinePostsPerRun`, `totalLinePosts`.
  - [apps/web/src/QuoteBuilder.tsx](apps/web/src/QuoteBuilder.tsx) imports `sectionsForRun` from this file (local copy removed).
  - [apps/web/src/bundleEngine.ts](apps/web/src/bundleEngine.ts) imports `sectionsForRun` (local copy removed).
  - [apps/web/src/materialCalculator.ts](apps/web/src/materialCalculator.ts) imports `sectionsForRun` + `calculateLinePostsPerRun` (local helpers refactored to call them).
- Active server code path uses the matching server-side helpers:
  - [apps/portal/src/server/lib/sectionCount.ts](apps/portal/src/server/lib/sectionCount.ts) — server mirror.
  - [apps/portal/src/server/lib/quoteEngine.ts](apps/portal/src/server/lib/quoteEngine.ts) imports `sharedSectionsForRun` + `sharedLinePostsPerRun` (local helpers refactored).

### UI changes
- Per-run label (right of each run input) at [QuoteBuilder.tsx:576-578](apps/web/src/QuoteBuilder.tsx#L576-L578): now shows `= N sec` in **orange** (`text-orange-500 font-medium`) instead of gray.
- Right-rail "Live Quote" summary at [QuoteBuilder.tsx:644-657](apps/web/src/QuoteBuilder.tsx#L644-L657): label changed from `Sections` to **Total Sections**, plus a new **Total Footage** line above Projected MH.

## Browser verification (you run this on systemssyndicate.com after deploy)

Deploy first, per the SETUP_GUIDE: rsync `apps/web` and `apps/portal`, build both, restart PM2.

### Test 1 — Chappel quote → 59 sections
1. Log in as a CRM user.
2. **Quotes** → **+ New Quote**.
3. Fence Style: **WV-ND 6'x6' Privacy**.
4. Add seven runs with lengths: `4, 104, 70, 94, 40, 22, 6`. Each line should immediately show its per-run section count in **orange** to the right (`= 1 sec`, `= 18 sec`, `= 12 sec`, `= 16 sec`, `= 7 sec`, `= 4 sec`, `= 1 sec`).
5. The right-rail "Live Quote" card shows **Total Sections: 59** and **Total Footage: 336 ft**.
   - If it shows 56 → the deploy is stale; rebuild + redeploy.

### Test 2 — Two-run regression target → 19 sections (not 18)
1. New quote, **WV-ND 6'x6' Privacy**.
2. Run 1: `100`, Run 2: `7`.
3. Expect per-run labels: `= 17 sec` and `= 2 sec`. Total Sections: **19**.

### Test 3 — Chainlink @ 10ft panel
1. Style: **CL - 6' Galv**.
2. Run 1: `104`. Per-run label: `= 11 sec`. Total Sections: 11.

### Test 4 — Exact-divide does not round up
1. Style: any 8'-wide vinyl (e.g. **WV-ND 8'x8'**).
2. Run 1: `64`. Per-run label: `= 8 sec`.

### Test 5 — Pull sheet line counts
- Same chappel quote as Test 1, leave defaults for corners (4) and ends (6).
- Open the Pull Sheet (toggle in the modal header).
- Confirm: `*Vinyl, White, Picket, 62-1/4"` qty = `(59 + walkGates + dblGates*2) × 11` (scales with sections, not footage).
- Confirm: `*Vinyl, White, Rail, 6'` qty = panel count × 2.
- These quantities are derived from the per-run section count — if total is wrong, every count in this section is wrong.

If any of the above fails, the deploy didn't pick up the bundle. Run:
```bash
cd /var/www/fencepro/repo/apps/web && pnpm vite build && rsync -a --delete dist/ /var/www/fencepro/web/dist/
pm2 restart fencepro
```
Hard-reload the browser (Cmd-Shift-R) to bust the SPA cache.
