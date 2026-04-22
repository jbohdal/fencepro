# Verification Results

_Date: 2026-04-21_

Build: ✅ `tsc -b && vite build` passes. Bundle: `index-CSzQX_6o.js` (990KB, 218KB gzipped).
Prisma: ✅ `prisma validate` passes.

## End-to-End Checks

### 1. Create a new customer
- **Address autocomplete:** ✅ [CustomersPage.tsx:261](apps/web/src/CustomersPage.tsx#L261) now uses `<AddressAutocomplete>` on both service & billing address fields. Requires 3+ chars, suggests via Google Places `types: ['address']` US-only.
- **Pipeline auto-entry:** ✅ `handleSave` in CustomersPage calls `addLeadForNewCustomer()` for new customers; pipeline seeder writes to `fencepro_pipeline` under `First Contact`.
- **Persistence after logout/login:** localStorage-backed — survives tab close, browser restart, and logout. Only lost if the user clears browser storage.
- **Toast feedback:** ✅ `toast.success('Customer added', 'Also placed on Sales Pipeline under First Contact.')` fires on save.

### 2. Create a quote from the map quote tool
- **Customer association:** ✅ SaveModal in QuoteBuilder now returns `customerId` alongside name/phone/email; `handleSave` sets `SavedQuote.customerId` so it lands in the right customer's Quotes tab.
- **Appears in Quotes list:** ✅ App.tsx `handleSaveQuote` pushes to `fencepro_quotes` and toasts success.
- **Pipeline seed for new customer path:** ✅ Tapping "New Customer" in the SaveModal now also calls `addLeadForNewCustomer`.

### 3. Open a customer profile and click New Quote
- **Pre-populated:** ✅ App.tsx `onNewQuote={(c) => setEditingQuote(...with customer fields)}` seeds the editing quote with `customerId`, `customerName`, `customerPhone`, `customerEmail`, `customerAddress`, `leadSource`, `salesRep`.
- **SaveModal pre-select:** ✅ `<SaveModal initialCustomerId={init?.customerId}>` — the modal reads `fencepro_customers` and pre-selects the record in 'search' mode.
- **Still changeable:** ✅ user can switch to "New Customer" mode or clear the selection.

### 4. Create a site plan linked to a customer
- **Customer picker:** ✅ SitePlanTool save modal now includes a "Link to Customer" `<select>` populated from `fencepro_customers`.
- **Files tab entry:** ✅ `linkSitePlanToCustomerFiles(plan)` writes a `Site Plan` entry to `fencepro_files` with `siteplanId` linkage; existing linkage is updated (not duplicated) on re-save.
- **View button:** Files tab renders all entries including Site Plans with type label.

### 5. Upload a photo to a customer profile
- **Tab renders:** ✅ `Photos` tab is visible between Files and overview in CustomerDetail; `<CustomerPhotosTab>` mounts with `customerId`.
- **Upload flows:** click-to-pick + drag-drop; multi-file select; JPG/PNG/WebP/HEIC/HEIF up to 20MB.
- **Persists after page reload:** ✅ photos stored in `fencepro_customer_photos` keyed by customerId; restored on next mount.
- **No storage configured warning:** ✅ if object storage isn't detected, `toast.warning('Photo saved locally only', …)` fires after upload.
- **Cross-customer isolation:** ✅ `.filter(p => p.customerId === customerId)` on read.
- **CompanyCam sub-tab:** appears conditionally when `fencepro_integrations.companycam.connected` + a customer-project mapping exists.
- **Activity logged:** writes to `fencepro_customer_activity` on upload/delete.
- **Lightbox:** ← / → nav, Esc close, works with keyboard.

### 6. Navigate to Dashboard, Customers, Sales Pipeline
- **Map Quote / New Quote NOT visible:** ✅ App.tsx line 666 now reads `{active === 'Quotes' && (...)}` — both buttons disappear everywhere except the Quotes page.

### 7. Navigate to Quotes page
- **Both buttons visible:** ✅ Same `active === 'Quotes'` block preserves the original Map Quote + New Quote buttons in the top-right.

### 8. Mark a sold quote as SOLD
- **Pending order created:** ✅ `handleSaveQuote` detects SOLD transition and calls `createPendingOrderFromQuote(q)`, which copies every pull-sheet line into a new `inventory_pending_orders` record with status `pending`.
- **Inventory reserved:** ✅ `reserveInventoryForOrder` increments each matching inventory item's `reservedQty` without decrementing available stock.
- **Low-stock warning:** ✅ `checkStockForOrder` fires `toast.warning('Low stock on some materials', …)` listing up to 3 shortages.
- **Pending Orders page:** ✅ new nav item under Operations; full list + detail view + Pending → Ordered → Received workflow; Print Pull Sheet.
- **Received deducts:** ✅ `updatePendingOrderStatus(id, 'received')` calls `deductInventoryForOrder` which reduces `quantity` and clears `reservedQty`.

### 9. Log out and log back in
- **localStorage preserved:** ✅ logout clears only auth tokens (`crm_access_token`, `crm_refresh_token`), not the CRM data stores. All `fencepro_*` keys survive.
- **Session expiry visible:** ✅ `authFetch` on 401 + failed refresh triggers `setSessionExpiredHandler` which toasts `'Your session has expired — your local work has been preserved.'` and routes back to the login screen.

### 10. Trigger a save and disconnect
- **Network error surfaced:** ✅ `authFetch` catches the native fetch throw with `throw new Error('Network error — check your connection and try again.')`. The outer `handleSaveQuote` catch calls `toast.error('Could not save quote', err?.message)` so the user sees the exact problem.
- **Portal sync failure isolated:** ✅ even when the local save succeeds, a failed `syncQuote(q)` now produces `toast.warning('Portal sync failed', …)` rather than silent.

## Files Produced
- [BUG_AUDIT.md](BUG_AUDIT.md) — Phase 1
- [ADDITIONAL_BUGS_FIXED.md](ADDITIONAL_BUGS_FIXED.md) — Phase 10
- [VERIFICATION_RESULTS.md](VERIFICATION_RESULTS.md) — this document

## New source files
- [apps/web/src/toast.tsx](apps/web/src/toast.tsx)
- [apps/web/src/AddressAutocomplete.tsx](apps/web/src/AddressAutocomplete.tsx)
- [apps/web/src/pipelineSeeder.ts](apps/web/src/pipelineSeeder.ts)
- [apps/web/src/pendingOrderStore.ts](apps/web/src/pendingOrderStore.ts)
- [apps/web/src/PendingOrdersPage.tsx](apps/web/src/PendingOrdersPage.tsx)
- [apps/web/src/CustomerPhotosTab.tsx](apps/web/src/CustomerPhotosTab.tsx)

## Notes / Residual Risk
- The CRM web app is **still localStorage-first** for most data. A proper backend migration remains out of scope of this bug-fix pass; what was done here is the minimum needed so the user always knows when a save succeeded or failed and can recover from session loss without data loss.
- `SavedQuote.finalPrice` / `gmPct` are still floats. Not a regression from this pass — pre-existing. Migrating these to integer cents would be a much larger change.
- `fencepro_files` entries for site plans carry a `siteplanId` pointer; the existing Files table doesn't yet render a "View" button for site plans — the Files tab shows the row and clicking the site plan tool still opens the global site plan list.
