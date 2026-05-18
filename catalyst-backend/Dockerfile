# Catalyst Backend - Multi-stage Dockerfile
# Stage 1: Builder - installs all deps, generates Prisma client, compiles native modules
FROM oven/bun:1.3-alpine AS builder

WORKDIR /app

# Install build dependencies (needed for native modules like ssh2)
RUN apk add --no-cache python3 make g++

# Copy backend source
COPY catalyst-backend/package.json catalyst-backend/bun.lock ./
COPY catalyst-backend/tsconfig.json ./
COPY catalyst-backend/src ./src
COPY catalyst-backend/prisma ./prisma

# Copy shared types (resolved by tsconfig paths)
RUN mkdir -p ../catalyst-shared
COPY catalyst-shared/types.ts ../catalyst-shared/types.ts

# Install all dependencies (including devDeps needed for prisma generate)
RUN bun install

# Generate Prisma Client
RUN bunx prisma generate --config prisma/prisma.config.ts

# Back up generated Prisma client before pruning (bun install --production may clear node_modules)
RUN cp -r node_modules/.prisma /tmp/.prisma-backup

# Prune dev dependencies in-place (removes typescript, eslint, vitest, prisma CLI, @electric-sql, etc.)
# This drops node_modules from ~424 MB to ~200 MB
RUN bun install --production

# Restore Prisma client if it was removed during prune
RUN if [ ! -d node_modules/.prisma ]; then cp -r /tmp/.prisma-backup node_modules/.prisma; fi

# Stage 2: Runtime - clean image without build tools or dev dependencies
FROM oven/bun:1.3-alpine

# Install curl for Docker healthcheck
RUN apk add --no-cache curl

WORKDIR /app

# Copy production-only node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy source and generated Prisma client
COPY --from=builder /app/src ./src
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/bun.lock ./bun.lock
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Copy shared types
RUN mkdir -p ../catalyst-shared
COPY --from=builder /app/../catalyst-shared/types.ts ../catalyst-shared/types.ts

# Copy deploy script
COPY scripts/deploy-agent.sh /scripts/deploy-agent.sh

# Create non-root user
RUN addgroup -S catalyst && adduser -S catalyst -G catalyst

# Copy entrypoint
COPY catalyst-backend/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Create data directories
RUN mkdir -p /var/lib/catalyst/servers \
             /var/lib/catalyst/backups \
             /var/lib/catalyst/plugins \
             /tmp/catalyst-backup-stream \
             /tmp/catalyst-backup-transfer && \
    chown -R catalyst:catalyst /var/lib/catalyst /tmp/catalyst-backup-stream /tmp/catalyst-backup-transfer

USER catalyst

# Expose port
EXPOSE 3000 2022

# Set production environment
ENV NODE_ENV=production

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["bun", "src/index.ts"]
