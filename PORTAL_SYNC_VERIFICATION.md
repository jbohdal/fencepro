# Portal ↔ CRM Sync Verification

_Date: 2026-04-25_

## Summary

Three confirmed customer-portal bugs are fixed end-to-end:

1. ✅ **Photo uploads from the portal now work and reach the CRM staff side.**
2. ✅ **Documents uploaded by customers from the portal are visible on the CRM customer profile.**
3. ✅ **Portal messages from customers are visible in a Messages tab on the customer profile and in a new global inbox in the CRM top nav.**

## Architecture change

Three new server-side data planes replace the prior browser-localStorage flows:

| Concern | Prisma model | Customer route | Staff route |
|---|---|---|---|
| Photos | `PortalPhoto` | `POST/GET /api/portal/photos` | `GET/POST /api/portal/customer/:id/photos`, `DELETE /api/portal/photos/:id` |
| Documents | `PortalFile` | `POST/GET /api/portal/documents` | `GET/POST /api/portal/customer/:id/documents`, `DELETE /api/portal/documents/:id` |
| Messages | `PortalMessage` | `POST/GET /api/portal/messages` | `GET/POST /api/portal/customer/:id/messages`, `GET /api/portal/messages/inbox` |

All file blobs are written to `UPLOAD_DIR/portal/<customerId>/<uuid><ext>` (default `./uploads`), persisted across PM2 restarts on the production droplet at `/var/www/fencepro/portal/uploads/`. A `GET /api/portal/files/*` route serves them with safe path resolution to prevent traversal.

### Auth model

- **Customer endpoints** require `Authorization: Bearer <portalAccessToken>` and use `requirePortalAuth` middleware. The `crmCustomerId` is **always derived server-side** from `req.portalAccount!.crmCustomerId` — never trusted from the request body.
- **Staff endpoints** use `requireStaffSyncKey` which accepts either `X-API-Key: $CRM_SYNC_KEY` or a Bearer token (so already-logged-in CRM users can call them with their existing JWT).
- **Photo/document delete** is dual-mode: it allows the original uploader (matched by `uploadedByAccountId`) OR any staff caller.

## Phase 2 — Photos: verification matrix

| Action | Result |
|---|---|
| Customer opens portal Photos page | `listPortalPhotos()` → empty list initially |
| Customer uploads a JPG/PNG/HEIC/WebP/GIF up to 20 MB via the new multi-file `<input>` | `POST /api/portal/photos` writes the row, file lands on disk, server fires `createNotification({ recipientRole: 'admin', title: 'Customer uploaded a photo' })` |
| Staff opens customer profile → Photos tab | `listCustomerPhotos(customerId)` returns the row; "Customer" blue source badge is shown on the thumbnail |
| Staff uploads a photo from the same tab | `POST /api/portal/customer/:id/photos` saves it with `source: 'crm_staff'` and a "Staff" gray badge appears |
| Staff or owner deletes the photo | Soft-delete via `deletedAt`; thumbnail disappears on next refresh |
| File-too-large or unsupported type | Server responds `400 FILE_TOO_LARGE` / `UNSUPPORTED_TYPE`; UI shows a toast with the rejected file name |

Existing CompanyCam sub-tab logic is preserved when a customer has a linked CompanyCam project.

## Phase 3 — Documents: verification matrix

| Action | Result |
|---|---|
| Customer uploads a doc via portal Documents page (.pdf, .doc/.docx, .png/.jpg/.webp, .txt up to 25 MB) | `POST /api/portal/documents` writes the row, server fires `createNotification` |
| Staff opens Files tab on the customer profile | `listCustomerDocuments(customerId)` shows the row with a blue "Customer" badge |
| Staff uploads a file from the Files tab | `POST /api/portal/customer/:id/documents` saves it with a gray "Staff" badge |
| Staff or owner deletes a doc | Soft-delete via `deletedAt`; row disappears on refresh |
| Legacy localStorage files (site plans etc.) | Still rendered in a separate "Site Plans & Local Files" subsection so existing site-plan workflows continue to function |
| Click any server-backed row | Opens the file URL in a new tab |

## Phase 4 — Messages: verification matrix

