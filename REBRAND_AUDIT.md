# Rebrand Audit — FencePro → EZ Biz

Generated: 2026-05-02

## Summary

Every occurrence of "FencePro", "fencepro", and "fence-pro" has been categorized and acted upon below.

---

## Category 1: User-Facing (Replaced with EZ Biz)

These strings were visible to end users and have been updated.

| File | Line | Old Value | New Value | Status |
|------|------|-----------|-----------|--------|
| `apps/web/src/EmailTemplatesSettings.tsx` | 18 | `https://app.fencepro.com/quote/abc123` | `https://yourapp.example.com/quote/abc123` | ✅ Fixed |
| `apps/web/src/EmailTemplatesSettings.tsx` | 22 | `GD Fence Pro` | `EZ Biz` | ✅ Fixed |
| `apps/portal/src/server/integrations/adapters/zapier/index.ts` | 41 | `source: 'fencepro_crm'` | `source: 'ezbiz_crm'` | ✅ Fixed |

---

## Category 2: Brand-Wrapper (Code Identifiers — Safely Renamed)

These are code-level names (package names, class names) that carried the old brand and have been updated.

| File | Old Value | New Value | Status |
|------|-----------|-----------|--------|
| `package.json` (root) | `"name": "fencepro"` | `"name": "ezbiz"` | ✅ Renamed |
| `apps/portal/package.json` | `"name": "fencepro-portal"` | `"name": "ezbiz-portal"` | ✅ Renamed |
| `packages/api/package.json` | `"name": "@fencepro/api"` | `"name": "@ezbiz/api"` | ✅ Renamed |
| `packages/shared/package.json` | `"name": "@fencepro/shared"` | `"name": "@ezbiz/shared"` | ✅ Renamed |
| `apps/portal/src/server/lib/crm/adapters/fencepro.ts` | `class FenceProCrmAdapter` | `class EzBizCrmAdapter` | ✅ Renamed |
| `apps/portal/src/server/lib/crm/client.ts` | `import { FenceProCrmAdapter }` | `import { EzBizCrmAdapter }` | ✅ Updated |
| `apps/portal/src/server/lib/crm/client.ts` | `CRM_PROVIDER = 'fencepro'` | `CRM_PROVIDER = 'ezbiz'` | ✅ Updated |

**Note:** The file `apps/portal/src/server/lib/crm/adapters/fencepro.ts` retains its filename intentionally — renaming it would require updating all imports across the codebase. The class inside is now `EzBizCrmAdapter`. A future refactor can rename the file itself.

---

## Category 3: Internal Identifiers (Intentionally Left Unchanged)

These identifiers are used as localStorage keys, CustomEvent names, or internal constants. Changing them would **break all existing user data** stored in browsers. They are safe internal names that users never see directly.

### localStorage Keys (apps/web/src/)
These keys persist data in the user's browser and must not change:
- `fencepro_quotes` — saved quotes
- `fencepro_customers` — customer records
- `fencepro_jobs` — job records
- `fencepro_config` — app configuration
- `fencepro_budget` — budget data
- `fencepro_pipeline` — sales pipeline
- `fencepro_user` — user profile
- `fencepro_invoices` — invoice records
- `fencepro_payments` — payment records
- `fencepro_statements` — statements
- `fencepro_customer_notes` — customer notes
- `fencepro_customer_pullsheets` — pull sheets
- `fencepro_bundles` — material bundles
- `fencepro_quote_options` — quote options
- `fencepro_job_checklists` — job checklists
- `fencepro_default_milestones` — milestone templates
- `fencepro_import_templates` — import templates
- `fencepro_import_log` — import history
- `fencepro_contacts_db_migrated_v1` — migration flag
- `fencepro_inventory` — inventory items
- `fencepro_inv_locations` — inventory locations
- `fencepro_inv_stock` — stock levels
- `fencepro_inv_transactions` — stock transactions
- `fencepro_inv_suppliers` — suppliers
- `fencepro_purchase_orders` — purchase orders
- `fencepro_pending_orders` — pending orders
- `fencepro_staging` — staging jobs
- `fencepro_rainlog` — rain day log
- `fencepro_siteplans` — site plans
- `fencepro_changeorders` — change orders
- `fencepro_jobcosting` — job costing
- `fencepro_pl_entries` — P&L entries
- `fencepro_bs_entries` — balance sheet entries
- `fencepro_vendors` — vendor records
- `fencepro_vendor_bills` — vendor bills
- `fencepro_vendor_payments` — vendor payments
- `fencepro_contract_sections` — contract templates
- `fencepro_email_templates` — email templates
- `fencepro_quote_shares` — quote share tokens
- `fencepro_ops_stages` — operations stages config
- `fencepro_ops_*` — operations board view preferences
- `fencepro_pipeline_*` — pipeline board view preferences
- `fencepro_portal_session` — portal session token
- `fencepro_portal_accounts_cache` — portal accounts cache

### CustomEvent Names (apps/web/src/)
Browser custom events used for cross-component communication:
- `fencepro:quotes:updated`
- `fencepro:quotes:updated`
- `fencepro:quote_first_viewed`
- `fencepro:quote_accepted`
- `fencepro:customers:updated`
- `fencepro:settings:updated`
- `fencepro:checklist:updated`
- `fencepro:contract:updated`
- `fencepro:email_templates:updated`
- `fencepro:jobs:updated`
- `fencepro:pipeline:updated`
- `fencepro:ops_stages:updated`
- `fencepro:portal:updated`
- `fencepro:select-customer`

### Comments and Documentation Strings
- `apps/portal/src/server/routes/sync.ts` — JSDoc comment updated to "EZ Biz CRM app"
- `apps/portal/src/server/lib/crm/adapters/fencepro.ts` — class comment updated
- `apps/portal/prisma/seed.ts` — seed data uses `@gdfencepro.com` demo emails (seed/demo data only, not production)
- `apps/portal/scripts/backup-database.ts` — cron comment path `/var/www/fencepro/repo` (deployment path example, operator updates for their server)
- `apps/portal/src/server/lib/dataIntegrityCron.ts` — backup alert email example path (deployment note, not user-facing)

---

## Verification

After applying these changes, the following user-facing surfaces contain no remaining "FencePro" strings:
- ✅ Login page
- ✅ Main navigation / sidebar
- ✅ Dashboard
- ✅ Customer portal
- ✅ Public quote page
- ✅ Public presentation page
- ✅ Email template previews
- ✅ PDF headers (derived from company name config)
- ✅ Integration test payloads (Zapier)
