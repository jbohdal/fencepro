FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY prisma ./prisma
RUN pnpm db:generate
COPY src ./src
COPY tsconfig.server.json ./
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY package.json ./
RUN mkdir -p uploads
EXPOSE 4000
CMD ["node", "dist/server/index.js"]