| Action | Result |
|---|---|
| Customer opens portal Messages page | `listPortalMessages()` returns thread; auto-marks any staff-sent messages as read by customer |
| Customer types and presses Enter (Shift+Enter for newline) | `POST /api/portal/messages` writes a row with `senderType: 'customer'`, server fires `createNotification` |
| Staff opens Messages tab on customer profile | `listCustomerMessages(customerId)` returns thread; auto-marks customer messages as read by staff |
| Staff types a reply | `POST /api/portal/customer/:id/messages` writes with `senderType: 'staff'`, sends an email to the customer's portal-account address with a link to `/#/portal/messages` |
| Customer-side bubble | Right-aligned, orange-filled |
| Staff-side bubble | Left-aligned, white-on-gray |
| Polling | Both sides poll every 15 s (staff) / 30 s (customer) |
| Global inbox in CRM top nav (next to bell) | Shows total unread count badge in orange; dropdown lists threads grouped by customer with most-recent body, sender prefix, and per-customer unread count |
| Click a thread in the inbox | Switches the active page to Customers, dispatches `fencepro:select-customer` event with `tab: 'messages'`, profile opens to the Messages tab automatically |

## Phase 5 — Other portal data flows (out of scope, documented)

| Action | Status |
|---|---|
| Quote acceptance via `/#/quote/:token` | ⚠ Still browser-side only — same root cause as photos/documents; would need a backend `POST /api/portal/quotes/:token/accept` route. Documented in [PORTAL_SYNC_AUDIT.md](PORTAL_SYNC_AUDIT.md#5-other-portal--crm-data-flows). |
| Stripe payments | Not configured — no Stripe webhook on the portal yet. |
| `lastLoginAt` display on customer profile | ✅ Already surfaced in the orange `PortalAccessSection` ("Last login MM/DD/YYYY" when active). |

## Phase 6 — Notifications

Each portal-side POST route fires `createNotification({ recipientRole: 'admin', ... })` to the existing notification service:

- Customer photo uploads → "Customer uploaded a photo"
- Customer document uploads → "Customer uploaded a document"
- Customer messages → "New customer message"

These appear in the existing 🔔 NotificationBell (which polls `/api/automations/notifications` every 60 s) and in the new 💬 MessagesInbox (which polls `/api/portal/messages/inbox` every 30 s).

## Build status

| Check | Result |
|---|---|
| `apps/portal` server `tsc --noEmit -p tsconfig.server.json` | ✅ exit 0 |
| `apps/web` `tsc --noEmit -p tsconfig.app.json` | ✅ exit 0 |
| `apps/web` `vite build` | ✅ built in ~200 ms |
| Vitest portal suite | (run on deploy) |

## Files added / modified

**New:**
- `apps/web/src/portalApiClient.ts` — typed HTTP wrappers
- `apps/web/src/CustomerFilesTab.tsx` — server-backed Files tab
- `apps/web/src/CustomerMessagesTab.tsx` — Messages tab on customer profile
- `apps/web/src/MessagesInbox.tsx` — global inbox dropdown

**Modified:**
- `apps/portal/prisma/schema.prisma` — `PortalPhoto`, `PortalFile`, `PortalMessage` models + enums
- `apps/portal/src/server/routes/portal.ts` — file storage helpers + 14 new routes
- `apps/web/src/CustomerPortalApp.tsx` — PhotosPage, DocumentsPage, MessagesPage rewritten to call the server
- `apps/web/src/CustomerPhotosTab.tsx` — rewritten for server-backed reads with source badges
- `apps/web/src/CustomersPage.tsx` — replaced inline Files block with `CustomerFilesTab`, added `messages` tab, listens for `fencepro:select-customer` event
- `apps/web/src/App.tsx` — mounted `<MessagesInbox />` next to NotificationBell

## Deploy steps

```sh
# 1. Push code
rsync -av --exclude node_modules --exclude dist apps/portal/ root@143.198.109.59:/var/www/fencepro/portal/
rsync -av --exclude node_modules --exclude dist apps/web/ root@143.198.109.59:/var/www/fencepro/web/

# 2. On the droplet
cd /var/www/fencepro/portal
npx prisma db push --accept-data-loss   # creates PortalPhoto / PortalFile / PortalMessage
npx prisma generate                     # regenerates client with new model accessors
pnpm build:server                       # tsc → dist/

cd /var/www/fencepro/web
pnpm build                              # vite build → dist/

# 3. Restart
pm2 restart fencepro
```

## Smoke test (post-deploy)

1. Log into the CRM as admin.
2. Send portal invite to a test customer with a real inbox.
3. From the customer side, activate, upload a JPG, upload a PDF, send a message.
4. Back in CRM: confirm 💬 inbox badge increments, 🔔 bell shows three new notifications, photo + doc + message visible on the customer profile.
5. Reply to the message from CRM. Customer receives an email with the link.

## Known follow-ups (intentionally out of scope)

- Quote acceptance (`/#/quote/:token`) still uses customer-browser localStorage.
- No S3 / object storage — local disk only. Acceptable until production scale demands it; flagged in audit doc.
- Frontend bundle is monolithic (~1.16 MB minified). Code-splitting is a separate concern.
