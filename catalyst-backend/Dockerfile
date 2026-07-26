# Catalyst Backend - Multi-stage Dockerfile using Bun
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Install build dependencies (needed for native C modules like ssh2)
RUN apk add --no-cache python3 make g++

# Copy lockfile and workspace manifests
COPY bun.lock package.json ./
COPY catalyst-backend/package.json ./catalyst-backend/
COPY catalyst-frontend/package.json ./catalyst-frontend/
COPY catalyst-shared/package.json ./catalyst-shared/
COPY catalyst-backend/tsconfig.json ./catalyst-backend/
COPY catalyst-shared/types.ts ./catalyst-shared/types.ts

# Install dependencies via Bun
RUN bun install

# Copy backend source & Prisma schema
COPY catalyst-backend/src ./catalyst-backend/src
COPY catalyst-backend/prisma ./catalyst-backend/prisma

# Generate Prisma Client
WORKDIR /app/catalyst-backend
RUN bunx prisma generate --config prisma/prisma.config.ts

# Stage 2: Runtime - clean alpine image with Bun
FROM oven/bun:1-alpine

# Install curl for Docker healthcheck
RUN apk add --no-cache curl

WORKDIR /app

# Copy root node_modules and manifests
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/bun.lock ./bun.lock

# Copy backend app into /app/catalyst-backend
COPY --from=builder /app/catalyst-backend ./catalyst-backend

# Copy shared types into /app/catalyst-shared
COPY --from=builder /app/catalyst-shared ../catalyst-shared

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

# Set working directory to /app/catalyst-backend
WORKDIR /app/catalyst-backend

# Expose ports
EXPOSE 3000 2022

# Set production environment
ENV NODE_ENV=production

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["bun", "src/index.ts"]
