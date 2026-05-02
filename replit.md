# EZ Biz — Platform Overview

EZ Biz is a complete field service and sales platform for fence contracting companies. It includes a CRM, quoting engine, operations board, inventory management, billing, customer portal, and automation engine.

## Architecture

**Monorepo:** pnpm workspaces

```
ezbiz/                           ← root (package name: ezbiz)
├── apps/
│   ├── web/                     ← React/Vite SPA — main CRM (port 5000)
│   └── portal/                  ← Express API + customer portal (port 4000)
├── packages/
│   ├── api/                     ← @ezbiz/api shared package
│   └── shared/                  ← @ezbiz/shared (quote engine utils)
├── AUDIT_REPORT.md              ← full module inventory
├── DATA_FLOW_MAP.md             ← cross-module data flows
├── REBRAND_AUDIT.md             ← FencePro → EZ Biz categorized rebrand log
├── SETUP.md                     ← external services setup guide
├── WHITELABEL.md                ← whitelabeling and branding guide
└── README.md                    ← developer quickstart
```

## Running the App

**Workflow:** "Start application" — runs both services simultaneously
- Web app (Vite) on port 5000 (webview)
- Portal server (Express) on port 4000 (console)

**Manual start:**
```bash
# Terminal 1 — portal server
pnpm --filter ezbiz-portal dev:server

# Terminal 2 — web app
pnpm --filter web dev
```

## Technology Stack

- **Web app:** React 19, Vite 8, TailwindCSS 4, TypeScript 5.9
- **Portal server:** Express 5, Prisma 6, PostgreSQL, tsx (watch mode)
- **Node.js:** 20+ (required for Vite 8)
- **Package manager:** pnpm with workspaces + Turborepo

## Data Storage

- **CRM data** (quotes, jobs, customers, inventory, billing, pipeline) → browser `localStorage`, keys prefixed `fencepro_*`
- **Portal data** (auth, portal accounts, automations, integrations, leads) → PostgreSQL via Prisma
- **Sync:** CRM posts changes to `/api/sync/*` which upserts to portal DB

## Branding / Config

All branding lives in `apps/web/src/configStore.ts` → `CompanyInfo` interface.

New branding fields added (2026-05-02):
- `logoUrl` — hosted logo image URL
- `primaryColor` / `secondaryColor` — hex brand colors
- `legalName` — formal name for contracts
- `supportEmail` / `supportPhone` — customer-facing contact
- `portal.accentColor` / `portal.supportEmail` / `portal.supportPhone` — portal-specific overrides

These are all configurable via Settings → Company Info in the UI.

## Key Files

- `apps/web/src/App.tsx` — root shell, sidebar, routing, role switching
- `apps/web/src/configStore.ts` — centralized branding + app config
- `apps/web/src/QuoteBuilder.tsx` — quoting engine
- `apps/portal/src/server/index.ts` — Express entry point (port 4000)
- `apps/portal/src/server/lib/automationEngine.ts` — automation rule engine
- `apps/portal/prisma/schema.prisma` — full PostgreSQL schema

## Environment Variables

Minimum required (for `apps/portal/.env`):
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — 64+ char random string
- `JWT_REFRESH_SECRET` — separate 64+ char random string

See `SETUP.md` for full setup guide for all external services.

## Rebrand Notes

The app was originally "FencePro" and has been rebranded to "EZ Biz":
- All user-facing strings updated to "EZ Biz" / "EZBiz"
- Package names updated: `ezbiz`, `ezbiz-portal`, `@ezbiz/api`, `@ezbiz/shared`
- CRM adapter class renamed: `FenceProCrmAdapter` → `EzBizCrmAdapter`
- `localStorage` keys (`fencepro_*`) and CustomEvents (`fencepro:*`) are **internal identifiers** — intentionally unchanged to preserve user data
- See `REBRAND_AUDIT.md` for complete categorized rebrand log
>>>>>>> 06cd044 (rebrand FencePro → EZ Biz, extend branding config, add docs, fix workflow)
