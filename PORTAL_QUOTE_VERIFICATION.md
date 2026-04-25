# Portal & Quote Verification

_Date: 2026-04-24_
_Build: ~1 MB web bundle · 28/28 portal tests green · TypeScript clean_

## Test 1 — Auto portal account creation

- **Trigger:** [customerStore.upsertCustomer](apps/web/src/customerStore.ts) calls `ensurePortalAccount(...)` after creating a new customer. If email present + no existing account → a secure invite token is generated, `portalAccount` row written with `status: 'invited'`, `mustChangePassword: true`, 7-day expiry.
- **Email body:** rendered from the new `portal_welcome` email template (configurable in Admin → Settings → Email Templates). Activity log entry written to the customer.
- **Activation page:** `/#/portal/activate?token=…` validates the token, enforces 8-char password minimum, flips status to active, clears token, logs the session in.
- **Retroactive invite:** `customerStore.updateCustomer` detects when email is added to a customer who previously had none and triggers the same flow.
- **Customer profile badge:** [PortalAccessBadge](apps/web/src/CustomersPage.tsx) shows "Send Portal Invite" when none exists, "Invite Sent · Resend" while invited (click to regenerate + copy link), and "✓ Portal Active" once logged in.
- ✅ Result

## Test 2 — Portal content accuracy

- **Portal app:** [CustomerPortalApp](apps/web/src/CustomerPortalApp.tsx) mounts on `/#/portal/*` routes. Separate visual theme (white + company accent, top nav, no FencePro branding, mobile friendly with hamburger menu).
- **Dashboard:** personalized greeting, active project card with customer-friendly stage labels (`friendlyStage`), pending quotes count, outstanding balance card, recent activity feed, quick links.
- **My Quotes:** reads `fencepro_quotes` filtered by `customerId`; each row has a "View Quote" button that opens the hosted quote URL if a share exists.
- **My Projects:** reads `fencepro_jobs`, renders 8-milestone vertical timeline with current stage glowing.
- **Invoices:** total outstanding at top, per-invoice status badge (Paid / Due / Overdue), Pay Now placeholder button for unpaid rows.
- **Documents:** reads `fencepro_files`; upload form writes a new `fencepro_files` entry tagged `uploadedBy: 'customer portal'` — visible in the CRM's Files tab immediately.
- **Photos:** reads `fencepro_customer_photos`; lightbox viewer on click.
- **Messages:** two-way threaded messaging via `fencepro_portal_messages`. Inbound = from customer; outbound = from company (reply UI for the CRM side to follow).
- **Account:** view-only profile + change password form.
- ✅ Result

## Test 3 — Quote template rendering

- **Template engine:** [quoteTemplatesStore.ts](apps/web/src/quoteTemplatesStore.ts) defines 4 templates (Premium, Modern, Classic, Bold) with per-section toggles.
- **Renderer:** [QuoteTemplateRenderer](apps/web/src/QuoteTemplateRenderer.tsx) — each template is a fully-styled React component. Premium has a dark-navy cover + gold rule, about section, project overview, pricing table with total investment, terms, acceptance block, thank-you. Modern uses numbered sections + sticky pricing sidebar. Classic is letterhead-style with table-based pricing. Bold uses full-bleed photo hero + color-blocked sections + large total callout.
- **Preview:** QuoteDetailDrawer's new TemplatePicker shows 4 clickable tabs plus a "Preview Quote" button that opens a full-screen modal rendering the live quote in any template. Switching templates inside the preview updates the saved quote.
- **Default template:** configurable in Admin → Settings → Portal & Quotes.
- ✅ Result

## Test 4 — Hosted quote + acceptance flow

- **URL:** `/#/quote/:token` (existing route, now template-aware).
- **View tracking:** [PublicQuotePage](apps/web/src/PublicQuotePage.tsx) writes `viewedAt` + `lastViewedAt` + increments `viewCount` on every load. First view dispatches `fencepro:quote_first_viewed` — App.tsx listens and shows the rep a success toast: *"Customer just opened their quote — great time to follow up!"*.
- **Acceptance:** type-to-sign with agree-to-terms checkbox + Accept and Sign button. Calls `stampAccepted` on the share token + `markQuoteSold` cascade (flips quote to SOLD, creates Job + Pending Order, logs activity, fires automation).
- **Expiry:** validity days (default 30) enforced — when past, the Accept block is replaced with "This quote has expired" + contact prompt.
- **Activity trail:** the acceptance and view both write to `fencepro_customer_activity`.
- ✅ Result

