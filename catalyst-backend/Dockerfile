# Catalyst Backend - Dockerfile

FROM oven/bun:1.3-alpine

WORKDIR /app

# Install build dependencies (needed for native modules like ssh2)
RUN apk add --no-cache python3 make g++ curl

# Copy backend source
COPY catalyst-backend/package.json catalyst-backend/bun.lock ./
COPY catalyst-backend/tsconfig.json ./
COPY catalyst-backend/src ./src
COPY catalyst-backend/prisma ./prisma

# Copy shared types (resolved by tsconfig paths)
RUN mkdir -p ../catalyst-shared
COPY catalyst-shared/types.ts ../catalyst-shared/types.ts

# Install dependencies
RUN bun install

# Generate Prisma Client
RUN bunx prisma generate --config prisma/prisma.config.ts

# Create non-root user
RUN addgroup -S catalyst && adduser -S catalyst -G catalyst

# Copy entrypoint
COPY catalyst-backend/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Create data directories
RUN mkdir -p /var/lib/catalyst/servers /var/lib/catalyst/backups /tmp/catalyst-backup-stream /tmp/catalyst-backup-transfer && \
    chown -R catalyst:catalyst /var/lib/catalyst /tmp/catalyst-backup-stream /tmp/catalyst-backup-transfer

USER catalyst

# Expose port
EXPOSE 3000 2022

# Set production environment
ENV NODE_ENV=production

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["bun", "src/index.ts"]
