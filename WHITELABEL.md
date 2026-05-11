# EZ Biz — Whitelabeling & Branding Guide

This guide covers everything needed to rebrand EZ Biz for a specific customer or deploy it as a white-labeled SaaS platform.

---

## Overview

EZ Biz has a centralized branding configuration layer (`configStore.ts`) that controls all user-facing brand elements. There are no hard-coded company names, colors, or contact details in any user-facing component — everything flows from this config.

---

## Quick Branding via the Admin UI

The fastest way to brand the app is through the Settings page:

1. Log in as an admin
2. Go to **Settings** → **Company Info**
3. Fill in:
   - **Company Name** — appears in the sidebar, customer portal, PDF headers, email templates
   - **Phone** — appears in the customer portal footer, quote documents
   - **Email** — used as reply-to in automated emails
   - **Address** — appears on invoice PDFs
   - **Logo URL** — hosted image URL for the logo (PNG/SVG recommended)
   - **Primary Color** — main brand color (hex, e.g. `#f97316`)
   - **Secondary Color** — used for accents and highlights
   - **Legal Name** — formal company name for contracts and invoices
   - **Support Email** — shown to customers in the portal
   - **Support Phone** — shown to customers in the portal

These settings persist to localStorage and are read by every component that needs company info.

---

## Branding Config Structure

All branding lives in `apps/web/src/configStore.ts` under the `CompanyInfo` interface:

```typescript
interface CompanyInfo {
  name: string               // Display name: "Acme Fence Co."
  phone: string              // "(555) 123-4567"
  email: string              // "info@acmefence.com"
  address: string            // "123 Main St, Orlando FL 32801"
  logoUrl?: string           // "https://acmefence.com/logo.png"
  primaryColor?: string      // "#2563eb"
  secondaryColor?: string    // "#1e40af"
  legalName?: string         // "Acme Fence Company, LLC"
  supportEmail?: string      // "support@acmefence.com"
  supportPhone?: string      // "(555) 123-4569"
  portal?: {
    accentColor?: string     // overrides portal nav accent
    supportEmail?: string    // overrides portal footer email
    supportPhone?: string    // overrides portal footer phone
  }
}
```

**Reading config in code:**
```typescript
import { getConfig } from './configStore'
const config = getConfig()
const companyName = config.company.name // "Acme Fence Co."
```

---

## What Gets Branded

| UI Surface | What Updates | Controlled By |
|------------|-------------|---------------|
| Sidebar header | Company name | `config.company.name` |
| Sidebar collapsed icon | First letter of company name (dynamic) | `config.company.name` |
| Customer portal nav | Company name + logo | `config.company.name` + `logoUrl` |
| Customer portal footer | Support email + phone | `config.company.supportEmail/supportPhone` |
| Customer portal accent | Nav highlight color | `config.company.portal.accentColor` |
| Public quote page | Company name + contact | `config.company.*` |
| Public presentation page | Company name | `config.company.name` |
| Invoice PDFs | Company name + address + phone | `config.company.*` |
| Email templates | `{{company_name}}` merge tag | `config.company.name` |
| Email subject lines | `{{company_name}}` merge tag | `config.company.name` |
| Contract sections | Company legal name | `config.company.legalName` |

---

## Code-Level Whitelabel Deployment

For deploying EZ Biz as a fully white-labeled product for a new customer, follow these steps:

### Step 1: Set Seed Data

Update `apps/portal/prisma/seed.ts` to use your customer's credentials:
```typescript
// Change these to customer-specific values:
email: 'admin@customerdomain.com',
assignedRepEmail: 'rep@customerdomain.com',
```

### Step 2: Set Default Config

In `apps/web/src/configStore.ts`, update the `DEFAULT_CONFIG` to pre-populate the customer's company info:
```typescript
const DEFAULT_CONFIG: AppConfig = {
  company: {
    name: 'Customer Company Name',
    phone: '(555) 000-0000',
    email: 'info@customer.com',
    address: '123 Main St, City ST 00000',
    logoUrl: 'https://customer.com/logo.png',
    primaryColor: '#customer-hex',
    legalName: 'Customer Company, LLC',
    supportEmail: 'support@customer.com',
    supportPhone: '(555) 000-0001',
  },
  // ...
}
```

### Step 3: Set App URL

In `apps/portal/.env`:
```env
APP_URL=https://crm.customerdomain.com
CLIENT_URL=https://crm.customerdomain.com
```

### Step 4: Optional — Custom Domain

Deploy `apps/web/dist/` to a static host under the customer's domain. The portal API can be deployed separately or on the same server.

### Step 5: Email Branding

Set the email sender name:
```env
SMTP_FROM_NAME=Customer Company Name
SMTP_FROM_EMAIL=noreply@customerdomain.com
```

Ensure the customer's domain is verified in SendGrid (or your SMTP provider) to avoid spam filtering.

---

## Portal-Specific Branding

The customer portal (`apps/portal/src/client/`) reads company config from the portal API:

- **Accent color**: Read from `config.portal.accentColor` via portal settings
- **Company name**: Read from `config.company.name`
- **Support contact**: Read from `config.company.portal.supportEmail/supportPhone`

These can be set in the CRM under Settings → Portal Settings.

---

## Logo Best Practices

- Use a **PNG or SVG** with transparent background
- Recommended dimensions: **200×60px** (landscape orientation)
- Host on a CDN or public storage bucket (AWS S3, Cloudflare R2, or CDN)
- Set `logoUrl` in company config
- The portal nav shows the logo image; if `logoUrl` is unset, it falls back to a colored badge with the first letter of the company name

---

## Multi-Tenant Considerations

EZ Biz is currently a single-tenant application (one company per deployment). For multi-tenant SaaS:

1. The `configStore.ts` branding layer is already tenant-aware by design
2. The portal PostgreSQL database would need a `tenantId` column on all models
3. All localStorage keys (`fencepro_*`) would need a tenant prefix or scoped storage
4. Authentication tokens would carry a `tenantId` claim
5. The automation engine already supports per-company rules via the `Automation` table

This is a future architectural enhancement and is outside the current single-tenant scope.

---

## Internal Identifier Notes

The following internal identifiers intentionally retain the `fencepro` prefix. These are localStorage keys and CustomEvent names — they are **never visible to end users** and changing them would break all existing browser-stored data:

- localStorage keys: `fencepro_quotes`, `fencepro_jobs`, `fencepro_customers`, etc.
- CustomEvent names: `fencepro:quotes:updated`, `fencepro:jobs:updated`, etc.

These are stable internal implementation details, analogous to database column names — they do not need to match the brand name.

See `REBRAND_AUDIT.md` for the full categorized list.
