# Site Plan, Map Quote & Inventory Audit

_Date: 2026-04-23_

## 1. Map Quote Tool

- **Component:** [MapQuoteBuilder.tsx](apps/web/src/MapQuoteBuilder.tsx)
- **Library:** Google Maps JS API via `@googlemaps/js-api-loader` ([mapsLoader.ts](apps/web/src/mapsLoader.ts)). Places library used for address autocomplete; Marker library for `AdvancedMarkerElement`; Geometry for distance calculations.
- **Address search + selection:** `AddressSearch` input wired to `google.maps.places.Autocomplete`. On `place_changed` it fires `onPlaceSelected({ address, location })`, which calls the parent's `handlePlaceSelected` — that updates `address` + `center` state. The map recenters to the new coords.
- **After selection — what is shown:** the address text lives only in the `address` state variable. **No persistent address bar, no map marker at the property** — the only UI feedback is the map recenter itself. The search input keeps whatever the autocomplete wrote into it until the user clears it.
- **Utility lines feature:** `MapQuoteBuilder` itself doesn't have utility lines — it only draws fence polylines. Utility-line drawing lives in [SitePlanTool.tsx](apps/web/src/SitePlanTool.tsx). There the "utility" draw mode ([line 89](apps/web/src/SitePlanTool.tsx#L89)) draws red dashed lines with a hardcoded stroke `#dc2626`. **No color selection per line** — every utility line is red.

**Gaps to fix in Phase 2:** (a) add a persistent property-info bar below the search with address + clear button; (b) drop an AdvancedMarker at the selected coordinates with a hover tooltip; (c) add a utility-line color palette so lines can be tagged by utility type.

## 2. Site Plan Drawing Tool

- **Component:** [SitePlanTool.tsx](apps/web/src/SitePlanTool.tsx) — 600+ lines.
- **Drawing capabilities:** fence line, walk gate, double gate, property line, utility line, tear-out zone, text label, arrow, select. Drawing is done via Google Maps polylines + `AdvancedMarkerElement`s; state is kept in `lines: DrawnLine[]` and `markers: DrawnMarker[]`.
- **Color options today:** **none surfaced to the user.** Each `DrawMode` has a hardcoded color in `MODE_CONFIG`. Each line type has a hardcoded `LINE_COLORS` entry. No palette UI, no per-element override, no color persistence.
- **Save:** `handleSave` builds a `SitePlan` object `{ id, name, address, coordinates, lines, markers, notes, createdAt, updatedAt, customerId, customerName }`, writes to `localStorage.fencepro_siteplans`, and (when linked) mirrors a row into `fencepro_files`. No thumbnail is generated; no server-side write.
- **Format:** JSON of the drawing data. `lines` hold arrays of `{ id, type, points: LatLng[], label? }` and `markers` hold `{ id, type, position, label, rotation? }`. No image is captured.

**Gaps to fix in Phase 3:** add `color` property to every `DrawnLine` and `DrawnMarker`, plumb it through the render path, add a persistent color palette UI, per-element edit toolbar on click, and a canvas thumbnail on save.

## 3. Site Plans Navigation & List

