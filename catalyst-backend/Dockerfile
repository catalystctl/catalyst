# Catalyst Backend - Multi-stage Dockerfile
# Stage 1: Builder - installs all deps, generates Prisma client, compiles TypeScript
FROM node:22-alpine AS builder

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Install build dependencies (needed for native modules like ssh2)
RUN apk add --no-cache python3 make g++

# Create a minimal monorepo root so pnpm can resolve workspace dependencies.
# The root pnpm-lock.yaml + .npmrc + pnpm-workspace.yaml drive the install,
# but only the backend workspace is materialised in the image.
# devDeps here must match the root package.json specifiers — pnpm
# --frozen-lockfile validates the lockfile specifiers match the manifest.
COPY pnpm-lock.yaml .npmrc ./
COPY pnpm-workspace.yaml ./
RUN printf '%s\n' '{"name":"catalyst","private":true,"devDependencies":{"@commitlint/cli":"^21.0.2","@commitlint/config-conventional":"^21.0.2","husky":"^9.1.7","typescript":"~6.0.3"}}' > package.json

# Copy backend manifest first for dependency-layer caching
COPY catalyst-backend/package.json ./catalyst-backend/
COPY catalyst-backend/tsconfig.json ./catalyst-backend/

# Copy shared types (resolved by tsconfig paths)
COPY catalyst-shared/types.ts ./catalyst-shared/types.ts

# Install all dependencies (including devDeps needed for prisma generate and tsc)
RUN pnpm install --frozen-lockfile

# Copy backend source & Prisma schema
COPY catalyst-backend/src ./catalyst-backend/src
COPY catalyst-backend/prisma ./catalyst-backend/prisma

# Generate Prisma Client
WORKDIR /app/catalyst-backend
RUN npx prisma generate --config prisma/prisma.config.ts

# Compile TypeScript to JavaScript
RUN pnpm run build

# Back up generated Prisma client before pruning (pnpm install --prod may clear node_modules).
# With pnpm node-linker=hoisted the .prisma cache lives at the workspace root, not
# under catalyst-backend/node_modules. WORKDIR is /app/catalyst-backend so we
# reference the hoisted location explicitly.
RUN cp -r /app/node_modules/.prisma /tmp/.prisma-backup

# Prune dev dependencies in-place (removes typescript, eslint, vitest, prisma CLI, etc.)
# This drops node_modules from ~424 MB to ~200 MB
RUN pnpm install --prod --frozen-lockfile

# Restore Prisma client + engine cache if they were removed during the prune.
# pnpm-hoisted mode keeps them at the workspace root, so restore there too.
RUN if [ ! -d /app/node_modules/.prisma ]; then cp -r /tmp/.prisma-backup /app/node_modules/.prisma; fi

# Materialise the Prisma client under catalyst-backend/node_modules so the
# runtime stage's `COPY --from=builder /app/catalyst-backend/node_modules`
# picks it up. With pnpm 11 + node-linker=hoisted, @prisma/client is a
# symlink into node_modules/.pnpm and .prisma/client is the engine cache.
# Use -L to dereference the symlinks and copy actual files (otherwise the
# runtime image's broken symlink would point to a path it doesn't have).
# Then copy the .pnpm store so the dereferenced .pnpm/... paths inside
# the @prisma/client package resolve correctly at runtime.
RUN mkdir -p /app/catalyst-backend/node_modules/.prisma /app/catalyst-backend/node_modules/@prisma
RUN cp -rL /app/node_modules/.prisma /app/catalyst-backend/node_modules/.prisma
RUN cp -rL /app/node_modules/@prisma/client /app/catalyst-backend/node_modules/@prisma/client
RUN if [ -d /app/node_modules/@prisma/adapter-pg ]; then \
      cp -rL /app/node_modules/@prisma/adapter-pg /app/catalyst-backend/node_modules/@prisma/adapter-pg; \
    fi
# Also copy the .pnpm store so that any inner symlinks in @prisma/client
# (e.g. for transitive deps hoisted into .pnpm/...) resolve at runtime.
RUN if [ -d /app/node_modules/.pnpm ]; then \
      cp -r /app/node_modules/.pnpm /app/catalyst-backend/node_modules/.pnpm; \
    fi

# Stage 2: Runtime - clean image without build tools or dev dependencies
FROM node:22-alpine

# Install curl for Docker healthcheck
RUN apk add --no-cache curl

WORKDIR /app

# Copy production-only node_modules from builder
COPY --from=builder /app/catalyst-backend/node_modules ./node_modules

# Copy compiled JavaScript and source maps
COPY --from=builder /app/catalyst-backend/dist ./dist
COPY --from=builder /app/catalyst-backend/prisma ./prisma
COPY --from=builder /app/catalyst-backend/package.json ./package.json
COPY --from=builder /app/catalyst-backend/tsconfig.json ./tsconfig.json

# Copy shared types (resolved by tsconfig paths at runtime for source maps)
RUN mkdir -p ../catalyst-shared
COPY --from=builder /app/catalyst-shared/types.ts ../catalyst-shared/types.ts

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
CMD ["node", "dist/index.js"]
