# FencePro / EZBiz Portal

## Overview

A full-stack fence contractor CRM and customer portal built with Express (backend) and React/Vite (frontend). The main app is in `apps/portal`.

## Project Structure

```
apps/
  portal/           # Main full-stack app (Express + React/Vite)
    src/
      client/       # React frontend (Vite dev server on port 5000)
      server/       # Express backend (port 4000)
    prisma/         # Database schema & seed
    vite.config.ts  # Vite config (port 5000, proxies /api to 4000)
  web/              # Separate public-facing quote/customer website
packages/
  api/              # Shared API package
  shared/           # Shared utilities
prisma/             # Root-level prisma schema (legacy)
```

## Architecture

- **Frontend**: React 19 + Vite 8 + TailwindCSS 4, runs on port 5000
- **Backend**: Express 5 + TypeScript, runs on port 4000
- **Database**: PostgreSQL (Replit managed), accessed via Prisma ORM v6
- **Auth**: JWT (access + refresh tokens), bcryptjs password hashing
- **Package Manager**: pnpm (workspace monorepo managed with turbo)
- **Node Version**: Node.js 20

## Running the App

The workflow `Start application` runs:
```
cd apps/portal && pnpm dev
```
which uses `concurrently` to run:
- `tsx watch src/server/index.ts` (backend, port 4000)
- `vite` (frontend, port 5000)

Vite proxies `/api/*` requests to the backend.

## Environment Variables

Key env vars (set in Replit Secrets/Env):
- `DATABASE_URL` — PostgreSQL connection string (managed by Replit)
- `JWT_SECRET` — 64-char random string for JWT signing
- `JWT_REFRESH_SECRET` — 64-char random string for refresh tokens
- `CLIENT_URL` — Frontend URL (http://localhost:5000 in dev)
- `NODE_ENV` — "development" or "production"
- `PORT` — Backend port (4000)
- `STRICT_ENV_VALIDATION` — Set to "false" to bypass strict env checks

Optional services:
- `SENDGRID_API_KEY` — Email sending
- `TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER` — SMS
- `GOOGLE_CLIENT_ID/CLIENT_SECRET` — Google Calendar sync
- `STRIPE_SECRET_KEY/PUBLISHABLE_KEY` — Payments

## Database

- Managed PostgreSQL via Replit
- Prisma schema: `apps/portal/prisma/schema.prisma`
- Push schema changes: `cd apps/portal && pnpm db:push`
- Seed: `cd apps/portal && pnpm db:seed`

## Deployment

- Target: autoscale
- Build: `cd apps/portal && pnpm install && pnpm build`
- Run: `cd apps/portal && node dist/server/index.js`
- In production, the Express server serves the built React app from `dist/client`

## Key Features

- CRM for fence contractors (quotes, jobs, customers, invoices)
- Customer portal with ticket management, invoices, documents
- Rail optimizer for fence material calculations
- EZBudget widget for budget estimating
- Lead chat and automation engine
- Google Calendar integration
- Backup/restore functionality
- Botpress chatbot integration