- **Sidebar item:** `Site Plans` (🗺) — [App.tsx:74](apps/web/src/App.tsx#L74).
- **What the page shows today:** a simple list of saved plans read from `localStorage.fencepro_siteplans`. Each card shows the plan name, address, and line/marker counts.
- **Click behavior:** **both the empty-state button AND clicking a card calls `setShowSitePlan(true)`** ([line 817](apps/web/src/App.tsx#L817)) — which always opens a fresh drawing tool, NOT the saved plan. **Saved plans are unreachable** without manual copy-paste of their data.
- **Drawing tool `onClose`** just closes the modal — it doesn't return the user to the updated list.

**Gaps to fix in Phase 6:** a proper grid with thumbnail, read-only view on click, Edit/Delete/Download/Link-to-Customer actions, and a create flow that prompts for a name.

## 4. Customer Profile Files Tab

- **Component:** inline in [CustomersPage.tsx](apps/web/src/CustomersPage.tsx) — `activeTab === 'files'`.
- **Today's list:** table with icon + filename + size + uploaded-at. No click handler on the row. Only a delete × button.
- **Clicking a file does nothing.**
- **Stored data:** file metadata only (`name`, `type`, `size`, `url?`, `uploadedAt`, `uploadedBy`). Site plans are mirrored here as `type: 'Site Plan'` with a `siteplanId` pointer but no viewer opens.

**Gaps to fix in Phase 4:** a file viewer modal — PDFs in `<iframe>`, images in a lightbox, site plans in a read-only version of the drawing tool, text/docs with a safe fallback. Add explicit View + Download buttons.

## 5. Pull Sheet Generation

- **Where generated:** inside `QuoteBuilder` (material calculator → `pullSheet: LineItem[]` on the `SavedQuote`).
- **Auto-generation on SOLD:** already partially wired via [App.tsx `handleSaveQuote`](apps/web/src/App.tsx) — when `status === 'SOLD'` and the quote has a `customerId`, `linkPullSheetToCustomer` writes a `CustomerPullSheet` to `fencepro_customer_pullsheets`. [signedContractFlow.markQuoteSold](apps/web/src/signedContractFlow.ts) also calls `createPendingOrderFromQuote` which seeds the pending-order store.
- **Gaps:** (a) no activity log entry on the customer; (b) no PDF file is written to `fencepro_files`; (c) the existing `CustomerPullSheet` rows live in a separate `fencepro_customer_pullsheets` store — the customer profile has a Pull Sheets sub-tab but file-tab download/print is missing.

**Gap to fix in Phase 5:** formalize into a single `generatePullSheetOnSold(quote)` helper that (a) creates/updates the `CustomerPullSheet` row, (b) logs activity, (c) creates a matching sales order with stock sufficiency analysis, (d) shows a warning toast if any item is short.

## 6. Inventory Sales Order System

- **Current state:** there is a `pendingOrderStore` + standalone `PendingOrdersPage` accessible as **Pending Orders** in the Operations sidebar group. Data shape: `PendingOrder { id, quoteId, customerId, customerName, status: 'pending'|'ordered'|'received'|'cancelled', totalCostCents, items: PendingOrderItem[], notes }`.
- **Sufficiency indicator:** `checkStockForOrder(order)` computes short items; used by the SOLD-quote toast. Not surfaced on the page itself.
- **Tables:** Prisma has `InventoryPendingOrder` + `InventoryPendingOrderItem` + `PendingOrderStatus` enum. No separate "sales_orders" concept.

**Gaps to fix in Phase 7:** (a) rename-in-place the Pending Orders concept so the CRM language reads "Sales Orders" (adding `quantityOnHandAtTimeOfOrder` + `isSufficientStock` fields); (b) move it into the Inventory page as a tab instead of a top-level nav item; (c) add Items / Sales Orders / Operations tabs to the Inventory page.

## 7. Inventory ↔ Operations Connection Today

- The `pendingOrderStore` writes a `reservedQty` field to `fencepro_inventory` items when a sales/pending order is created. On `received`, it decrements `quantity` and clears `reservedQty` ([pendingOrderStore.ts](apps/web/src/pendingOrderStore.ts)).
- The `OperationsPage` kanban does not read from the pending-order store today. The only connection is the shared inventory row mutations.

**Gaps:** Operations cards should surface "materials not yet ordered" state per job. Out of scope for this pass but worth flagging — phase 7 puts sales orders where an ops manager can act on them.

---

## Summary of Phase-by-Phase Fix Plan

| Phase | Action |
|---|---|
| 2 | Add `<PropertyInfoBar>` + map marker in `MapQuoteBuilder`; add utility-line color palette in `SitePlanTool` |
| 3 | Add `color` to every drawn element + global color palette + per-element edit popover |
| 4 | Build `FileViewerModal` (PDF/image/site-plan/text); wire clicks in Files tab |
| 5 | Formalize `generatePullSheetOnSold` + matching sales order, activity log, warning toast |
| 6 | Redesign Site Plans page with thumbnails, read-only viewer, Edit/Download/Delete/Link actions |
| 7 | Add Inventory sub-tabs (Items, Sales Orders, Operations); remove standalone Pending Orders nav |
| 8 | Run E2E and write verification |