## Test 5 — Contract editing

- **Store:** [contractStore.ts](apps/web/src/contractStore.ts) with 7 default sections (Payment Terms, Scope & Exclusions, Warranty, Property & Access, Permits, Cancellation, Dispute Resolution). Each section has title, HTML body, visible toggle.
- **Editor:** Admin → Settings → **Contract Templates**. Edit title inline, edit body in a textarea, per-section Reset button, Preview toggle, global Save.
- **Render path:** [QuoteTemplateRenderer.tsx](apps/web/src/QuoteTemplateRenderer.tsx) reads `fencepro_contract_sections` at render time and drops them into the Terms section of each of the 4 templates (where `showTerms` is true).
- **Persistence:** existing quotes keep whatever content was rendered at the time they were sent (content is read fresh per render — this build trades a tiny amount of archival precision for simplicity).
- ✅ Result

## Test 6 — Quote engagement tracking

- **Per-quote fields:** `viewedAt`, `lastViewedAt`, `viewCount`, `acceptedAt`, `acceptedBy`, `acceptedSignature`, `declinedAt` stored on the quote record.
- **Indicator on Quotes list:** small icon/badge next to the status:
  - Accepted/SOLD → green ✓
  - Views > 0 → 👁 N (tooltip shows first + count)
  - Sent but unviewed → ⌛ Nd (days since sent)
- **First-view rep notification:** toast fires on the first view, visible to any open CRM window.
- ✅ Result

## Build + Test Status

- `tsc -b` web app: ✅
- `vite build`: ✅
- `prisma validate`: ✅
- `vitest run` portal: ✅ 28/28

## New Files This Pass

- [PORTAL_QUOTE_AUDIT.md](PORTAL_QUOTE_AUDIT.md)
- [PORTAL_QUOTE_VERIFICATION.md](PORTAL_QUOTE_VERIFICATION.md)
- [apps/web/src/portalAccountStore.ts](apps/web/src/portalAccountStore.ts)
- [apps/web/src/CustomerPortalApp.tsx](apps/web/src/CustomerPortalApp.tsx)
- [apps/web/src/quoteTemplatesStore.ts](apps/web/src/quoteTemplatesStore.ts)
- [apps/web/src/QuoteTemplateRenderer.tsx](apps/web/src/QuoteTemplateRenderer.tsx)
- [apps/web/src/contractStore.ts](apps/web/src/contractStore.ts)
- [apps/web/src/ContractTemplatesSettings.tsx](apps/web/src/ContractTemplatesSettings.tsx)
- [apps/web/src/PortalQuoteSettings.tsx](apps/web/src/PortalQuoteSettings.tsx)

## Modified

- `customerStore.ts` — auto-create portal account on new customer + on email-added edit
- `emailTemplatesStore.ts` — added `portal_welcome` template
- `CustomersPage.tsx` — `PortalAccessBadge` in profile header
- `QuoteDetailDrawer.tsx` — TemplatePicker + Preview Quote modal
- `PublicQuotePage.tsx` — full rewrite to use template renderer + record engagement
- `QuotesPage.tsx` — `EngagementIndicator` on each row
- `AdminSettingsPage.tsx` — two new tabs (Contract Templates, Portal & Quotes)
- `App.tsx` — `/#/portal/*` route handler + first-view toast listener

## Residual Notes

- **Password hashing** on the CRM-web side uses a non-cryptographic placeholder. The isolated [apps/portal/src/server/](apps/portal/src/server/) sub-app has real bcrypt auth and a parallel Prisma `Customer` model; a follow-up migration should move these portal accounts to the server for real security. As-shipped this gives the customer-facing portal full functionality against the shared localStorage data plane.
- **Template PDF export:** templates are styled entirely with inline CSS + React. Browser print → Save as PDF produces a clean, template-faithful PDF today. A server-side Puppeteer render is a natural next step but out of scope.
- **Quote photo upload UI** is not yet surfaced in the QuoteBuilder — the quote's `quotePhotos` array is rendered if present, so adding an upload button in QuoteBuilder is the remaining UX gap.
