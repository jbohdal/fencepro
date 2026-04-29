# EZBiz Production Readiness Audit — Summary

_Date: 2026-04-26_
_Branch: main (uncommitted)_
_Auditor: Code-level static audit (UI flows not exercised in browser)_

## TL;DR

Renamed from FencePro to EZBiz across user-facing surface. Found and fixed **1 critical financial bug** (sales-tax math 100× too small), tightened **5 production-config gaps** (CRM login rate-limit, helmet HSTS, /health DB check, server identification header, password reset flow). Identified **8 architectural issues** that need design-level work — listed in EZBIZ_KNOWN_ISSUES.md with priority and effort estimate.

This audit is static (code reading + grep) — no UI clicking, no integration testing with external credentials, no load testing. Anything that requires a real browser, a real Stripe webhook, a real Twilio number, or a populated multi-tenant DB is flagged for human follow-up.

## Bugs found and fixed

| # | Severity | File | Fix |
|---|---|---|---|
| 1 | **Critical** | [CustomersPage.tsx:473](apps/web/src/CustomersPage.tsx#L473) | Sales-tax was computed as `subtotal * taxRate / 100` but `taxRate` is already a decimal (0.07 for 7%). Result: invoices were under-taxed by 100×. Removed the spurious `/ 100`. |
| 2 | High | [server/index.ts:84-91](apps/portal/src/server/index.ts#L84-L91) | CRM staff login (`/api/crm-auth/login`) had no dedicated rate limiter — only the 100/min blanket. Added 5/15min limiter. Same for `forgot-password`, `portal/login`, and `portal/activate`. |
| 3 | Medium | [server/index.ts:39](apps/portal/src/server/index.ts#L39-L46) | `helmet()` was using defaults — added explicit HSTS (1 year, includeSubDomains, preload), strict referrer policy, and disabled `x-powered-by`. |
| 4 | Medium | [server/index.ts:115](apps/portal/src/server/index.ts#L115-L122) | `/api/health` was a static `{status:'ok'}` — now pings `SELECT 1` against Postgres and returns 503 if the DB is unreachable, so load balancers can route around a broken instance. |
| 5 | Medium | (file route) | Express 5's path-to-regexp v8 had rejected `/files/*` — already fixed during deploy. |

## Rename inventory

| Surface | Result |
|---|---|
| HTML `<title>` and meta tags (web + portal) | ✅ EZBiz |
| Login page brand + logo | ✅ "EZ" badge + "EZBiz" title |
| Email from-name fallback | ✅ EZBiz (overridable via `COMPANY_NAME` env) |
| Email from-address fallback | ✅ `noreply@ezbiz.app` |
| Invite email subject + body | ✅ EZBiz |
| Calendar event "Created by" footer | ✅ EZBiz |
| Public quote / presentation footer | ✅ "Powered by EZBiz" |
| Quote/PDF/portal company-name fallback (`'FencePro'` literal) | ✅ All 11 sites changed to `'EZBiz'` |
| `configStore.ts` default config seed | ✅ EZBiz |
| Customer-profile "Quotes from FencePro" header | ✅ EZBiz |
| Test webhook payload | ✅ EZBiz |
| Server boot log | ✅ "EZBiz Portal API running on port…" |
| `apps/portal/README.md` | ✅ EZBiz |
| Internal class names (`FenceProCrmAdapter`, file paths) | ⚠ **Intentionally left** — internal identifiers, never shown to users |
| `localStorage.fencepro_*` keys | ⚠ **Intentionally left** — renaming would wipe all user data on next page load |
| PM2 process name `fencepro` + `/var/www/fencepro/` deploy path | ⚠ **Intentionally left** — renaming requires PM2 reconfig + new nginx config; no user-visible impact |
| Workspace `package.json` `name:` fields | ⚠ **Intentionally left** — pnpm workspace identifiers; no user-visible impact |

## Module health snapshot

| Module | Code-level health | Verified via |
|---|---|---|
| Auth (CRM staff) | 🟢 Strong — bcrypt(12), session table, lockout, refresh rotation. Now rate-limited too. | Code read |
| Auth (portal customer) | 🟢 Strong — same pattern, SHA-256 hashed activation tokens (recent fix). | Code read |
| Customer management | 🟡 Functional but localStorage-resident. Real-time event dispatch works. | Code read |
| Quote builder | 🟡 Functional. Has 2 `Float` columns in `QuoteBundle` / `QuoteOption` schema (margin %). Document-only at this size; no observed precision issue. | Schema read |
| Operations / jobs | 🟡 Functional. Same localStorage-resident pattern. | Code read |
| Scheduling | 🟡 Functional. Google Calendar integration code is wired. | Code read |
| Inventory | 🟡 Has float-money `unitCost` / `total` on `POLineItem`. Should migrate to `cents` integers. | Code read |
| Billing / AR | 🟢 **After the tax fix**. Integer-cents throughout `billingStore.ts`. Aging buckets sound. | Code read |
| Vendor / AP | 🟢 Integer-cents. | Code read |
| P&L / Balance Sheet | 🟢 Integer-cents. | Code read |
| Automations | 🟢 28/28 vitest tests pass. Cycle prevention + error containment confirmed. | Tests run |
| Portal data plane (photos/docs/messages) | 🟢 Server-backed (deployed yesterday). | Tests + smoke |
| Stripe integration | ⚠ **Untested** — needs real credentials + webhook target |
| Twilio SMS | ⚠ **Untested** — needs real credentials |
| QuickBooks | ⚠ **Untested** — needs OAuth flow exercise |
| CompanyCam | ⚠ **Untested** — needs project link + photo upload |
| Connecteam | ⚠ **Untested** — needs API key |
| SendGrid | 🟡 Wired but SMTP_FROM sender unverified per prior session screenshot — emails still bounce as 403 unverified. Frontend has mailto fallback. |
| Multi-tenant isolation | 🔴 **Architectural gap** — see EZBIZ_KNOWN_ISSUES.md #1 |

## Build + deploy

- ✅ `apps/web` `tsc --noEmit -p tsconfig.app.json` — exit 0
- ✅ `apps/portal` `tsc --noEmit -p tsconfig.server.json` — exit 0
- 🟡 Vite build runs clean but bundle is monolithic (1.16 MB minified) — code-splitting is a separate effort.
- ⏳ Production deploy pending — final step of this pass.

## What was NOT done in this pass

The original prompt's 22 phases include several items that are weeks of architectural work, not a single audit pass. Listed below with honest assessments — see EZBIZ_KNOWN_ISSUES.md for full detail.

- **Multi-tenant isolation rewrite** — adding `companyId` to every table + every WHERE clause. Architectural; deferred.
- **Trade-agnostic terminology overhaul** (Phase 20) — replacing fence-specific labels everywhere except the estimating engine. Requires settings refactor and component-level review. Deferred.
- **7-day end-to-end UI simulation** (Phase 22) — requires a human clicking through the app. The static audit can verify code paths exist; it cannot verify UX or visual regressions.
- **Integration testing requiring live credentials** — Stripe webhooks, Twilio SMS, QuickBooks OAuth, Connecteam, CompanyCam, Google Calendar OAuth.
- **Mobile-responsive sweep at 390px viewport** — also requires browser. Static signals (text-xs on tap targets, modal sizing) flagged but not fixed.
- **Performance audit** — needs metrics, not static reading.
- **Float-money column migrations** — schema changes that touch live data; should be a separate planned migration with rollback.

## Recommended next steps (in order)

1. **Verify SendGrid sender** — without this, all transactional emails 403. Single highest user-facing impact.
2. **Plan multi-tenant data model** — see EZBIZ_KNOWN_ISSUES.md #1. This blocks the "millions of paying companies" goal.
3. **Float-money column migration** — `QuoteBundle`, `QuoteOption`, `POLineItem`. Plan the migration, write the code, run on staging first.
4. **Mobile audit at 390px** — schedule a browser session.
5. **Integration credential setup + smoke test** — one integration per session, with a written smoke test plan.
