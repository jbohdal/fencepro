# EZBiz — White-Label & Customization Guide

_Updated: 2026-04-26_

EZBiz ships as a service-business CRM platform that companies brand and configure for their own use. This guide covers what's white-labelable today and what requires code-level customization.

## Brand surfaces (configurable today)

These read from `Settings → Company Info` and apply across the app, customer portal, emails, and PDFs:

| Element | Source | Where it appears |
|---|---|---|
| Company name | `company.name` (localStorage `fencepro_config`) | App header, portal welcome, quote / invoice / statement PDFs, email subject + signature |
| Phone | `company.phone` | PDFs, portal contact info |
| Email | `company.email` | PDFs, email reply-to |
| Address (street/city/state/zip) | `company.address` etc. | PDFs, portal contact card |
| Logo | upload via Settings → Company Info | App header, portal, PDFs |
| Portal accent color | `portal.accentColor` (default `#f97316`) | All portal call-to-action buttons + portal nav highlights |

**Fallback behavior**: when no company name is set, the app shows `EZBiz` as the fallback brand. White-label customers should set their own company name immediately on first login.

## What "EZBiz" branding controls

EZBiz is the platform brand — visible to:
- The CRM operator (your customer's team) on the login page and a footer-style "Powered by EZBiz" line on public-facing quote pages.
- Recipients of system emails when no `COMPANY_NAME` env var is set.

To re-brand the platform itself (say you're reselling EZBiz as `MyTradeBiz`):
1. Set `COMPANY_NAME=MyTradeBiz` in the server env.
2. Replace the literal string `'EZBiz'` in these files with your own:
   - `apps/web/index.html` — `<title>` and meta tags
   - `apps/portal/src/client/index.html` — same
   - `apps/web/src/LoginPage.tsx` — login screen brand
   - `apps/web/src/configStore.ts` — default company name fallback
   - `apps/web/src/PublicPresentationPage.tsx` — "Powered by" footer
   - `apps/portal/src/server/lib/emailService.ts` — `SMTP_FROM` and `SMTP_FROM_EMAIL`
3. Replace the favicon at `apps/web/public/favicon.svg` and the apple-touch icons.
4. Rebuild: `pnpm build` in both `apps/web` and `apps/portal`.

## Configuring for a new trade (non-fence)

EZBiz works for any service business out of the box. Some defaults are fence-flavored and should be reviewed:

### Pipeline stages (configurable in Settings)
Default seed: First Contact → Estimate Sent → Negotiating → Signed Contract → Lost.
For a new trade, rename or add stages — board updates immediately.

### Operations stages (configurable in Settings)
Default seed: Awaiting Locates → Pre-Build → Build Day → QC → Complete.
For non-fence trades, replace e.g.:
- HVAC: Equipment Order → Pre-Install → Install → Startup → Complete
- Roofing: Permit → Materials Delivered → Install → Inspection → Complete
- Pool: Excavation → Plumbing → Steel → Plaster → Startup

### Inventory items
Default seed (`apps/portal/prisma/seed.ts`) is fence-specific. For other trades:
1. Disable the default items via Settings → Inventory.
2. Bulk-import via CSV or add manually.

### Estimating engine
**Fence-specific by design.** The estimating engine (`apps/web/src/QuoteBuilder.tsx`, the materials calculations, and the EZ Budget tool) is the trade-specific module that requires per-trade customization. For non-fence trades:
- Hide the QuoteBuilder from the navigation.
- Use the generic Quote builder (line-item-based) instead.
- The line-item Quote tab is fully trade-agnostic.

A future release will add per-trade estimating engines (HVAC tonnage, roofing squares, painting square footage). Track the roadmap.

### Email templates (configurable in Settings → Email Templates)
Default templates are trade-neutral but mention "fence" in a couple places. Review and edit:
- `portal_welcome` — generic
- `quote_sent` — mentions "your quote"
- `quote_accepted` — generic
- `invoice_sent` — generic
- `invoice_paid` — generic

Merge tags available: `{{customer_first_name}}`, `{{customer_name}}`, `{{company_name}}`, `{{company_phone}}`, `{{portal_link}}`, `{{quote_link}}`, `{{quote_total}}`, `{{invoice_number}}`.

## Multi-tenant deployment (planned)

EZBiz **does not yet support** multiple companies sharing one deployment. Today, each company gets its own database / its own deployment. The roadmap for multi-tenancy:

1. Add `companyId` to every domain table (`Customer`, `Quote`, `Job`, `Invoice`, etc.).
2. Add a `Company` table; every authenticated user belongs to one Company.
3. Scope every query by `companyId`.
4. Expose a sign-up flow + Stripe-billing per company.

When this lands, a single EZBiz instance can serve thousands of companies. Until then, run a separate instance per customer or use the white-label rebrand path above.

## API access

Every company gets a `CRM_SYNC_KEY` (32-byte hex). Use the `X-API-Key` header to call the staff-side endpoints:

```
GET  /api/portal/customer/:id/photos
GET  /api/portal/customer/:id/documents
GET  /api/portal/customer/:id/messages
POST /api/portal/customer/:id/photos
POST /api/portal/customer/:id/documents
POST /api/portal/customer/:id/messages
GET  /api/portal/messages/inbox
```

(Customer-facing endpoints use `Authorization: Bearer <portalAccessToken>`.)

Rate limit: 100 req/min per IP. Login endpoints further limited to 5 per 15 min.

## File storage

Default: local disk at `UPLOAD_DIR` (default `./uploads`). For multi-region or larger fleets, swap to S3:
1. Implement an S3 storage adapter at `apps/portal/src/server/lib/storage/`.
2. Set `STORAGE_DRIVER=s3` plus `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`.
3. Update `storeUploadFile` to dispatch to the adapter.

Stub structure already exists; the file-serve route at `/api/portal/files/*` would proxy or 302-redirect to S3 signed URLs.

## Reseller checklist

If you're reselling EZBiz to your own customers:
1. Pick a unique platform brand name (replace `EZBiz`).
2. Replace logo + favicon assets.
3. Set up a domain + SSL.
4. Provision a Postgres DB (managed; daily backups).
5. Provision SendGrid or SMTP + verify the sender domain.
6. Set up a Stripe account + webhook for invoice payments (optional).
7. Set up Twilio for SMS (optional).
8. Document the per-customer onboarding steps for your team.

A future release will add a "Reseller Dashboard" that automates customer provisioning and billing.
