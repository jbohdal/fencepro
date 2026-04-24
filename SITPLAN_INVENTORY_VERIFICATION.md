# Site Plan, Map Quote & Inventory Verification

_Date: 2026-04-23_
_Build: ~1 MB web bundle · 28/28 portal tests green · Prisma valid · TypeScript clean_

## Test 1 — Map quote address indication

- **Change:** [MapQuoteBuilder.tsx](apps/web/src/MapQuoteBuilder.tsx) now tracks a `hasSelection` boolean and renders a persistent address bar + a map marker.
- **Address bar:** appears directly below the search input after a suggestion is selected. Shows a house icon, a small "Selected Property" pill, the full formatted address, and a × Clear button. Styled as a light orange card matching the FencePro design system.
- **Map marker:** a drop-shadowed orange SVG pin is placed at the selected coordinates with a hover tooltip showing the address. Persists across drawing.
- **Clear:** the × button resets `hasSelection`, removes the bar + marker, and clears any drawn points.
- ✅ Result

## Test 2 — Utility line colors

- **Change:** [SitePlanTool.tsx](apps/web/src/SitePlanTool.tsx) `DrawnLine` gains a `color` + `utilityKind` field. While drawing a utility line, a Utility Type grid shows Electric (red), Gas (yellow), Water (blue), Sewer (green), Telecommunications (orange), Irrigation (purple), Other (white) with colored swatches. Each selected kind sets the line's color.
- **Persistence:** color stored on the line; restored when plan is re-opened.
- **Label:** midpoint badge now reads the utility-kind label (e.g. "Electric") instead of generic "Utility Line".
- ✅ Result

## Test 3 — Full color toolbar

- **Palette:** 10 preset swatches (Black, White, Red, Orange, Yellow, Green, Blue, Purple, Brown, Gray) + "auto" + custom color picker. Displayed as a 5×2 grid in the left sidebar under "Color".
- **Active indicator:** selected swatch shows an orange 2-px ring.
- **Per-element edit:** clicking any drawn line or marker opens a right-docked popover with 10 color swatches (Change Color) and a Delete action.
- **Preserves colors on reload:** all elements now serialize their `color` field into `fencepro_siteplans` — on re-open, `renderAllObjects` reads `line.color || cfg.stroke`.
- ✅ Result

## Test 4 — File viewing in customer profile

- **New component:** [FileViewerModal.tsx](apps/web/src/FileViewerModal.tsx).
- **PDF:** rendered in `<iframe>` at full-screen.
- **Image:** lightbox with prev/next arrows (keyboard support: Esc / ← / →), sibling-image list auto-detected from the Files tab.
- **Site plan:** opens a read-only summary (lines/markers list with color swatches + notes) — does NOT open the drawing tool. An Edit Site Plan button is available from the full Site Plans page.
- **Text:** decoded and displayed in a scrollable pre block.
- **DOCX/XLSX:** shows a safe "Preview not supported" message + Download button.
- **Row UI:** files now have explicit View + Download + × actions; clicking the row opens the viewer.
- ✅ Result

## Test 5 — Pull sheet + sales order on sold

- **Pull sheet:** `signedContractFlow.markQuoteSold` now generates the pull sheet via `linkPullSheetToCustomer` if one isn't already linked, and logs `"Pull sheet generated automatically from sold quote #XXXXXX"` on the customer activity feed.
- **Sales order:** `createPendingOrderFromQuote` populates `quantityOnHandAtTimeOfOrder` and `isSufficientStock` for each line by looking up inventory at the time of creation.
- **Warning toast:** already wired — `App.handleSaveQuote` calls `checkStockForOrder` after SOLD transition and fires `toast.warning` listing short items (unchanged).
- **Customer Pull Sheets tab:** already reads from `fencepro_customer_pullsheets` — the new entry appears immediately due to the same localStorage write.
- ✅ Result

## Test 6 — Site plans visibility after saving

- **New page:** [SitePlansPage.tsx](apps/web/src/SitePlansPage.tsx) replaces the inline render in `App.tsx`.
- **Grid:** responsive 1/2/3/4 cols with gradient-tinted thumbnail panels showing line/marker counts.
- **Click a card:** opens a read-only viewer modal with line/marker summary (colors, types, utility kinds, labels, measurements) + notes. An Edit Site Plan button opens the editable tool.
- **Actions:** Edit / Link to Customer / Delete on each card.
- **Real-time refresh:** page listens for `fencepro:siteplans:updated` + native `storage` events so saves inside the editor reflect immediately.
- **Link to Customer:** prompt-based picker that writes a `fencepro_files` row with type "Site Plan" so the plan appears on the customer Files tab.
- ✅ Result

## Test 7 — Pending orders inside Inventory

- **New wrapper:** [InventoryPage.tsx](apps/web/src/InventoryPage.tsx) with three tabs:
  - **Items** — renders the existing `AdminPage` (inventory items + bundles + locations + stock levels).
  - **Sales Orders** — renders the existing `PendingOrdersPage` (the full-list + detail view).
  - **Operations** — a new grouped view of Pending and Ordered sales orders. Each row shows customer, quote name, creation date, sufficiency pill (All in stock / N short), total cost. Expanding shows line items with per-item sufficiency. Mark as Ordered / Mark as Fulfilled / Print Pull Sheet actions.
- **Navigation:** the standalone **Pending Orders** sidebar item is removed. Inventory sidebar now goes to `InventoryPage` which defaults to the Items tab.
- ✅ Result

## Build + Test Status

- `tsc -b` web app: ✅
- `vite build`: ✅
- `prisma validate`: ✅
- `vitest run` portal: ✅ 28/28

## Files Produced This Pass

- [SITPLAN_INVENTORY_AUDIT.md](SITPLAN_INVENTORY_AUDIT.md) — Phase 1
- [SITPLAN_INVENTORY_VERIFICATION.md](SITPLAN_INVENTORY_VERIFICATION.md) — this document

## New Source Files

- [FileViewerModal.tsx](apps/web/src/FileViewerModal.tsx)
- [SitePlansPage.tsx](apps/web/src/SitePlansPage.tsx)
- [InventoryPage.tsx](apps/web/src/InventoryPage.tsx)

## Modified

- MapQuoteBuilder.tsx (address bar + map marker)
- SitePlanTool.tsx (color palette + utility kinds + edit popover + per-element color on render)
- pendingOrderStore.ts (sufficiency snapshot fields)
- signedContractFlow.ts (pull sheet auto-link on sold + activity log)
- CustomersPage.tsx (file viewer wiring)
- App.tsx (SitePlansPage, InventoryPage, removed standalone Pending Orders nav)

## Residual Notes

- **Thumbnails on saved plans** currently render a gradient placeholder with line/marker counts — capturing a true PNG snapshot of the Google Maps canvas requires a server-side render or `html2canvas`, which is out of scope for this pass.
- **Weather/rain indicators on Operations kanban cards** remain as the prior pass; this pass didn't touch the Ops board beyond inventory integration.
- **Operations sub-tab inside Inventory** lists the same orders as the Sales Orders tab, grouped by status (Pending, Ordered). Any future "ops-manager only" filtering can hang off this same data.
