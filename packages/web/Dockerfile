# Multi-stage Dockerfile for Next.js web service
# Stage 1: Build (install + compile in one stage to preserve pnpm symlinks)
# Stage 2: Production runtime

# --- Stage 1: Build ---
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Copy workspace config + package files first (for layer caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/web/package.json ./packages/web/
COPY packages/shared/package.json ./packages/shared/
COPY prisma/ ./prisma/

# Install dependencies (bust cache with timestamp if needed)
RUN pnpm install --frozen-lockfile || pnpm install

# Ensure all build scripts run (ignoredBuiltDependencies may skip these)
RUN pnpm rebuild 2>/dev/null || true

# Copy source code
COPY packages/web/ ./packages/web/
COPY packages/shared/ ./packages/shared/

# Generate Prisma client
RUN npx prisma generate --schema=prisma/schema.prisma

# Rebuild pnpm symlinks after COPY overwrites packages/web/
RUN pnpm install --frozen-lockfile || pnpm install

# Build Next.js (pnpm exec resolves through pnpm's module store correctly)
RUN cd packages/web && pnpm exec next build

# --- Stage 2: Runtime ---
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone build (Next.js bundles everything needed)
COPY --from=builder /app/packages/web/.next/standalone ./
COPY --from=builder /app/packages/web/.next/static ./packages/web/.next/static
COPY --from=builder /app/packages/web/scripts ./scripts

# Copy Prisma for runtime migrations
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Run migrations then start
CMD ["sh", "-c", "npx prisma migrate deploy --schema=./prisma/schema.prisma 2>/dev/null; node packages/web/server.js"]
