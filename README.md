# EZ Biz — Developer Quickstart

EZ Biz is a complete field service and sales platform for fence contracting companies. It includes a CRM, quoting engine, operations board, inventory management, billing, customer portal, and automation engine.

---

## Repository Structure

```
ezbiz/                           ← monorepo root (pnpm workspaces)
├── apps/
│   ├── web/                     ← React/Vite SPA (main CRM interface)
│   │   ├── src/
│   │   │   ├── App.tsx          ← root shell, sidebar, routing
│   │   │   ├── configStore.ts   ← all app config (branding, pricing, stages)
│   │   │   ├── customerStore.ts ← customer CRUD
│   │   │   ├── jobStore.ts      ← job CRUD
│   │   │   ├── billingStore.ts  ← invoices, payments, AR
│   │   │   ├── inventoryStore.ts← inventory items, stock, transactions
│   │   │   ├── QuoteBuilder.tsx ← quoting engine
│   │   │   └── ...             ← ~80 additional components/stores
│   │   └── vite.config.ts       ← Vite config (port 5000, proxy /api→4000)
│   │
│   └── portal/                  ← Express backend + customer portal
│       ├── src/server/
│       │   ├── index.ts         ← Express server entry (port 4000)
│       │   ├── routes/          ← API route handlers
│       │   ├── lib/             ← Auth, email, cache, automation engine
│       │   └── integrations/    ← Third-party adapter pattern
│       ├── src/client/          ← Customer-facing portal React app (port 5175)
│       └── prisma/
│           ├── schema.prisma    ← PostgreSQL schema (1,400+ lines)
│           └── seed.ts          ← Demo seed data
│
├── packages/
│   ├── api/                     ← @ezbiz/api shared API package (minimal)
│   └── shared/                  ← @ezbiz/shared (quote engine utils)
│
├── AUDIT_REPORT.md              ← Module inventory and status
├── DATA_FLOW_MAP.md             ← Cross-module data flow documentation
├── REBRAND_AUDIT.md             ← FencePro → EZ Biz rebrand log
├── SETUP.md                     ← External services setup guide
├── WHITELABEL.md                ← Whitelabeling and branding guide
└── README.md                    ← This file
```

---

## Quick Start

### Prerequisites
- Node.js 20+
- pnpm 9+
- PostgreSQL 14+ (or a cloud DB — see SETUP.md)

### 1. Install dependencies
```bash
pnpm install
```

### 2. Set up environment
```bash
cp apps/portal/.env.example apps/portal/.env
```

Edit `apps/portal/.env` and set at minimum:
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/ezbiz
JWT_SECRET=<64+ random characters>
JWT_REFRESH_SECRET=<different 64+ random characters>
```

For address autocomplete, set in `apps/web/.env` (create it):
```env
VITE_GOOGLE_MAPS_API_KEY=<your Google Maps API key>
```

### 3. Initialize the database
```bash
cd apps/portal
npx prisma migrate deploy
npx prisma db seed
```

### 4. Start both services

**Terminal 1 — Backend API (port 4000):**
```bash
pnpm --filter ezbiz-portal dev:server
```

**Terminal 2 — Web app (port 5000):**
```bash
pnpm --filter web dev
```

Then open http://localhost:5000

---

## Default Credentials (after seed)

| Role | Email | Password |
|------|-------|----------|
| CRM Super Admin | `jbohdal@gdfencepro.com` | `admin1234` |
| Portal Admin | `admin@gdfencepro.com` | `admin1234` |

> Change these immediately in any non-development environment.

---

## Architecture

### Data Storage
- **CRM data** (quotes, jobs, customers, inventory, invoices, etc.) lives in **browser localStorage** in `apps/web`. Keys are prefixed `fencepro_*` — these are internal identifiers and must not be changed.
- **Portal data** (authentication, portal accounts, automations, leads, integrations) lives in **PostgreSQL** managed by `apps/portal` via Prisma.
- **Sync**: The CRM frontend posts data changes to `/api/sync/*` which upserts records into the portal DB.

### API
The Express server at `apps/portal` serves all API routes under `/api`. The Vite dev server proxies `/api` → `http://localhost:4000`.

### Automation Engine
The automation engine runs inside the Express server at `apps/portal/src/server/lib/automationEngine.ts`. It:
- Receives trigger events via `POST /api/automations/trigger`
- Evaluates rules stored in PostgreSQL
- Executes actions: email, SMS, notifications, tasks, webhooks, stage moves

---

## Key Commands

```bash
# Install all dependencies
pnpm install

# Start web app (port 5000)
pnpm --filter web dev

# Start portal server (port 4000)
pnpm --filter ezbiz-portal dev:server

# Generate Prisma client (after schema changes)
cd apps/portal && npx prisma generate

# Run migrations
cd apps/portal && npx prisma migrate dev

# Reset DB and re-seed
cd apps/portal && npx prisma migrate reset

# Type-check web app
pnpm --filter web tsc --noEmit

# Build web app for production
pnpm --filter web build
```

---

## Environment Variables

See `SETUP.md` for detailed setup instructions for each service.

**Minimum required for development:**
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — 64+ char random string
- `JWT_REFRESH_SECRET` — separate 64+ char random string

**Required for full functionality:**
- `VITE_GOOGLE_MAPS_API_KEY` — address autocomplete, map builder, dispatch map
- `SENDGRID_API_KEY` — email delivery
- `TWILIO_*` — SMS notifications

---

## Branding & Whitelabeling

See `WHITELABEL.md` for full whitelabeling instructions. Quick summary:

1. Open the app → Settings → Company Info
2. Set company name, phone, email, address
3. Set logo URL and brand colors
4. Set portal accent color and support contact

All nav headers, customer portal, PDF headers, and email templates pull from this config automatically.

---

## Production Deployment

See `SETUP.md` for external service setup. For deployment:

1. Build the web app: `pnpm --filter web build` → deploy `apps/web/dist/` to a static host or CDN
2. Deploy the portal server: `pnpm --filter ezbiz-portal start` (requires `NODE_ENV=production`)
3. Run migrations: `npx prisma migrate deploy`
4. Set all required environment variables
5. Configure a reverse proxy (nginx/Caddy) to route:
   - `/api/*` → portal server (port 4000)
   - `/*` → static web app files

---

## Contributing

1. Create a feature branch
2. Make changes and run TypeScript check: `pnpm --filter web tsc --noEmit`
3. Run the app locally and verify the affected flows
4. Submit a PR with a description of what changed and why
