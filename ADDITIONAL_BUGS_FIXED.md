# Additional Bugs Fixed During Audit

_Date: 2026-04-21_

Bugs discovered during the audit + fixing pass beyond the explicitly listed issues.

- **Silent `portalSync.syncQuote` failure** — `App.tsx` swallowed errors. Now shows `toast.warning('Portal sync failed', …)` so the user knows to retry.
- **Save button returned to neutral state without feedback** — `handleSaveQuote` and `CustomersPage.handleSave` now wrap in try/catch + `toast.success` / `toast.error`.
- **Session expiration caused silent save failures** — `authFetch` now calls a global `setSessionExpiredHandler` on 401 + refresh failure; AuthGate registers a handler that clears the user and shows `toast.warning('Your session has expired')`.
- **`TypeError: fetch failed` on network loss** — `authFetch` now catches the native fetch throw and re-throws a friendlier `'Network error — check your connection and try again.'`.
- **JSON parse failure on non-JSON responses** — `authFetch` now catches `res.json()` errors and throws `'Server returned non-JSON (status N)'`.
- **Map quote + New Customer flow lost `customerId`** — `SavedQuote.customerId` is now populated on every save (existing customer selected, or new customer created).
- **New customer from QuoteBuilder SaveModal didn't land on pipeline** — now calls `addLeadForNewCustomer` so they appear on Sales Pipeline under First Contact.
- **CSV bulk import didn't seed pipeline** — each imported customer is now added to `fencepro_pipeline`.
- **`customerQuotes` / `customerJobs` in CustomersPage filtered `SAMPLE_QUOTES` / `SAMPLE_JOBS`, not real saved data** — both now hydrate from `fencepro_quotes` / `fencepro_jobs` first, falling back to samples only when localStorage is empty.
- **Site plan saved without customer linkage** — `SitePlan` now has `customerId` + `customerName`; save modal includes a customer picker; `linkSitePlanToCustomerFiles` writes a `Site Plan` row to `fencepro_files` on save.
- **Editing an existing site plan created a duplicate** — introduced `editingPlanId` so an already-loaded plan is updated in place, not cloned.
- **`Map Quote` / `New Quote` buttons visible on Dashboard, Customers, Pipeline** — global header condition narrowed to `active === 'Quotes'` only.
- **Inventory was decremented at quote-save time (wrong timing)** — materials are now only reserved when a quote is marked SOLD (via `createPendingOrderFromQuote` → `reserveInventoryForOrder`), and formally deducted only when the pending order hits `received`.
- **No low-stock warning on SOLD transition** — `checkStockForOrder` surfaces a `toast.warning` listing items that are short.
- **Photos had no home** — added a Photos tab on the customer profile with drag-drop upload, HEIC/WebP support, 20MB limit, lightbox viewer, CompanyCam sub-tab placeholder, and activity logging.
- **Google Places API key silently failed** — `AddressAutocomplete` now shows an inline `⚠ Google Maps API key not configured` warning when `VITE_GOOGLE_MAPS_API_KEY` is absent.
- **Split city/state/zip fields not auto-filled** — `AddressAutocomplete.onSelect(place)` returns parsed components, and `VendorsPage` now pipes them into the separate city/state/zip inputs.

## Common-pattern items checked

- **Foreign keys**: localStorage-based; FK integrity is best-effort via shared IDs. Prisma models (vendor, pending order, bundle) use proper FKs with `onDelete: Cascade`.
- **Date/timezone**: all date fields stored as `YYYY-MM-DD` or ISO strings. No drift observed.
- **Currency precision**: all new code uses integer cents. `SavedQuote.finalPrice` is still a float (existing shape — not touched in this pass).
- **Hidden routes w/o auth**: the `/#/present/:token` public route exposes only the token-scoped options list with zero cost data — verified in `PublicPresentationPage`.
- **Missing loading states**: toasts + `uploading` state on Photos tab added.
- **Unhandled exceptions**: save paths wrapped in try/catch with toast.error.
