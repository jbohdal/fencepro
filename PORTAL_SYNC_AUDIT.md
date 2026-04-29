# Portal ↔ CRM Sync Audit

_Date: 2026-04-25_

## Root cause (one sentence)

The customer portal and the CRM staff app **share no data plane** for photos, documents, or messages. Each side reads/writes its own browser localStorage, so anything a customer does in their browser is invisible to the staff browser. The fix is the same as the activation-token fix: move these flows to the portal backend (already running on `apps/portal/`).

## 1. Photo upload flow

- **Portal component:** [CustomerPortalApp.tsx PhotosPage](apps/web/src/CustomerPortalApp.tsx)  reads `localStorage.fencepro_customer_photos`. Display only — **no upload UI**.
- **Customer profile Photos tab in CRM:** [CustomerPhotosTab.tsx](apps/web/src/CustomerPhotosTab.tsx) has an upload form, writes to the same `localStorage.fencepro_customer_photos` key. Files are stored as base64 data URLs.
- **API endpoint:** none exists. There is no `POST /api/portal/photos`.
- **Result:** customer can never upload a photo from the portal; even if they could, it would be saved on their browser, invisible to staff.

## 2. Document upload flow

- **Portal component:** [CustomerPortalApp.tsx DocumentsPage](apps/web/src/CustomerPortalApp.tsx) — has an upload UI. On submit it appends a row to `localStorage.fencepro_files` using `FileReader.readAsDataURL` (base64 in localStorage).
- **CRM Files tab:** also reads `localStorage.fencepro_files` filtered by customerId.
- **API endpoint:** none. The portal upload writes nothing to the server.
- **Why staff can't see it:** the customer's browser localStorage is not the staff's browser localStorage. Each load of either app reads only its own copy.

## 3. CRM Files tab query

- Filters `getCustomerFiles()` by `customerId`. **No source filter.** If both browsers shared a database row, the staff side would see it. The visibility gap is purely about the storage being browser-local.

## 4. Messaging system

- **Portal:** [CustomerPortalApp.tsx MessagesPage](apps/web/src/CustomerPortalApp.tsx) writes to `localStorage.fencepro_portal_messages` with `direction: 'inbound' | 'outbound'`.
- **CRM:** there is **no Messages tab on the customer profile** and **no global inbox**. The store key exists but nothing on the staff side reads from it. Even if it did, same browser-isolation problem.
- **API endpoint:** none.

## 5. Other portal → CRM data flows

| Action | Working today? |
|---|---|
| Quote acceptance | ⚠ partial — `/#/quote/:token` page is browser-side only too: customer's "Accept" writes the quote-share record to **their** localStorage, never reaching staff. The `markQuoteSold` cascade fires locally but on the customer's machine. **Same root cause.** Already a known gap that needs the same backend treatment. |
| Stripe payment | not configured — no Stripe webhooks |
| Document upload | broken (Phase 3 fix) |
| Photo upload | broken (Phase 2 fix) |
| Messages | broken (Phase 4 fix) |
| Account info update | not implemented |
| Portal login activity | ✅ — `lastLoginAt` updates server-side via `/api/portal/login` (added in the previous fix) |

## 6. Storage configuration

- `apps/portal/src/server/lib/storage/index.ts` — local-disk storage at `UPLOAD_DIR` (default `./uploads`). Multer is wired with 25MB limit and a basic allowed-types list (PDF, DOCX, XLSX, PNG, JPG). HEIC/WebP not in the allow-list — needs to be added for the photo path.
- `S3_BUCKET` not configured — local disk only. Production deploy maps `/var/www/fencepro/portal/uploads/` so files DO persist between restarts. Acceptable for now; flag in settings.

## Fix plan

| Phase | Fix |
|---|---|
| 2 | New Prisma `PortalPhoto` model. Routes: `POST /api/portal/photos` (multipart, portal JWT auth), `GET /api/portal/photos` (own photos), `GET /api/portal/customer/:id/photos` (staff). Add HEIC + WebP to allow list. CRM Photos tab + portal PhotosPage call the new endpoints. Source badge in CRM. |
| 3 | New Prisma `PortalDocument` model with `source` enum. Routes mirror the photos pattern. Both CRM Files tab and portal DocumentsPage become server-backed. |
| 4 | New Prisma `PortalMessage` model with `senderType` enum + read flags. Routes: portal `POST/GET /api/portal/messages`; staff `GET/POST /api/portal/customer/:id/messages` and `GET /api/portal/messages/inbox`. New CRM Messages tab on customer profile + a global inbox dropdown wired into the existing notification bell. |
| 5 | Document the existing gap on quote acceptance (out of scope for this prompt — would need the same backend treatment). Add `lastLoginAt` display to the Portal Access section. |
| 6 | Wire `createNotification` calls from each portal POST route → in-app notifications visible via the existing bell. |

Proceeding to implementation.
