# ── FencePro CRM — Production Dockerfile ──
# Builds both the CRM web app (static) and Portal (Node.js server)

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# ── Install dependencies ──
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/portal/package.json apps/portal/
COPY packages/api/package.json packages/api/ 2>/dev/null || true
COPY packages/shared/package.json packages/shared/ 2>/dev/null || true
RUN pnpm install --frozen-lockfile || pnpm install

# ── Build CRM web app (static files) ──
FROM deps AS build-web
COPY apps/web/ apps/web/
WORKDIR /app/apps/web
RUN npx vite build

# ── Build Portal (server + client) ──
FROM deps AS build-portal
COPY apps/portal/ apps/portal/
WORKDIR /app/apps/portal
RUN npx prisma generate
RUN npx tsc -p tsconfig.server.json
RUN npx vite build

# ── Production runtime ──
FROM node:22-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# Copy built artifacts
COPY --from=build-portal /app/apps/portal/dist/ ./portal/dist/
COPY --from=build-portal /app/apps/portal/prisma/ ./portal/prisma/
COPY --from=build-portal /app/apps/portal/package.json ./portal/
COPY --from=build-portal /app/node_modules/ ./node_modules/
COPY --from=build-web /app/apps/web/dist/ ./web/

# Create uploads directory
RUN mkdir -p ./portal/uploads

WORKDIR /app/portal
ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

CMD ["node", "dist/server/index.js"]
